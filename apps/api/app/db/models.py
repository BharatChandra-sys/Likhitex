"""
Database models for Likhitex.

Uses SQLAlchemy 2.0's typed declarative mapping (`Mapped[...]` +
`mapped_column(...)`) rather than bare `Column(...)`. With `Column`, the class
attribute and the instance attribute have the same declared type, so a type
checker cannot tell `project.is_deleted = True` from `project.is_deleted == False`.
`Mapped[]` separates the two and makes assignments type-checked.
"""

import enum
from datetime import UTC, datetime
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    """Current UTC time as a naive datetime, for TIMESTAMP WITHOUT TIME ZONE."""
    return datetime.now(UTC).replace(tzinfo=None)


def _persist_names(enum_class: type[enum.Enum]) -> list[str]:
    """
    Return the stored form of an enum as its member names.

    SQLAlchemy already persists PEP-435 enums by name, but relying on that
    default means a future upgrade could silently start writing the lowercase
    values instead, which the existing Postgres enum types would reject.
    Passing this via `values_callable` makes the on-disk form explicit.
    """
    return [str(member.name) for member in enum_class]


class Role(enum.StrEnum):
    """Project member roles."""
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


class CompileStatus(enum.StrEnum):
    """Compile job statuses."""
    QUEUED = "queued"
    COMPILING = "compiling"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"


class AuditAction(enum.StrEnum):
    """Audit log action types."""
    USER_LOGIN = "user_login"
    USER_LOGOUT = "user_logout"
    PROJECT_CREATE = "project_create"
    PROJECT_DELETE = "project_delete"
    PROJECT_SHARE = "project_share"
    PROJECT_UNSHARE = "project_unshare"
    FILE_UPLOAD = "file_upload"
    FILE_DELETE = "file_delete"
    COMPILE_START = "compile_start"
    COMPILE_COMPLETE = "compile_complete"


class User(Base):
    """A user. The primary key is the Clerk user ID."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(255), default=None)
    quota_used_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    owned_projects: Mapped[list["Project"]] = relationship(
        back_populates="owner",
        foreign_keys="Project.owner_id",
    )
    project_memberships: Mapped[list["ProjectMember"]] = relationship(
        back_populates="user",
        # project_members references users.id twice (user_id and added_by), so
        # the join must be pinned explicitly.
        foreign_keys="ProjectMember.user_id",
    )
    compile_jobs: Mapped[list["CompileJob"]] = relationship(back_populates="user")
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="user")

    __table_args__ = (
        CheckConstraint("quota_used_bytes >= 0", name="ck_user_quota_used_non_negative"),
    )


class AllowedEmail(Base):
    """Invite-only allowlist. Only these addresses may provision an account."""

    __tablename__ = "allowed_emails"

    email: Mapped[str] = mapped_column(String(320), primary_key=True)
    invited_by: Mapped[str | None] = mapped_column(
        String(255), ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    invited_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    note: Mapped[str | None] = mapped_column(String(255), default=None)


class Project(Base):
    """A LaTeX project owned by one user and shared with collaborators."""

    __tablename__ = "projects"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    owner_id: Mapped[str] = mapped_column(
        String(255), ForeignKey("users.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, default=None)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    last_compiled_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    owner: Mapped["User"] = relationship(back_populates="owned_projects", foreign_keys=[owner_id])
    members: Mapped[list["ProjectMember"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    files: Mapped[list["File"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    compile_jobs: Mapped[list["CompileJob"]] = relationship(back_populates="project")

    __table_args__ = (
        Index("idx_project_owner", "owner_id"),
        Index("idx_project_created_at", "created_at"),
        Index("idx_project_owner_updated", "owner_id", "updated_at"),
        CheckConstraint("size_bytes >= 0", name="ck_project_size_non_negative"),
    )


class ProjectMember(Base):
    """A user's role on a project."""

    __tablename__ = "project_members"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column(
        String(255), ForeignKey("users.id", ondelete="CASCADE")
    )
    role: Mapped[Role] = mapped_column(
        Enum(Role, name="project_role", values_callable=_persist_names)
    )
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    added_by: Mapped[str | None] = mapped_column(
        String(255), ForeignKey("users.id", ondelete="SET NULL"), default=None
    )

    project: Mapped["Project"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(
        back_populates="project_memberships", foreign_keys=[user_id]
    )

    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_user"),
        Index("idx_project_member_project", "project_id"),
        Index("idx_project_member_user", "user_id"),
    )


