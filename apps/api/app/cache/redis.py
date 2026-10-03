"""
Redis connection management, health checks, and helper utilities.
"""
import json
import logging
from typing import Any

from fastapi import HTTPException, status
from redis.asyncio import Redis
from redis.asyncio.connection import ConnectionPool
from redis.exceptions import RedisError

from app.config import settings

logger = logging.getLogger(__name__)


class RedisNotAvailableError(RuntimeError):
    """Raised when a Redis-backed feature is used without a live connection."""


class RedisManager:
    """
    Owns the Redis client and exposes small typed helpers.

    The client is created lazily so importing the app never requires Redis;
    `connect()` performs the actual handshake and is what the lifespan calls.
    """

    def __init__(self) -> None:
        self._redis: Redis | None = None
        self._pool: ConnectionPool | None = None

    @property
    def is_connected(self) -> bool:
        """True when a client exists."""
        return self._redis is not None

    @property
    def redis(self) -> Redis:
        """Get the Redis client, raising if it was never connected."""
        if self._redis is None:
            raise RedisNotAvailableError("Redis is not connected")
        return self._redis

    async def connect(self) -> None:
        """Create the client and verify the connection with a PING."""
        if self._redis is not None:
            return

        pool = ConnectionPool.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=settings.REDIS_SOCKET_TIMEOUT,
            socket_timeout=settings.REDIS_SOCKET_TIMEOUT,
            socket_keepalive=True,
            health_check_interval=30,
        )
        client = Redis(connection_pool=pool)

        try:
            await client.ping()
        except RedisError:
            await client.aclose()
            raise

        self._pool = pool
        self._redis = client
        logger.info("Redis connection established")

    async def disconnect(self) -> None:
        """Close the client and its pool."""
        if self._redis is not None:
            try:
                await self._redis.aclose()
            finally:
                self._redis = None
                self._pool = None
                logger.info("Redis connection closed")

    async def ping(self) -> bool:
        """Return True when Redis answers PING."""
        if self._redis is None:
            return False
        try:
            return bool(await self._redis.ping())
        except RedisError:
            return False

    # Helper methods for common operations

    async def get_json(self, key: str) -> dict[str, Any] | None:
        """Get a JSON value, or None when missing/unreadable."""
        try:
            value = await self.redis.get(key)
            return json.loads(value) if value else None
        except (RedisError, json.JSONDecodeError, TypeError) as exc:
            logger.error("get_json(%s) failed: %s", key, exc)
            return None

    async def set_json(self, key: str, value: dict[str, Any], ex: int | None = None) -> bool:
        """Store a JSON value with an optional TTL in seconds."""
        try:
            await self.redis.set(key, json.dumps(value), ex=ex)
            return True
        except (RedisError, TypeError) as exc:
            logger.error("set_json(%s) failed: %s", key, exc)
            return False

    async def incr_with_ttl(self, key: str, ttl: int = 60) -> int:
        """
        Increment a counter, setting the TTL only on the first increment.

        Uses a Lua script so the INCR/EXPIRE pair is atomic; without this a
        crash between the two calls leaves a permanent counter.

        Returns:
            Current count after the increment.

        Raises:
            RedisError: propagated so callers can apply fail-open/fail-closed.
        """
        script = (
            "local count = redis.call('INCR', KEYS[1]) "
            "if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end "
            "return count"
        )
        count = await self.redis.eval(script, 1, key, str(ttl))
        return int(count)

    async def delete_pattern(self, pattern: str, batch: int = 500) -> int:
        """Delete every key matching a glob pattern using scan (never KEYS)."""
        deleted = 0
        try:
            async for key in self.redis.scan_iter(match=pattern, count=batch):
                deleted += await self.redis.delete(key)
        except RedisError as exc:
            logger.error("delete_pattern(%s) failed: %s", pattern, exc)
        return deleted


# Global instance
_redis_manager: RedisManager | None = None

# Atomic INCR + conditional EXPIRE, used by the rate limiter.
# A crash between two round trips would otherwise leave a key with no TTL,
# which permanently pins the caller at their limit.
_INCR_WITH_TTL_LUA = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
"""


async def incr_with_ttl_script(redis: Redis, key: str, ttl: int = 60) -> int:
    """
    Atomically increment a counter and set its TTL on first use.

    Args:
        redis: Live Redis client.
        key: Counter key.
        ttl: Window length in seconds.

    Returns:
        The counter value after incrementing.

    Raises:
        RedisError: propagated to the caller for fail-open/fail-closed handling.
    """
    return int(await redis.eval(_INCR_WITH_TTL_LUA, 1, key, str(max(1, ttl))))


def get_redis_manager() -> RedisManager:
    """Get the global Redis manager, raising if the lifespan never ran."""
    if _redis_manager is None:
        raise RedisNotAvailableError("Redis manager not initialized")
    return _redis_manager


async def init_redis() -> RedisManager:
    """Initialise and connect the global Redis manager."""
    global _redis_manager
    if _redis_manager is None:
        _redis_manager = RedisManager()
    await _redis_manager.connect()
    return _redis_manager


async def close_redis() -> None:
    """Disconnect the global Redis manager."""
    global _redis_manager
    if _redis_manager is not None:
        await _redis_manager.disconnect()
        _redis_manager = None


async def redis_ping() -> bool:
    """True when Redis is connected and responsive."""
    return _redis_manager is not None and await _redis_manager.ping()


async def get_redis() -> Redis:
    """
    FastAPI dependency returning the live Redis client.

    Raises:
        HTTPException 503: when Redis is unavailable, so dependent endpoints
            fail explicitly instead of surfacing an unhandled 500.
    """
    if _redis_manager is None or not _redis_manager.is_connected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cache/queue backend unavailable",
            headers={"Retry-After": "5"},
        )
    return _redis_manager.redis
