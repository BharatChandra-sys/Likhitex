"""
Pydantic schemas for the File API.
"""
import posixpath
import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_PATH_LENGTH = 512

# Project-relative paths only. Excludes control characters, backslashes and
# shell-significant characters so a path cannot escape the project directory
# later when it is materialised on a filesystem.
_SAFE_PATH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/ ()+-]*$")


def validate_project_path(path: str) -> str:
    """
    Validate and normalise a project-relative file path.

    Rejects absolute paths, traversal segments, dotfiles, backslashes, control
    characters, and anything resolving outside the project root.

    Raises:
        ValueError: when the path is not acceptable.
    """
    if not path or not path.strip():
        raise ValueError("File path cannot be empty")
    if len(path) > MAX_PATH_LENGTH:
        raise ValueError(f"File path exceeds {MAX_PATH_LENGTH} characters")
    if "\\" in path:
        raise ValueError("File path must use forward slashes")
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in path):
        raise ValueError("File path contains control characters")
    if not _SAFE_PATH_RE.match(path):
        raise ValueError("File path contains unsupported characters")
    if path.startswith("/"):
        raise ValueError("File path must be relative to the project")

    normalised = posixpath.normpath(path)
    segments = normalised.split("/")

    if normalised.startswith("../") or normalised == "..":
        raise ValueError("File path must not traverse outside the project")
    if any(seg in ("", ".", "..") for seg in segments):
        raise ValueError("File path must not traverse outside the project")
    if any(seg.startswith(".") for seg in segments):
        raise ValueError("File path segments must not start with a dot")

    return normalised


# Request schemas


class FileUpload(BaseModel):
    """Upload or create a file inside a project."""

    model_config = {"extra": "forbid"}

    path: str = Field(..., description="Project-relative path, e.g. 'main.tex'")
    content: str = Field(..., description="File content (text, or base64 for binary)")
    type: str | None = Field(None, max_length=16, description="File type, e.g. tex, png")

    @field_validator("path")
    @classmethod
    def _validate_path(cls, value: str) -> str:
        return validate_project_path(value)

    @field_validator("type")
    @classmethod
    def _validate_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip().lower().lstrip(".")
        if not cleaned.isalnum():
            raise ValueError("File type must be alphanumeric")
        return cleaned


class FileUpdate(BaseModel):
    """Replace a file's content."""

    model_config = {"extra": "forbid"}

    content: str = Field(..., description="File content (text, or base64 for binary)")


# Response schemas


class FileResponse(BaseModel):
    """File metadata."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    path: str
    type: str
    size_bytes: int
    hash: str
    created_at: datetime
    updated_at: datetime


class FileDetailResponse(FileResponse):
    """File metadata plus inline content or a download URL."""

    content: str | None = None
    storage_key: str | None = None
    download_url: str | None = None


class FileListResponse(BaseModel):
    """All files in a project."""

    files: list[FileResponse]
    total_size_bytes: int
