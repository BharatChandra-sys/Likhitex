"""
Pydantic schemas for the Project API.
"""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models import Role

# Request schemas


class ProjectCreate(BaseModel):
    """Create a new project."""

    model_config = {"extra": "forbid"}

    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Project name cannot be blank")
        return cleaned


class ProjectUpdate(BaseModel):
    """Update project metadata."""

    model_config = {"extra": "forbid"}

    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Project name cannot be blank")
        return cleaned


class ProjectMemberAdd(BaseModel):
    """Grant a user access to a project."""

    model_config = {"extra": "forbid"}

    email: str = Field(..., max_length=320, description="Email of an existing user")
    role: Role = Field(Role.VIEWER, description="Role to grant")

    @field_validator("email")
    @classmethod
    def _normalise_email(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if cleaned.count("@") != 1 or cleaned.startswith("@") or cleaned.endswith("@"):
            raise ValueError("A valid email address is required")
        return cleaned


class ProjectMemberUpdate(BaseModel):
    """Change a member's role."""

    model_config = {"extra": "forbid"}

    role: Role


# Response schemas


class UserResponse(BaseModel):
    """Minimal user projection embedded in project responses."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    full_name: str | None = None


class ProjectMemberResponse(BaseModel):
    """Project member."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user: UserResponse
    role: Role
    added_at: datetime


class ProjectResponse(BaseModel):
    """Project metadata."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None = None
    owner_id: str
    size_bytes: int
    created_at: datetime
    updated_at: datetime
    last_compiled_at: datetime | None = None


class ProjectDetailResponse(ProjectResponse):
    """Project metadata plus owner, members and file count."""

    owner: UserResponse
    members: list[ProjectMemberResponse] = []
    file_count: int = 0


class ProjectListResponse(BaseModel):
    """Paginated project list."""

    projects: list[ProjectResponse]
    total: int
    page: int
    page_size: int
