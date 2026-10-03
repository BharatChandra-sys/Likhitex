"""
Project API routes.

CRUD for LaTeX projects plus membership management.

Access control notes:
- Every handler runs through `Require*`, which returns 404 (not 403) for
  projects the caller cannot see, so the API does not confirm the existence of
  other users' projects.
- Membership changes require OWNER and cannot leave a project ownerless.
"""
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import (
    RequireOwner,
    RequireViewer,
    ensure_not_last_owner,
    get_current_user,
)
from app.config import settings
from app.db import File, Project, ProjectMember, User
from app.db.base import get_db
from app.db.models import Role
from app.projects.schemas import (
    ProjectCreate,
    ProjectDetailResponse,
    ProjectListResponse,
    ProjectMemberAdd,
    ProjectMemberResponse,
    ProjectMemberUpdate,
    ProjectResponse,
    ProjectUpdate,
    UserResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    data: ProjectCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProjectResponse:
    """
    Create a project owned by the caller.
    """
    project = Project(name=data.name, description=data.description, owner_id=user.id)
    db.add(project)
    await db.commit()
    await db.refresh(project)

    logger.info("User %s created project %s", user.id, project.id)
    return ProjectResponse.model_validate(project)


@router.get("/", response_model=ProjectListResponse)
async def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, max_length=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProjectListResponse:
    """
    List projects the caller owns or has been given access to.

    Pagination is offset-based, and `total` reflects the filtered set.
    """
    query = select(Project).where(Project.is_deleted.is_(False))

    query = query.where(
        or_(
            Project.owner_id == user.id,
            Project.id.in_(
                select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
            ),
        )
    )

    if search:
        # Escape LIKE wildcards so a search for "100%" is a literal search.
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.where(Project.name.ilike(f"%{escaped}%", escape="\\"))

    total = await db.scalar(select(func.count()).select_from(query.subquery())) or 0

    page_result = await db.execute(
        query.order_by(Project.updated_at.desc(), Project.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    projects = page_result.scalars().all()

    return ProjectListResponse(
        projects=[ProjectResponse.model_validate(p) for p in projects],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{project_id}", response_model=ProjectDetailResponse)
async def get_project(
    project: Project = Depends(RequireViewer),
    db: AsyncSession = Depends(get_db),
) -> ProjectDetailResponse:
    """
    Get project details including owner, members, and file count.

    Requires: VIEWER role.
    """
    members_result = await db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project.id)
        .options(selectinload(ProjectMember.user))
        .order_by(ProjectMember.added_at)
    )
    members = members_result.scalars().all()

    file_count = await db.scalar(
        select(func.count()).select_from(File).where(File.project_id == project.id)
    )

    return ProjectDetailResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        owner_id=project.owner_id,
        size_bytes=project.size_bytes,
        created_at=project.created_at,
        updated_at=project.updated_at,
        last_compiled_at=project.last_compiled_at,
        owner=UserResponse.model_validate(project.owner),
        members=[ProjectMemberResponse.model_validate(m) for m in members],
        file_count=file_count or 0,
    )


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    data: ProjectUpdate,
    project: Project = Depends(RequireOwner),
    db: AsyncSession = Depends(get_db),
) -> ProjectResponse:
    """
    Update project metadata.

    Requires: OWNER role.
    """
    # Distinguish "absent" from "explicit null" so description can be cleared.
    fields = data.model_dump(exclude_unset=True)
    for field, value in fields.items():
        setattr(project, field, value)

    await db.commit()
    await db.refresh(project)
    return ProjectResponse.model_validate(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project: Project = Depends(RequireOwner),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """
    Soft-delete a project.

    Soft delete keeps file rows and quota accounting intact and lets the owner
    recover; the unique (project_id, path) constraint still applies, so a
    restored project would need its files reconciled first.

    Requires: OWNER role.
    """
    if project.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Project is already deleted",
        )

    project.is_deleted = True
    await db.commit()

    logger.info("Soft-deleted project %s", project.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Member management


@router.post(
    "/{project_id}/members",
    response_model=ProjectMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_project_member(
    data: ProjectMemberAdd,
    project: Project = Depends(RequireOwner),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProjectMemberResponse:
    """
    Grant an existing user access to a project.

    Requires: OWNER role.
    """
    result = await db.execute(select(User).where(User.email == data.email))
    target = result.scalar_one_or_none()

    if target is None:
        # Do not confirm whether the email belongs to a registered account.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No user with that email has signed in yet",
        )

    if target.id == project.owner_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The project owner already has full access",
        )

    if target.is_blocked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That account is blocked",
        )

    member = ProjectMember(
        project_id=project.id,
        user_id=target.id,
        role=data.role,
        added_by=user.id,
    )
    db.add(member)

    try:
        await db.commit()
    except IntegrityError as exc:
        # Unique (project_id, user_id) race.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already a member of this project",
        ) from exc

    await db.refresh(member)
    await db.refresh(member, ["user"])

    logger.info("Granted %s access to project %s as %s", target.id, project.id, data.role.value)
    return ProjectMemberResponse.model_validate(member)


@router.get("/{project_id}/members", response_model=list[ProjectMemberResponse])
async def list_project_members(
    project: Project = Depends(RequireViewer),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectMemberResponse]:
    """
    List project members.

    Requires: VIEWER role.
    """
    result = await db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project.id)
        .options(selectinload(ProjectMember.user))
        .order_by(ProjectMember.added_at)
    )
    return [ProjectMemberResponse.model_validate(m) for m in result.scalars().all()]


@router.patch("/{project_id}/members/{member_id}", response_model=ProjectMemberResponse)
async def update_project_member(
    member_id: UUID,
    data: ProjectMemberUpdate,
    project: Project = Depends(RequireOwner),
    db: AsyncSession = Depends(get_db),
) -> ProjectMemberResponse:
    """
    Change a member's role.

    Requires: OWNER role.
    """
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.id == member_id,
            ProjectMember.project_id == project.id,
        )
    )
    member = result.scalar_one_or_none()

    if member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    await ensure_not_last_owner(db, project, member, data.role)

    member.role = data.role
    await db.commit()
    await db.refresh(member)
    await db.refresh(member, ["user"])

    return ProjectMemberResponse.model_validate(member)


@router.delete(
    "/{project_id}/members/{member_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_project_member(
    member_id: UUID,
    project: Project = Depends(RequireOwner),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """
    Revoke a user's access to a project.

    Requires: OWNER role.
    """
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.id == member_id,
            ProjectMember.project_id == project.id,
        )
    )
    member = result.scalar_one_or_none()

    if member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    # Blocks both demoting and removing the only OWNER.
    await ensure_not_last_owner(db, project, member, Role.VIEWER)

    removed_user_id = member.user_id
    await db.delete(member)
    await db.commit()

    logger.info("Revoked %s access to project %s", removed_user_id, project.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}/quota")
async def get_project_quota(
    project: Project = Depends(RequireViewer),
) -> dict[str, float | int]:
    """
    Report how much of the project's storage allowance is used.

    Requires: VIEWER role.
    """
    quota_bytes = settings.QUOTA_PER_PROJECT_MB * 1024 * 1024
    used = project.size_bytes or 0
    return {
        "used_bytes": used,
        "quota_bytes": quota_bytes,
        "remaining_bytes": max(0, quota_bytes - used),
        "percentage_used": round((used / quota_bytes * 100), 2) if quota_bytes else 0.0,
    }
