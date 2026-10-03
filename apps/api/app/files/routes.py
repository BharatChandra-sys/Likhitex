"""
File API routes.

CRUD operations for project files.

Quota accounting: `Project.size_bytes` and `User.quota_used_bytes` are adjusted
by the signed delta on every write, so both stay consistent across updates and
deletes instead of drifting upward on each overwrite.
"""
import base64
import binascii
import hashlib
import logging
import os
import posixpath
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import RequireEditor, RequireViewer, get_current_user
from app.config import settings
from app.db import File, Project, User
from app.db.base import get_db
from app.files.schemas import (
    FileDetailResponse,
    FileListResponse,
    FileResponse,
    FileUpdate,
    FileUpload,
)
from app.storage.backend import StorageBackend, StorageError, get_storage

logger = logging.getLogger(__name__)

router = APIRouter()

# LaTeX sources plus the binary formats a document can reference.
ALLOWED_EXTENSIONS = {
    ".tex", ".bib", ".sty", ".cls", ".bst", ".ltx", ".def", ".cfg",  # LaTeX
    ".png", ".jpg", ".jpeg", ".pdf", ".svg", ".eps", ".gif",           # Images
    ".txt", ".md",                                                    # Text
}

# Stored inline in the database (text); everything else goes to object storage.
TEXT_EXTENSIONS = {".tex", ".bib", ".sty", ".cls", ".bst", ".ltx", ".def", ".cfg", ".txt", ".md"}

MIME_TYPES = {
    ".tex": "text/plain; charset=utf-8",
    ".bib": "text/plain; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".eps": "application/postscript",
}

MAX_FILE_BYTES = settings.QUOTA_PER_FILE_MB * 1024 * 1024
MAX_PROJECT_BYTES = settings.QUOTA_PER_PROJECT_MB * 1024 * 1024
MAX_USER_BYTES = settings.QUOTA_PER_USER_MB * 1024 * 1024
MAX_PROJECT_FILES = settings.MAX_FILES_PER_PROJECT


class QuotaExceeded(HTTPException):
    """Raised when a write would exceed a storage quota."""

    def __init__(self, detail: str) -> None:
        super().__init__(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=detail)


def _extension(path: str, declared_type: str | None) -> str:
    """Resolve and validate the file extension."""
    extension = posixpath.splitext(path)[1].lower()
    if not extension and declared_type:
        extension = f".{declared_type.lower().lstrip('.')}"
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '{extension or 'unknown'}' is not allowed",
        )
    return extension


def _decode_content(raw: str, extension: str) -> tuple[bytes, str | None]:
    """
    Turn the request payload into bytes plus optional inline text.

    Text extensions are treated as UTF-8; binary extensions must be base64.

    Raises:
        HTTPException 400: on malformed base64 or invalid UTF-8.
    """
    if extension in TEXT_EXTENSIONS:
        try:
            return raw.encode("utf-8"), raw
        except UnicodeEncodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File content must be valid UTF-8",
            ) from exc

    try:
        # A bare "AAAA" is technically valid base64; strict padding checking
        # is the only way to reject malformed payloads early.
        return base64.b64decode(raw, validate=True), None
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Binary file content must be valid base64",
        ) from exc


async def _enforce_quota(
    db: AsyncSession,
    user: User,
    project: Project,
    delta: int,
) -> None:
    """
    Check that a write of `delta` bytes fits in the user and project quotas.

    Raises:
        QuotaExceeded: when either limit would be exceeded.
    """
    if delta <= 0:
        return

    if user.quota_used_bytes + delta > MAX_USER_BYTES:
        raise QuotaExceeded(
            f"Storage quota exceeded: {settings.QUOTA_PER_USER_MB} MB per user"
        )
    if project.size_bytes + delta > MAX_PROJECT_BYTES:
        raise QuotaExceeded(
            f"Project size limit reached: {settings.QUOTA_PER_PROJECT_MB} MB"
        )


