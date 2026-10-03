"""
Pydantic schemas for User API.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# Request schemas

class UserProfileUpdate(BaseModel):
    """Update user profile."""
    full_name: Optional[str] = Field(None, max_length=100)


# Response schemas

class UserResponse(BaseModel):
    """User profile response."""
    id: str
    email: str
    full_name: Optional[str]
    quota_used_bytes: int
    created_at: datetime
    last_login_at: Optional[datetime]
    
    class Config:
        from_attributes = True
