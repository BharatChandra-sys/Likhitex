"""
Auth dependencies for FastAPI routes.
Used to protect endpoints and enforce permissions.
"""
import logging
from datetime import timedelta
from typing import Any
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.clerk import (
    user_email_from_claims,
    user_name_from_claims,
    verify_clerk_token,
)
from app.config import settings
from app.db import AllowedEmail, Project, ProjectMember, User
from app.db.base import get_db
from app.db.models import Role, utcnow

logger = logging.getLogger(__name__)

# Only touch last_login_at if it is older than this, to avoid a write per request.
LAST_LOGIN_REFRESH = timedelta(minutes=5)

ROLE_LEVEL: dict[Role, int] = {
    Role.VIEWER: 1,
    Role.EDITOR: 2,
    Role.OWNER: 3,
}


async def _email_is_allowed(db: AsyncSession, email: str | None) -> bool:
    """
    Check the invite-only allowlist for an email.

    A user is allowed when the exact email is in `allowed_emails`, or when it
    matches one of ALLOWED_EMAIL_DOMAINS. A missing email is never allowed.
    """
    if not email:
        return False

    normalized = email.strip().lower()

    result = await db.execute(
        select(func.count())
        .select_from(AllowedEmail)
        .where(func.lower(AllowedEmail.email) == normalized)
    )
    if (result.scalar() or 0) > 0:
        return True

    domain = normalized.rsplit("@", 1)[-1]
    domains = settings.allowed_email_domains_list
    return bool(domain) and domain in domains


async def get_current_user(
    token_payload: dict[str, Any] = Depends(verify_clerk_token),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Resolve the authenticated Clerk user to a local `User` row.

    The row is created on first login. When `INVITE_ONLY` is enabled the email
    must already be allowlisted, otherwise 403 is returned.

    Raises:
        HTTPException 401: token did not resolve to a usable identity.
        HTTPException 403: account blocked, or invite-only and not allowlisted.
    """
    user_id = str(token_payload["sub"])
    claim_email = user_email_from_claims(token_payload)

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is not None:
        if user.is_blocked:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account has been blocked. Contact administrator.",
            )

        # Backfill a placeholder email once a real one becomes available.
        if claim_email and user.email.endswith("@example.com"):
            conflict = await db.execute(
                select(User.id).where(User.email == claim_email, User.id != user_id)
            )
            if conflict.scalar_one_or_none() is None:
                user.email = claim_email

        now = utcnow()
        if user.last_login_at is None or (now - user.last_login_at) > LAST_LOGIN_REFRESH:
            user.last_login_at = now

        return user

    # First login: gate on the allowlist before provisioning.
    if settings.INVITE_ONLY and not await _email_is_allowed(db, claim_email):
        logger.warning("Rejected signup for non-allowlisted identity: %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has not been invited.",
        )

    # Emails are unique, so a stable non-deliverable placeholder is used when
    # Clerk withheld the address. It can never receive mail.
    email = claim_email or f"{user_id}@users.invalid"

    existing_owner = await db.execute(select(User.id).where(User.email == email))
    if existing_owner.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email is already linked to another account.",
        )

    user = User(
        id=user_id,
        email=email,
        full_name=user_name_from_claims(token_payload),
    )
    db.add(user)

    try:
        await db.flush()
    except Exception as exc:  # unique-violation race on concurrent first login
        await db.rollback()
        logger.warning("Concurrent provisioning for %s: %s", user_id, exc)
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not provision account",
            ) from exc

    logger.info("Provisioned new user: %s", user_id)
    return user


class ProjectPermission:
    """
    Dependency that resolves `{project_id}` and enforces a minimum role.

    Usage:
        @router.get("/{project_id}")
        async def get_project(project: Project = Depends(RequireViewer)):
            ...

    Raises:
        HTTPException 401: unauthenticated.
        HTTPException 404: project missing or soft-deleted (no existence leak).
        HTTPException 403: authenticated but lacking membership/role.
    """

    def __init__(self, required_role: Role | None = None) -> None:
        self.required_role = required_role

    async def __call__(
        self,
        project_id: UUID,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> Project:
        # Single join: owner row OR membership row, resolved in one round trip.
        # `owner` is eager-loaded because handlers serialise it, and a lazy
        # load in async SQLAlchemy raises MissingGreenlet instead of awaiting.
        result = await db.execute(
            select(Project, ProjectMember.role)
            .outerjoin(
                ProjectMember,
                (ProjectMember.project_id == Project.id)
                & (ProjectMember.user_id == user.id),
            )
            .options(selectinload(Project.owner))
            .where(Project.id == project_id, Project.is_deleted.is_(False))
        )
        row = result.one_or_none()

        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found",
            )

        project, member_role = row

        effective_role = Role.OWNER if project.owner_id == user.id else member_role

        if effective_role is None:
            # 404, not 403: a 403 would confirm that the project exists, which
            # leaks other users' project IDs to anyone who can guess one.
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found",
            )

        if self.required_role is not None:
            if ROLE_LEVEL[effective_role] < ROLE_LEVEL[self.required_role]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"This action requires {self.required_role.value} role",
                )

        return project


# Convenience aliases for common permissions
RequireViewer = ProjectPermission(Role.VIEWER)
RequireEditor = ProjectPermission(Role.EDITOR)
RequireOwner = ProjectPermission(Role.OWNER)


async def ensure_not_last_owner(
    db: AsyncSession,
    project: Project,
    member: ProjectMember,
    new_role: Role,
) -> None:
    """
    Prevent removing or demoting the only OWNER of a project.

    Raises:
        HTTPException 400: when the change would leave the project ownerless.
    """
    if member.role is not Role.OWNER or new_role is Role.OWNER:
        return

    if project.owner_id == member.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The project owner cannot be demoted",
        )

    result = await db.execute(
        select(func.count())
        .select_from(ProjectMember)
        .where(
            ProjectMember.project_id == project.id,
            ProjectMember.role == Role.OWNER,
            ProjectMember.id != member.id,
        )
    )
    if (result.scalar() or 0) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A project must always have at least one owner",
        )


def ip_from_request(request: Any) -> str | None:
    """Best-effort client IP, honouring the first X-Forwarded-For hop."""
    headers = getattr(request, "headers", None)
    if headers is None:
        return None
    forwarded = headers.get("x-forwarded-for")
    if forwarded:
        return str(forwarded).split(",")[0].strip()[:64]
    client = getattr(request, "client", None)
    host: str | None = getattr(client, "host", None)
    return host


def user_agent_from_request(request: Any) -> str | None:
    """Truncated User-Agent for audit records."""
    headers = getattr(request, "headers", None)
    if headers is None:
        return None
    agent = headers.get("user-agent")
    return agent[:512] if agent else None


__all__ = [
    "ProjectPermission",
    "RequireEditor",
    "RequireOwner",
    "RequireViewer",
    "ensure_not_last_owner",
    "get_current_user",
    "ip_from_request",
    "user_agent_from_request",
]
