"""
File API routes.
CRUD operations for project files.
"""
import base64
import hashlib
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import RequireEditor, RequireViewer
from app.db import Project, File
from app.db.base import get_db
from app.files.schemas import (
    FileUpload,
    FileUpdate,
    FileResponse,
    FileDetailResponse,
    FileListResponse
)
from app.storage.backend import get_storage, StorageBackend

logger = logging.getLogger(__name__)

router = APIRouter()

# Allowed file extensions
ALLOWED_EXTENSIONS = {
    '.tex', '.bib', '.sty', '.cls', '.bst',  # LaTeX
    '.png', '.jpg', '.jpeg', '.pdf', '.svg', '.eps',  # Images
    '.txt', '.md',  # Text
}

# Text file extensions (stored inline in DB)
TEXT_EXTENSIONS = {'.tex', '.bib', '.sty', '.cls', '.bst', '.txt', '.md'}


@router.post("/", response_model=FileResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    data: FileUpload,
    project: Project = Depends(RequireEditor),
    db: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage)
):
    """
    Upload file to project.
    
    - Text files stored inline in database
    - Binary files stored in R2 with content-addressable keys
    - Duplicates deduplicated by hash
    
    Requires: EDITOR role
    """
    # Validate path
    if data.path.startswith('/') or '..' in data.path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file path"
        )
    
    # Determine file type
    if not data.type:
        import os
        _, ext = os.path.splitext(data.path)
        data.type = ext.lstrip('.')
    
    # Validate extension
    ext = f".{data.type}"
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '{data.type}' not allowed"
        )
    
    # Decode content
    is_text = ext in TEXT_EXTENSIONS
    if is_text:
        content_bytes = data.content.encode('utf-8')
        content_text = data.content
    else:
        # Binary file: assume base64
        try:
            content_bytes = base64.b64decode(data.content)
            content_text = None
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid base64 content: {e}"
            )
    
    # Compute hash
    file_hash = hashlib.sha256(content_bytes).hexdigest()
    size_bytes = len(content_bytes)
    
    # Check if file already exists in project
    result = await db.execute(
        select(File).where(
            File.project_id == project.id,
            File.path == data.path
        )
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        # Update existing file
        existing.content = content_text
        existing.hash = file_hash
        existing.size_bytes = size_bytes
        existing.type = data.type
        
        # Update storage if binary
        if not is_text:
            storage_key = f"{project.id}/{file_hash[:8]}/{data.path}"
            await storage.put(storage_key, content_bytes)
            existing.storage_key = storage_key
        
        await db.commit()
        await db.refresh(existing)
        
        logger.info(f"Updated file {existing.id} in project {project.id}")
        return existing
    
    # Create new file
    storage_key = None
    if not is_text:
        # Store binary in R2
        storage_key = f"{project.id}/{file_hash[:8]}/{data.path}"
        await storage.put(storage_key, content_bytes)
    
    file = File(
        project_id=project.id,
        path=data.path,
        type=data.type,
        size_bytes=size_bytes,
        hash=file_hash,
        storage_key=storage_key,
        content=content_text
    )
    
    db.add(file)
    
    # Update project size
    project.size_bytes += size_bytes
    
    await db.commit()
    await db.refresh(file)
    
    logger.info(f"Uploaded file {file.id} to project {project.id} ({size_bytes} bytes)")
    
    return file


@router.get("/", response_model=FileListResponse)
async def list_files(
    project: Project = Depends(RequireViewer),
    db: AsyncSession = Depends(get_db)
):
    """
    List all files in project.
    
    Requires: VIEWER role
    """
    result = await db.execute(
        select(File)
        .where(File.project_id == project.id)
        .order_by(File.path)
    )
    files = result.scalars().all()
    
    total_size = sum(f.size_bytes for f in files)
    
    return FileListResponse(
        files=files,
        total_size_bytes=total_size
    )


@router.get("/{file_id}", response_model=FileDetailResponse)
async def get_file(
    file_id: UUID,
    project: Project = Depends(RequireViewer),
    db: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage)
):
    """
    Get file details and content.
    
    Requires: VIEWER role
    """
    result = await db.execute(
        select(File).where(
            File.id == file_id,
            File.project_id == project.id
        )
    )
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )
    
    # Get download URL for binary files
    download_url = None
    if file.storage_key:
        download_url = await storage.get_presigned_url(file.storage_key)
    
    return FileDetailResponse(
        **file.__dict__,
        download_url=download_url
    )


@router.get("/{file_id}/download")
async def download_file(
    file_id: UUID,
    project: Project = Depends(RequireViewer),
    db: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage)
):
    """
    Download file content directly.
    
    Requires: VIEWER role
    """
    result = await db.execute(
        select(File).where(
            File.id == file_id,
            File.project_id == project.id
        )
    )
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )
    
    # Get content
    if file.content:
        # Text file
        content = file.content.encode('utf-8')
        media_type = "text/plain"
    else:
        # Binary file from storage
        content = await storage.get(file.storage_key)
        media_type = "application/octet-stream"
    
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{file.path}"'
        }
    )


@router.put("/{file_id}", response_model=FileResponse)
async def update_file(
    file_id: UUID,
    data: FileUpdate,
    project: Project = Depends(RequireEditor),
    db: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage)
):
    """
    Update file content.
    
    Requires: EDITOR role
    """
    result = await db.execute(
        select(File).where(
            File.id == file_id,
            File.project_id == project.id
        )
    )
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )
    
    # Determine if text or binary
    ext = f".{file.type}"
    is_text = ext in TEXT_EXTENSIONS
    
    # Decode content
    if is_text:
        content_bytes = data.content.encode('utf-8')
        content_text = data.content
    else:
        try:
            content_bytes = base64.b64decode(data.content)
            content_text = None
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid base64 content: {e}"
            )
    
    # Compute new hash and size
    new_hash = hashlib.sha256(content_bytes).hexdigest()
    old_size = file.size_bytes
    new_size = len(content_bytes)
    
    # Update file
    file.content = content_text
    file.hash = new_hash
    file.size_bytes = new_size
    
    # Update storage if binary
    if not is_text:
        storage_key = f"{project.id}/{new_hash[:8]}/{file.path}"
        await storage.put(storage_key, content_bytes)
        # TODO: Delete old storage key
        file.storage_key = storage_key
    
    # Update project size
    project.size_bytes += (new_size - old_size)
    
    await db.commit()
    await db.refresh(file)
    
    logger.info(f"Updated file {file.id} in project {project.id}")
    
    return file


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: UUID,
    project: Project = Depends(RequireEditor),
    db: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage)
):
    """
    Delete file from project.
    
    Requires: EDITOR role
    """
    result = await db.execute(
        select(File).where(
            File.id == file_id,
            File.project_id == project.id
        )
    )
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )
    
    # Delete from storage if binary
    if file.storage_key:
        await storage.delete(file.storage_key)
    
    # Update project size
    project.size_bytes -= file.size_bytes
    
    # Delete from database
    await db.delete(file)
    await db.commit()
    
    logger.info(f"Deleted file {file.id} from project {project.id}")
    
    return None
