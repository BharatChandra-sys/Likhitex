"""
Pydantic schemas for File API.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# Request schemas

class FileUpload(BaseModel):
    """Upload file to project."""
    path: str = Field(..., description="File path within project (e.g., 'main.tex')")
    content: str = Field(..., description="File content (text or base64 for binary)")
    type: Optional[str] = Field(None, description="File type (tex, bib, png, etc.)")


class FileUpdate(BaseModel):
    """Update file content."""
    content: str


# Response schemas

class FileResponse(BaseModel):
    """File metadata."""
    id: UUID
    project_id: UUID
    path: str
    type: str
    size_bytes: int
    hash: str
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class FileDetailResponse(FileResponse):
    """File with content."""
    content: Optional[str] = None
    storage_key: Optional[str] = None
    download_url: Optional[str] = None


class FileListResponse(BaseModel):
    """List of files in project."""
    files: list[FileResponse]
    total_size_bytes: int
