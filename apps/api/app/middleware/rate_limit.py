"""
Rate limiting.

Fixed-window counters in Redis, applied through FastAPI dependencies rather
than decorators so authentication and quota state are resolved first.

Redis outages follow `RATE_LIMIT_FAIL_OPEN`: production fails closed (429/503)
so a cache outage cannot be used to bypass limits, while development fails
open to stay usable without a local Redis.
"""
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, Request, status
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.cache.redis import incr_with_ttl_script
from app.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RateLimitResult:
    """Outcome of one rate-limit evaluation."""
    allowed: bool
    limit: int
    remaining: int
    reset_seconds: int

    def headers(self) -> dict[str, str]:
        """Standard X-RateLimit-* response headers."""
        return {
            "X-RateLimit-Limit": str(self.limit),
            "X-RateLimit-Remaining": str(self.remaining),
            "X-RateLimit-Reset": str(self.reset_seconds),
        }


class RateLimiter:
    """Fixed-window rate limiter backed by Redis."""

    def __init__(self, redis: Redis | None) -> None:
        self._redis = redis

    @property
    def enabled(self) -> bool:
        """True when limiting is on and a Redis client is available."""
        return settings.RATE_LIMIT_ENABLED and self._redis is not None

    async def check(
        self,
        namespace: str,
        identifier: str,
        limit: int,
        window: int = 60,
    ) -> RateLimitResult:
        """
        Consume one unit from the caller's window.

        Args:
            namespace: Logical bucket, e.g. "compile".
            identifier: Subject of the limit, usually a user id or IP.
            limit: Requests permitted per window.
            window: Window length in seconds.

        Returns:
            RateLimitResult describing whether the request may proceed.
        """
        if not self.enabled:
            return RateLimitResult(True, limit, limit, window)

        # `enabled` already implies a client, but the type checker cannot see
        # through the property.
        redis = self._redis
        if redis is None:
            return RateLimitResult(True, limit, limit, window)

        key = f"rl:{namespace}:{identifier}"

        try:
            count = await incr_with_ttl_script(redis, key, window)
        except RedisError as exc:
            logger.error("Rate limit check failed for %s: %s", key, exc)
            if settings.RATE_LIMIT_FAIL_OPEN and not settings.is_production:
                return RateLimitResult(True, limit, limit, window)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Rate limiter unavailable",
                headers={"Retry-After": "5"},
            ) from exc

        allowed = count <= limit
        if not allowed:
            logger.warning("Rate limit exceeded for %s (%s/%s)", key, count, limit)

        return RateLimitResult(
            allowed=allowed,
            limit=limit,
            remaining=max(0, limit - count),
            reset_seconds=window,
        )


def get_rate_limiter(request: Request) -> RateLimiter:
    """Build a limiter from the app state set during startup."""
    redis: Redis | None = getattr(request.app.state, "redis", None)
    return RateLimiter(redis)


def client_ip(request: Request) -> str:
    """Resolve the rate-limit subject for an unauthenticated caller."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    client = request.client
    return client.host if client else "unknown"


def rate_limit(
    namespace: str,
    limit: int | None = None,
    window: int = 60,
    limit_resolver: Callable[[Any], int] | None = None,
) -> Callable[..., Awaitable[RateLimitResult]]:
    """
    Build a dependency that rate-limits the authenticated user (falling back
    to the client IP).

    Usage:
        @router.post("/")
        async def handler(
            _: RateLimitResult = Depends(
                rate_limit("compile", limit=10, window=60)
            ),
        ): ...

    Args:
        namespace: Logical bucket name, part of the Redis key.
        limit: Static per-window limit. Ignored when `limit_resolver` is set.
        window: Window length in seconds.
        limit_resolver: Callable receiving the resolved user to compute a
            dynamic limit (used for per-role quotas).
    """

    async def dependency(
        request: Request,
        limiter: RateLimiter = _dependency(get_rate_limiter),
        user: Any | None = _dependency(lambda: None),
    ) -> RateLimitResult:
        subject = getattr(user, "id", None) or client_ip(request)
        effective_limit = limit_resolver(user) if limit_resolver else (limit or 0)
        result = await limiter.check(namespace, str(subject), effective_limit, window)

        if not result.allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Please retry shortly.",
                headers={**result.headers(), "Retry-After": str(result.reset_seconds)},
            )

        request.state.rate_limit = result
        return result

    return dependency


def _dependency(factory: Callable[..., Any]) -> Any:
    """Wrap a callable as a FastAPI dependency."""
    from fastapi import Depends

    return Depends(factory)
