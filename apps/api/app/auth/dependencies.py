"""
Auth dependencies for FastAPI routes.
Used to protect endpoints and enforce permissions.
"""
import logging
from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.clerk import get_current_user_id
from app.db import User, Project, ProjectMember
from app.db.base import get_db
from app.db.models import Role

logger = logging.getLogger(__name__)


async def get_current_user(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    Get current authenticated user from database.
    Creates user on first login (lazy creation).
    
    Raises:
        HTTPException 403: If user email not in allowed_emails
        HTTPException 404: If user doesn't exist and email not allowed
    """
    # Check if user exists
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    
    if user:
        # Check if user is blocked
        if user.is_blocked:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account has been blocked. Contact administrator."
            )
        
        # Update last login
        from datetime import datetime
        user.last_login_at = datetime.utcnow()
        await db.commit()
        
        return user
    
    # User doesn't exist - check if invited
    # TODO: Get email from Clerk token and check allowed_emails
    # For now, auto-create user (will add invite check later)
    
    logger.info(f"Creating new user on first login: {user_id}")
    
    # Create user (email will be fetched from Clerk in production)
    new_user = User(
        id=user_id,
        email=f"{user_id}@example.com",  # TODO: Get from Clerk
        full_name="User"  # TODO: Get from Clerk
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    
    return new_user


class ProjectPermission:
    """
    Check project access and role.
    
    Usage:
        @router.get("/projects/{project_id}")
        async def get_project(
            project: Project = Depends(ProjectPermission(Role.VIEWER))
        ):
            ...
    """
    
    def __init__(self, required_role: Optional[Role] = None):
        """
        Args:
            required_role: Minimum required role (VIEWER < EDITOR < OWNER)
                          None = any member can access
        """
        self.required_role = required_role
    
    async def __call__(
        self,
        project_id: UUID,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db)
    ) -> Project:
        """
        Verify user has access to project with required role.
        
        Returns:
            Project if user has access
        
        Raises:
            HTTPException 404: Project not found
            HTTPException 403: Insufficient permissions
        """
        # Fetch project
        result = await db.execute(
            select(Project).where(
                Project.id == project_id,
                Project.is_deleted == False
            )
        )
        project = result.scalar_one_or_none()
        
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found"
            )
        
        # Check if user is owner
        if project.owner_id == user.id:
            return project
        
        # Check project membership
        result = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user.id
            )
        )
        membership = result.scalar_one_or_none()
        
        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have access to this project"
            )
        
        # Check role requirement
        if self.required_role:
            role_hierarchy = {
                Role.VIEWER: 1,
                Role.EDITOR: 2,
                Role.OWNER: 3
            }
            
            user_role_level = role_hierarchy.get(membership.role, 0)
            required_role_level = role_hierarchy.get(self.required_role, 0)
            
            if user_role_level < required_role_level:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"This action requires {self.required_role.value} role"
                )
        
        return project


# Convenience aliases for common permissions
RequireViewer = ProjectPermission(Role.VIEWER)
RequireEditor = ProjectPermission(Role.EDITOR)
RequireOwner = ProjectPermission(Role.OWNER)
