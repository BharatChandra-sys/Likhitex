"""
Clerk JWT verification for authentication.
"""
import logging
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# HTTP Bearer scheme for extracting JWT from Authorization header
security = HTTPBearer()

# Cache for JWKS (public keys)
_jwks_cache: Optional[dict] = None


async def get_clerk_jwks() -> dict:
    """
    Fetch Clerk JWKS (JSON Web Key Set) for verifying JWTs.
    Cached after first fetch.
    """
    global _jwks_cache
    
    if _jwks_cache is not None:
        return _jwks_cache
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                settings.CLERK_JWKS_URL,
                timeout=10.0
            )
            response.raise_for_status()
            _jwks_cache = response.json()
            return _jwks_cache
    
    except Exception as e:
        logger.error(f"Failed to fetch Clerk JWKS: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service unavailable"
        )


async def verify_clerk_token(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> dict:
    """
    Verify Clerk JWT token.
    
    Returns:
        Decoded token payload with user information
    
    Raises:
        HTTPException: If token is invalid or verification fails
    """
    token = credentials.credentials
    
    try:
        # Fetch JWKS
        jwks = await get_clerk_jwks()
        
        # Decode and verify token
        # Note: python-jose will handle signature verification using JWKS
        payload = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_nbf": True,
                "verify_iss": True,
                "verify_aud": False,  # Clerk doesn't use aud claim
            }
        )
        
        # Verify issuer matches Clerk
        issuer = payload.get("iss", "")
        if not issuer.startswith("https://clerk.") and not issuer.startswith("https://api.clerk."):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token issuer"
            )
        
        # Extract user ID (sub claim)
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: missing sub claim"
            )
        
        return payload
    
    except JWTError as e:
        logger.warning(f"JWT verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    except Exception as e:
        logger.error(f"Token verification error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication error"
        )


async def get_current_user_id(
    token_payload: dict = Depends(verify_clerk_token)
) -> str:
    """
    Extract user ID from verified token.
    
    Usage:
        @router.get("/protected")
        async def protected_route(user_id: str = Depends(get_current_user_id)):
            ...
    """
    return token_payload["sub"]


# TODO Phase 2: Add get_current_user (fetch from DB)
# TODO Phase 2: Add require_role dependency
# TODO Phase 2: Add invite-only check
