"""
User API routes.

Profile and quota endpoints for the authenticated caller. Email is owned by
Clerk and is not writable here.
"""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.config import settings
from app.db import User
from app.db.base import get_db
from app.users.schemas import QuotaResponse, UserProfileUpdate, UserResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(
    user: User = Depends(get_current_user),
) -> UserResponse:
    """Return the caller's profile."""
    return UserResponse.model_validate(user)


@router.patch("/me", response_model=UserResponse)
async def update_profile(
    data: UserProfileUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """
    Update the caller's display name.

    Only `full_name` is writable; email and block status are managed elsewhere.
    """
    if "full_name" not in data.model_fields_set:
        # Nothing to change: avoid a pointless write and audit event.
        return UserResponse.model_validate(user)

    user.full_name = data.full_name
    await db.commit()
    await db.refresh(user)

    logger.info("User %s updated their profile", user.id)
    return UserResponse.model_validate(user)


@router.get("/me/quota", response_model=QuotaResponse)
async def get_quota(
    user: User = Depends(get_current_user),
) -> QuotaResponse:
    """Report the caller's storage quota usage."""
    quota_bytes = settings.QUOTA_PER_USER_MB * 1024 * 1024
    used = user.quota_used_bytes or 0

    return QuotaResponse(
        used_bytes=used,
        quota_bytes=quota_bytes,
        remaining_bytes=max(0, quota_bytes - used),
        percentage_used=round((used / quota_bytes * 100), 2) if quota_bytes else 0.0,
    )
