"""
User API routes.
User profile and settings.
"""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db import User
from app.db.base import get_db
from app.users.schemas import UserResponse, UserProfileUpdate
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(
    user: User = Depends(get_current_user)
):
    """
    Get current user profile.
    
    Returns user information from database.
    """
    return user


@router.patch("/me", response_model=UserResponse)
async def update_profile(
    data: UserProfileUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update user profile.
    
    - Can update full_name
    - Email cannot be changed (managed by Clerk)
    """
    if data.full_name is not None:
        user.full_name = data.full_name
    
    await db.commit()
    await db.refresh(user)
    
    logger.info(f"User {user.id} updated profile")
    
    return user


@router.get("/me/quota", response_model=dict)
async def get_quota(
    user: User = Depends(get_current_user)
):
    """
    Get user's storage quota information.
    
    Returns:
        - used_bytes: Current usage
        - quota_bytes: Total quota
        - remaining_bytes: Available space
        - percentage_used: Usage percentage
    """
    quota_bytes = settings.QUOTA_PER_USER_MB * 1024 * 1024
    remaining_bytes = max(0, quota_bytes - user.quota_used_bytes)
    percentage_used = (user.quota_used_bytes / quota_bytes * 100) if quota_bytes > 0 else 0
    
    return {
        "used_bytes": user.quota_used_bytes,
        "quota_bytes": quota_bytes,
        "remaining_bytes": remaining_bytes,
        "percentage_used": round(percentage_used, 2)
    }