async def _apply_delta(db: AsyncSession, user: User, project: Project, delta: int) -> None:
    """Adjust stored byte counters, clamped so rounding cannot go negative."""
    project.size_bytes = max(0, project.size_bytes + delta)
    user.quota_used_bytes = max(0, user.quota_used_bytes + delta)


async def _get_file_or_404(db: AsyncSession, project: Project, file_id: UUID) -> File:
    """Fetch a file scoped to its project, or raise 404."""
    result = await db.execute(
        select(File).where(File.id == file_id, File.project_id == project.id)
    )
    file = result.scalar_one_or_none()
    if file is None:
        # Do not distinguish "wrong project" from "missing" - that would leak
        # the existence of other users' files.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )
    return file


@router.post("/", response_model=FileResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    data: FileUpload,
    project: Project = Depends(RequireEditor),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> FileResponse:
    """
    Create or replace a file in a project.

    Text files are stored inline; binaries go to object storage under a
    content-addressed key. Identical content at an existing path is treated
    as an update, so the unique (project_id, path) constraint always holds.

    Requires: EDITOR role.
    """
    extension = _extension(data.path, data.type)
    content_bytes, content_text = _decode_content(data.content, extension)
    size_bytes = len(content_bytes)

    if size_bytes > MAX_FILE_BYTES:
        raise QuotaExceeded(f"File exceeds the {settings.QUOTA_PER_FILE_MB} MB per-file limit")

    file_hash = hashlib.sha256(content_bytes).hexdigest()
    file_type = extension.lstrip(".")

    result = await db.execute(
        select(File).where(File.project_id == project.id, File.path == data.path)
    )
    existing = result.scalar_one_or_none()

    if existing is None:
        count = await db.scalar(
            select(func.count()).select_from(File).where(File.project_id == project.id)
        )
        if (count or 0) >= MAX_PROJECT_FILES:
            raise QuotaExceeded(f"A project may contain at most {MAX_PROJECT_FILES} files")

    delta = size_bytes - (existing.size_bytes if existing else 0)
    await _enforce_quota(db, user, project, delta)

    storage_key: str | None = None
    if extension not in TEXT_EXTENSIONS:
        storage_key = StorageBackend.build_key(project.id, file_hash, data.path)
        try:
            await storage.put(
                storage_key,
                content_bytes,
                content_type=MIME_TYPES.get(extension, "application/octet-stream"),
            )
        except StorageError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not store file",
            ) from exc

    stale_key: str | None = existing.storage_key if existing is not None else None

    if existing is not None:
        existing.content = content_text
        existing.hash = file_hash
        existing.size_bytes = size_bytes
        existing.type = file_type
        existing.storage_key = storage_key
        record = existing
    else:
        record = File(
            project_id=project.id,
            path=data.path,
            type=file_type,
            size_bytes=size_bytes,
            hash=file_hash,
            storage_key=storage_key,
            content=content_text,
        )
        db.add(record)

    await _apply_delta(db, user, project, delta)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        logger.warning("Concurrent write conflict on %s/%s", project.id, data.path)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="File was modified concurrently; retry",
        ) from exc

    await db.refresh(record)

    # Content addressing means a superseded key is unreferenced; clean it up
    # only after the transaction committed successfully.
    if stale_key and stale_key != storage_key:
        await storage.delete(stale_key)

    logger.info("Stored file %s in project %s (%d bytes)", record.path, project.id, size_bytes)
    return FileResponse.model_validate(record)


@router.get("/", response_model=FileListResponse)
async def list_files(
    project: Project = Depends(RequireViewer),
    db: AsyncSession = Depends(get_db),
) -> FileListResponse:
    """
    List all files in a project.

    Requires: VIEWER role.
    """
    result = await db.execute(
        select(File).where(File.project_id == project.id).order_by(File.path)
    )
    files = result.scalars().all()

    return FileListResponse(
        files=[FileResponse.model_validate(f) for f in files],
        total_size_bytes=sum(f.size_bytes for f in files),
    )


