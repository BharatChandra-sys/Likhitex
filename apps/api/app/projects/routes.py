"""
Project API routes.
CRUD operations for LaTeX projects.
"""
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import (
    get_current_user,
    RequireEditor,
    RequireOwner,
    RequireViewer
)
from app.db import User, Project, ProjectMember, File
from app.db.base import get_db
from app.db.models import Role
from app.projects.schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ProjectDetailResponse,
    ProjectListResponse,
    ProjectMemberAdd,
    ProjectMemberUpdate,
    ProjectMemberResponse
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    data: ProjectCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new LaTeX project.
    
    - User becomes the owner
    - Empty project with no files
    - Returns project details
    """
    project = Project(
        name=data.name,
        description=data.description,
        owner_id=user.id
    )
    
    db.add(project)
    await db.commit()
    await db.refresh(project)
    
    logger.info(f"User {user.id} created project {project.id}")
    
    return project


@router.get("/", response_model=ProjectListResponse)
async def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query(None, max_length=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    List user's projects (owned + shared).
    
    - Supports pagination
    - Supports search by name
    - Returns owned projects + projects shared with user
    """
    # Build base query
    query = select(Project).where(
        Project.is_deleted == False
    )
    
    # Filter by ownership or membership
    query = query.where(
        or_(
            Project.owner_id == user.id,
            Project.id.in_(
                select(ProjectMember.project_id).where(
                    ProjectMember.user_id == user.id
                )
            )
        )
    )
    
    # Search filter
    if search:
        query = query.where(
            Project.name.ilike(f"%{search}%")
        )
    
    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()
    
    # Paginate
    query = query.order_by(Project.updated_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    # Execute
    result = await db.execute(query)
    projects = result.scalars().all()
    
    return ProjectListResponse(
        projects=projects,
        total=total,
        page=page,
        page_size=page_size
    )


@router.get("/{project_id}", response_model=ProjectDetailResponse)
async def get_project(
    project: Project = Depends(RequireViewer),
    db: AsyncSession = Depends(get_db)
):
    """
    Get project details with members list.
    
    Requires: VIEWER role
    """
    # Load relationships
    await db.refresh(project, ["owner"])
    
    # Load members
    result = await db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project.id)
        .options(selectinload(ProjectMember.user))
    )
    members = result.scalars().all()
    
    # Count files
    result = await db.execute(
        select(func.count())
        .select_from(File)
        .where(File.project_id == project.id)
    )
    file_count = result.scalar()
    
    return ProjectDetailResponse(
        **project.__dict__,
        owner=project.owner,
        members=members,
        file_count=file_count
    )


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    data: ProjectUpdate,
    project: Project = Depends(RequireOwner),
    db: AsyncSession = Depends(get_db)
):
    """
    Update project details.
    
    Requires: OWNER role
    """
    if data.name is not None:
        project.name = data.name
    
    if data.description is not None:
        project.description = data.description
    
    await db.commit()
    await db.refresh(project)
    
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project: Project = Depends(RequireOwner),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete project (soft delete).
    
    Requires: OWNER role
    """
    project.is_deleted = True
    await db.commit()
    
    logger.info(f"Project {project.id} soft deleted")
    
    return None


# Member management

@router.post("/{project_id}/members", response_model=ProjectMemberResponse)
async def add_project_member(
    data: ProjectMemberAdd,
    project: Project = Depends(RequireOwner),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Add member to project.
    
    Requires: OWNER role
    """
    # Find user by email
    result = await db.execute(
        select(User).where(User.email == data.email)
    )
    target_user = result.scalar_one_or_none()
    
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with email {data.email} not found"
        )
    
    # Check if already member
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == target_user.id
        )
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already a member of this project"
        )
    
    # Add member
    member = ProjectMember(
        project_id=project.id,
        user_id=target_user.id,
        role=data.role,
        added_by=user.id
    )
    
    db.add(member)
    await db.commit()
    await db.refresh(member)
    
    # Load user relationship
    await db.refresh(member, ["user"])
    
    logger.info(f"User {target_user.id} added to project {project.id} with role {data.role}")
    
    return member


@router.get("/{project_id}/members", response_model=list[ProjectMemberResponse])
async def list_project_members(
    project: Project = Depends(RequireViewer),
    db: AsyncSession = Depends(get_db)
):
    """
    List project members.
    
    Requires: VIEWER role
    """
    result = await db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project.id)
        .options(selectinload(ProjectMember.user))
    )
    members = result.scalars().all()
    
    return members


@router.patch("/{project_id}/members/{member_id}", response_model=ProjectMemberResponse)
async def update_project_member(
    member_id: UUID,
    data: ProjectMemberUpdate,
    project: Project = Depends(RequireOwner),
    db: AsyncSession = Depends(get_db)
):
    """
    Update member role.
    
    Requires: OWNER role
    """
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.id == member_id,
            ProjectMember.project_id == project.id
        )
    )
    member = result.scalar_one_or_none()
    
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found"
        )
    
    member.role = data.role
    await db.commit()
    await db.refresh(member, ["user"])
    
    return member


@router.delete("/{project_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_project_member(
    member_id: UUID,
    project: Project = Depends(RequireOwner),
    db: AsyncSession = Depends(get_db)
):
    """
    Remove member from project.
    
    Requires: OWNER role
    """
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.id == member_id,
            ProjectMember.project_id == project.id
        )
    )
    member = result.scalar_one_or_none()
    
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found"
        )
    
    await db.delete(member)
    await db.commit()
    
    logger.info(f"Member {member.user_id} removed from project {project.id}")
    
    return None
