"""
Pydantic schemas for Project API.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.db.models import Role


# Request schemas

class ProjectCreate(BaseModel):
    """Create new project."""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


class ProjectUpdate(BaseModel):
    """Update project."""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None


class ProjectMemberAdd(BaseModel):
    """Add member to project."""
    email: str = Field(..., description="User email to add")
    role: Role = Field(Role.VIEWER, description="Member role")


class ProjectMemberUpdate(BaseModel):
    """Update member role."""
    role: Role


# Response schemas

class UserResponse(BaseModel):
    """User info in responses."""
    id: str
    email: str
    full_name: Optional[str]
    
    class Config:
        from_attributes = True


class ProjectMemberResponse(BaseModel):
    """Project member info."""
    id: UUID
    user: UserResponse
    role: Role
    added_at: datetime
    
    class Config:
        from_attributes = True


class ProjectResponse(BaseModel):
    """Project info."""
    id: UUID
    name: str
    description: Optional[str]
    owner_id: str
    size_bytes: int
    created_at: datetime
    updated_at: datetime
    last_compiled_at: Optional[datetime]
    
    class Config:
        from_attributes = True


class ProjectDetailResponse(ProjectResponse):
    """Project with members list."""
    owner: UserResponse
    members: list[ProjectMemberResponse] = []
    file_count: int = 0
    
    class Config:
        from_attributes = True


class ProjectListResponse(BaseModel):
    """Paginated project list."""
    projects: list[ProjectResponse]
    total: int
    page: int
    page_size: int