@router.get("/{file_id}", response_model=FileDetailResponse)
async def get_file(
    file_id: UUID,
    project: Project = Depends(RequireViewer),
    db: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> FileDetailResponse:
    """
    Get a file's metadata plus inline content or a download URL.

    Requires: VIEWER role.
    """
    file = await _get_file_or_404(db, project, file_id)

    download_url = None
    if file.storage_key:
        try:
            download_url = await storage.get_presigned_url(file.storage_key)
        except StorageError:
            # Metadata is still useful without a download link.
            logger.warning("Could not presign %s", file.storage_key)

    return FileDetailResponse(
        id=file.id,
        project_id=file.project_id,
        path=file.path,
        type=file.type,
        size_bytes=file.size_bytes,
        hash=file.hash,
        created_at=file.created_at,
        updated_at=file.updated_at,
        content=file.content,
        storage_key=file.storage_key,
        download_url=download_url,
    )


@router.get("/{file_id}/download")
async def download_file(
    file_id: UUID,
    project: Project = Depends(RequireViewer),
    db: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> Response:
    """
    Download a file's bytes.

    Requires: VIEWER role.
    """
    file = await _get_file_or_404(db, project, file_id)

    if file.content is not None:
        payload = file.content.encode("utf-8")
        media_type = "text/plain; charset=utf-8"
    elif file.storage_key:
        try:
            payload = await storage.get(file.storage_key)
        except StorageError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not read stored file",
            ) from exc
        media_type = MIME_TYPES.get(f".{file.type}", "application/octet-stream")
    else:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File has no stored content",
        )

    # RFC 6266: quote-escape the name and keep it to a bare filename, so a
    # header injection via `path` is not possible.
    filename = os.path.basename(file.path).replace('"', "")
    return Response(
        content=payload,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.put("/{file_id}", response_model=FileResponse)
async def update_file(
    file_id: UUID,
    data: FileUpdate,
    project: Project = Depends(RequireEditor),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> FileResponse:
    """
    Replace a file's content.

    Requires: EDITOR role.
    """
    file = await _get_file_or_404(db, project, file_id)

    extension = posixpath.splitext(file.path)[1].lower()
    content_bytes, content_text = _decode_content(data.content, extension)
    size_bytes = len(content_bytes)

    if size_bytes > MAX_FILE_BYTES:
        raise QuotaExceeded(f"File exceeds the {settings.QUOTA_PER_FILE_MB} MB per-file limit")

    delta = size_bytes - file.size_bytes
    await _enforce_quota(db, user, project, delta)

    new_hash = hashlib.sha256(content_bytes).hexdigest()
    storage_key: str | None = file.storage_key

    if extension not in TEXT_EXTENSIONS:
        storage_key = StorageBackend.build_key(project.id, new_hash, file.path)
        try:
            await storage.put(
                storage_key,
                content_bytes,
                content_type=MIME_TYPES.get(extension, "application/octet-stream"),
            )
        except StorageError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not store file",
            ) from exc

    stale_key = file.storage_key
    file.content = content_text
    file.hash = new_hash
    file.size_bytes = size_bytes
    file.storage_key = storage_key

    await _apply_delta(db, user, project, delta)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="File was modified concurrently; retry",
        ) from exc

    await db.refresh(file)

    if stale_key and stale_key != storage_key:
        await storage.delete(stale_key)

    logger.info("Updated file %s in project %s", file.path, project.id)
    return FileResponse.model_validate(file)


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: UUID,
    project: Project = Depends(RequireEditor),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> Response:
    """
    Delete a file from a project.

    Requires: EDITOR role.
    """
    file = await _get_file_or_404(db, project, file_id)

    await _apply_delta(db, user, project, -file.size_bytes)
    await db.delete(file)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        logger.error("Failed to delete file %s: %s", file_id, exc)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="File could not be deleted; retry",
        ) from exc

    if file.storage_key:
        await storage.delete(file.storage_key)

    logger.info("Deleted file %s from project %s", file.path, project.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
