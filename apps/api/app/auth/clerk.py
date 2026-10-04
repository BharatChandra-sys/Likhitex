"""
Clerk JWT verification for authentication.

Verification is fail-closed: any inability to validate a token (network error,
unknown key, bad signature, wrong issuer/audience) results in 401/503, never
in an unverified identity being handed to a route.
"""
import logging
import time
from typing import Any
from urllib.parse import urlparse

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.config import settings

logger = logging.getLogger(__name__)

# HTTP Bearer scheme for extracting JWT from Authorization header
security = HTTPBearer(auto_error=False)


class JWKSCache:
    """Short-lived cache of the Clerk JWKS document."""

    def __init__(self) -> None:
        self._jwks: dict[str, Any] | None = None
        self._expires_at: float = 0.0
        self._lock_seconds: float = 0.0

    def get(self) -> dict[str, Any] | None:
        """Return the cached JWKS, or None when absent/expired."""
        if self._jwks is None or time.monotonic() >= self._expires_at:
            return None
        return self._jwks

    def set(self, jwks: dict[str, Any]) -> None:
        """Store a freshly fetched JWKS."""
        self._jwks = jwks
        self._expires_at = time.monotonic() + max(1, settings.CLERK_JWKS_CACHE_SECONDS)

    def clear(self) -> None:
        """Drop the cache (used after a signature failure forces a refetch)."""
        self._jwks = None
        self._expires_at = 0.0

    def is_throttled(self) -> bool:
        """True while a recent fetch failed, to avoid hammering Clerk."""
        return self._lock_seconds > time.monotonic()


_jwks_cache = JWKSCache()


async def fetch_clerk_jwks(force_refresh: bool = False) -> dict[str, Any]:
    """
    Fetch the Clerk JWKS, serving from cache when fresh.

    Raises:
        HTTPException 503: if the JWKS cannot be retrieved and none is cached.
    """
    if not force_refresh:
        cached = _jwks_cache.get()
        if cached is not None:
            return cached

    if not force_refresh and _jwks_cache.is_throttled():
        # Serve a stale cache during a Clerk outage rather than a hard failure.
        cached = _jwks_cache.get()
        if cached is not None:
            return cached

    try:
        import httpx

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(settings.CLERK_JWKS_URL)
            response.raise_for_status()
            jwks = response.json()

        if not isinstance(jwks, dict) or "keys" not in jwks:
            raise ValueError("JWKS document has no 'keys' array")

        _jwks_cache.set(jwks)
        return jwks

    except Exception as exc:
        # Throttle retries for 30s, then try again.
        _jwks_cache._lock_seconds = time.monotonic() + 30
        logger.error("Failed to fetch Clerk JWKS from %s: %s", settings.CLERK_JWKS_URL, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service unavailable",
            headers={"Retry-After": "30"},
        ) from exc


def _issuer_allowed(issuer: str) -> bool:
    """Check the `iss` claim against the configured Clerk instance."""
    if not issuer:
        return False
    expected = settings.CLERK_ISSUER.rstrip("/")
    return issuer.rstrip("/") == expected


def _audience_allowed(payload: dict[str, Any]) -> bool:
    """
    Validate `aud` when an audience is configured.

    Clerk instance type tokens (session tokens) omit `aud` entirely, so an
    empty configured audience means "issuer check only".
    """
    expected = settings.CLERK_AUDIENCE.strip()
    if not expected:
        return True

    aud = payload.get("aud")
    audiences = aud if isinstance(aud, list) else [aud]
    return expected in {str(item) for item in audiences}


async def verify_clerk_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict[str, Any]:
    """
    Verify a Clerk session/JWT token and return its payload.

    Raises:
        HTTPException 401: missing, malformed, expired or unverifiable token.
        HTTPException 503: Clerk JWKS unreachable and no cached copy.
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    issuer = settings.CLERK_ISSUER.rstrip("/")
    audience = settings.CLERK_AUDIENCE.strip() or None

    def _decode(jwks: dict[str, Any]) -> dict[str, Any]:
        claims: dict[str, Any] = jwt.decode(
            token,
            jwks,
            algorithms=["RS256", "RS384", "RS512"],
            audience=audience,
            issuer=issuer,
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_nbf": True,
                "verify_iat": True,
                "verify_iss": True,
                # Audience is only enforced when one is configured; Clerk
                # session tokens omit `aud` entirely.
                "verify_aud": audience is not None,
                # python-jose reads clock skew from `options`, not from a
                # top-level argument.
                "leeway": settings.AUTH_CLOCK_SKEW_SECONDS,
            },
        )
        return claims

    try:
        payload = _decode(await fetch_clerk_jwks())
    except JWTError as first_error:
        # A missing/rotated `kid` is the common cause: refresh once, retry.
        logger.warning("JWT verification failed (%s); retrying with fresh JWKS", first_error)
        try:
            payload = _decode(await fetch_clerk_jwks(force_refresh=True))
        except JWTError as exc:
            logger.warning("JWT verification rejected: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc

    if not _issuer_allowed(str(payload.get("iss", ""))):
        logger.warning("Rejected token with unexpected issuer: %s", payload.get("iss"))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token issuer",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not _audience_allowed(payload):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token audience",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing sub claim",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload


async def get_current_user_id(
    token_payload: dict[str, Any] = Depends(verify_clerk_token),
) -> str:
    """
    Extract the Clerk user ID (`sub`) from a verified token.

    Usage:
        @router.get("/protected")
        async def protected_route(user_id: str = Depends(get_current_user_id)):
            ...
    """
    return str(token_payload["sub"])


def user_email_from_claims(payload: dict[str, Any]) -> str | None:
    """
    Best-effort extraction of the user's email from Clerk claims.

    Session tokens carry `email`; API keys carry `primary_email_address_id`.
    Returns None when no verifiable email is present, so callers must never
    treat a missing value as permission to skip an allowlist check.
    """
    for claim in ("email", "primary_email_address"):
        value = payload.get(claim)
        if isinstance(value, str) and "@" in value:
            return value.strip().lower()

    metadata = payload.get("publicMetadata") or payload.get("metadata")
    if isinstance(metadata, dict):
        value = metadata.get("email")
        if isinstance(value, str) and "@" in value:
            return value.strip().lower()
    return None


def user_name_from_claims(payload: dict[str, Any]) -> str | None:
    """Best-effort extraction of the user's display name from Clerk claims."""
    # Try top-level claims first (standard JWT fields)
    for claim in ("name", "fullName", "full_name", "username", "first_name"):
        value = payload.get(claim)
        if isinstance(value, str) and value.strip():
            return value.strip()[:255]

    # Clerk sometimes puts user info in publicMetadata
    metadata = payload.get("publicMetadata") or payload.get("public_metadata") or payload.get("metadata")
    if isinstance(metadata, dict):
        for key in ("name", "fullName", "full_name"):
            value = metadata.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:255]

    # Build from first_name + last_name if available as separate claims
    first = payload.get("given_name") or payload.get("firstName") or ""
    last = payload.get("family_name") or payload.get("lastName") or ""
    combined = f"{first} {last}".strip()
    if combined:
        return combined[:255]

    return None


def jwt_kid(payload: dict[str, Any]) -> str | None:
    """Return the key id of a token, for log correlation only."""
    header = payload.get("__header__")
    if isinstance(header, dict):
        kid = header.get("kid")
        return str(kid) if kid else None
    return None


def jwks_endpoint_is_https() -> bool:
    """True when the configured JWKS URL uses TLS (production expectation)."""
    return urlparse(settings.CLERK_JWKS_URL).scheme == "https"
