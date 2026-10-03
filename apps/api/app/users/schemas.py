"""
Pydantic schemas for the User API.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class UserProfileUpdate(BaseModel):
    """Update the current user's profile."""

    model_config = {"extra": "forbid"}

    full_name: str | None = Field(None, max_length=100)

    @field_validator("full_name")
    @classmethod
    def _strip(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class UserResponse(BaseModel):
    """User profile. Email is managed by Clerk and is read-only here."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    full_name: str | None = None
    quota_used_bytes: int
    created_at: datetime
    last_login_at: datetime | None = None


class QuotaResponse(BaseModel):
    """Storage quota usage for the current user."""

    used_bytes: int
    quota_bytes: int
    remaining_bytes: int
    percentage_used: float