class File(Base):
    """
    A file inside a project.

    Text files keep their content inline; binaries live in object storage and
    are addressed by `storage_key`.
    """

    __tablename__ = "files"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    path: Mapped[str] = mapped_column(String(512))  # relative path within project
    type: Mapped[str] = mapped_column(String(16))  # tex, bib, png, pdf, ...
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    hash: Mapped[str] = mapped_column(String(64))  # SHA256, for deduplication
    storage_key: Mapped[str | None] = mapped_column(String(1024), default=None)
    content: Mapped[str | None] = mapped_column(Text, default=None)
    yjs_state: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    project: Mapped["Project"] = relationship(back_populates="files")

    __table_args__ = (
        UniqueConstraint("project_id", "path", name="uq_project_file"),
        Index("idx_file_project", "project_id"),
        Index("idx_file_hash", "hash"),
        Index("idx_file_project_path", "project_id", "path"),
        CheckConstraint("size_bytes >= 0", name="ck_file_size_non_negative"),
    )


class CompileJob(Base):
    """History and state of one compilation."""

    __tablename__ = "compile_jobs"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column(
        String(255), ForeignKey("users.id", ondelete="CASCADE")
    )
    status: Mapped[CompileStatus] = mapped_column(
        Enum(CompileStatus, name="compile_status", values_callable=_persist_names),
        default=CompileStatus.QUEUED,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    compile_time: Mapped[float | None] = mapped_column(Float, default=None)
    pdf_storage_key: Mapped[str | None] = mapped_column(String(1024), default=None)
    log_storage_key: Mapped[str | None] = mapped_column(String(1024), default=None)
    error_message: Mapped[str | None] = mapped_column(Text, default=None)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    warning_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    project: Mapped["Project"] = relationship(back_populates="compile_jobs")
    user: Mapped["User"] = relationship(back_populates="compile_jobs")

    __table_args__ = (
        Index("idx_compile_job_project", "project_id"),
        Index("idx_compile_job_user", "user_id"),
        Index("idx_compile_job_status", "status"),
        Index("idx_compile_job_created_at", "created_at"),
    )


class Snapshot(Base):
    """A point-in-time manifest of a project's files."""

    __tablename__ = "snapshots"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    name: Mapped[str | None] = mapped_column(String(255), default=None)
    created_by: Mapped[str] = mapped_column(
        String(255), ForeignKey("users.id", ondelete="CASCADE")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    manifest: Mapped[dict[str, Any]] = mapped_column(JSON)  # [{path, hash, size}, ...]

    __table_args__ = (
        Index("idx_snapshot_project", "project_id"),
        Index("idx_snapshot_created_at", "created_at"),
    )


class AuditLog(Base):
    """
    Audit trail of important actions.

    `metadata` is a reserved attribute name on declarative classes, so the
    column is exposed as `event_metadata` in Python while keeping its database
    name as `metadata`.
    """

    __tablename__ = "audit_logs"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[str | None] = mapped_column(
        String(255), ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    action: Mapped[AuditAction] = mapped_column(
        Enum(AuditAction, name="audit_action", values_callable=_persist_names)
    )
    resource_type: Mapped[str | None] = mapped_column(String(64), default=None)
    resource_id: Mapped[str | None] = mapped_column(String(64), default=None)
    event_metadata: Mapped[dict[str, Any] | None] = mapped_column(
        "metadata", JSON, default=None
    )
    ip_address: Mapped[str | None] = mapped_column(String(64), default=None)
    user_agent: Mapped[str | None] = mapped_column(String(512), default=None)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    user: Mapped[Optional["User"]] = relationship(back_populates="audit_logs")

    __table_args__ = (
        Index("idx_audit_log_user", "user_id"),
        Index("idx_audit_log_action", "action"),
        Index("idx_audit_log_timestamp", "timestamp"),
        Index("idx_audit_log_resource", "resource_type", "resource_id"),
    )
