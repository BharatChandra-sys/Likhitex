"""
Database models for Likhitex.
"""
import enum
from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, ForeignKey, Index, Integer,
    JSON, String, Text, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class Role(str, enum.Enum):
    """Project member roles."""
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


class CompileStatus(str, enum.Enum):
    """Compile job statuses."""
    QUEUED = "queued"
    COMPILING = "compiling"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"


class AuditAction(str, enum.Enum):
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
    """
    User model.
    Uses Clerk user ID as primary key for direct mapping.
    """
    __tablename__ = "users"
    
    id = Column(String, primary_key=True)  # Clerk user ID (sub claim)
    email = Column(String, unique=True, nullable=False, index=True)
    full_name = Column(String, nullable=True)
    quota_used_bytes = Column(Integer, default=0, nullable=False)
    is_blocked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    last_login_at = Column(DateTime, nullable=True)
    
    # Relationships
    owned_projects = relationship("Project", back_populates="owner", foreign_keys="Project.owner_id")
    project_memberships = relationship("ProjectMember", back_populates="user")
    compile_jobs = relationship("CompileJob", back_populates="user")
    audit_logs = relationship("AuditLog", back_populates="user")
    
    __table_args__ = (
        Index("idx_user_email", "email"),
        Index("idx_user_created_at", "created_at"),
    )


class AllowedEmail(Base):
    """
    Invite-only allowlist.
    Only emails in this table can sign up.
    """
    __tablename__ = "allowed_emails"
    
    email = Column(String, primary_key=True)
    invited_by = Column(String, ForeignKey("users.id"), nullable=True)
    invited_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    note = Column(String, nullable=True)


class Project(Base):
    """
    LaTeX project.
    Contains multiple files and can be shared with collaborators.
    """
    __tablename__ = "projects"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    size_bytes = Column(Integer, default=0, nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    last_compiled_at = Column(DateTime, nullable=True)
    
    # Relationships
    owner = relationship("User", back_populates="owned_projects", foreign_keys=[owner_id])
    members = relationship("ProjectMember", back_populates="project")
    files = relationship("File", back_populates="project")
    compile_jobs = relationship("CompileJob", back_populates="project")
    
    __table_args__ = (
        Index("idx_project_owner", "owner_id"),
        Index("idx_project_created_at", "created_at"),
        Index("idx_project_updated_at", "updated_at"),
    )


class ProjectMember(Base):
    """
    Project collaborators with roles.
    """
    __tablename__ = "project_members"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    role = Column(Enum(Role), nullable=False)
    added_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    added_by = Column(String, ForeignKey("users.id"), nullable=True)
    
    # Relationships
    project = relationship("Project", back_populates="members")
    user = relationship("User", back_populates="project_memberships", foreign_keys=[user_id])
    
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_user"),
        Index("idx_project_member_project", "project_id"),
        Index("idx_project_member_user", "user_id"),
    )


class File(Base):
    """
    File in a project (LaTeX source, images, etc.).
    Text files stored inline, binaries stored in R2.
    """
    __tablename__ = "files"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    path = Column(String, nullable=False)  # Relative path within project
    type = Column(String, nullable=False)  # tex, bib, png, pdf, etc.
    size_bytes = Column(Integer, nullable=False)
    hash = Column(String, nullable=False)  # SHA256 for deduplication
    storage_key = Column(String, nullable=True)  # R2 object key (null for inline)
    content = Column(Text, nullable=True)  # Inline content for text files
    yjs_state = Column(JSON, nullable=True)  # Yjs CRDT state for collaborative editing
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    project = relationship("Project", back_populates="files")
    
    __table_args__ = (
        UniqueConstraint("project_id", "path", name="uq_project_file"),
        Index("idx_file_project", "project_id"),
        Index("idx_file_hash", "hash"),  # For deduplication
        Index("idx_file_updated_at", "updated_at"),
    )


class CompileJob(Base):
    """
    Compile job history and queue.
    """
    __tablename__ = "compile_jobs"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    status = Column(Enum(CompileStatus), nullable=False, default=CompileStatus.QUEUED)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    compile_time = Column(Float, nullable=True)  # Seconds
    pdf_storage_key = Column(String, nullable=True)  # R2 key for output PDF
    log_storage_key = Column(String, nullable=True)  # R2 key for log
    error_message = Column(Text, nullable=True)
    error_count = Column(Integer, default=0)
    warning_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relationships
    project = relationship("Project", back_populates="compile_jobs")
    user = relationship("User", back_populates="compile_jobs")
    
    __table_args__ = (
        Index("idx_compile_job_project", "project_id"),
        Index("idx_compile_job_user", "user_id"),
        Index("idx_compile_job_status", "status"),
        Index("idx_compile_job_created_at", "created_at"),
    )


class Snapshot(Base):
    """
    Project version snapshot (manual or automatic).
    """
    __tablename__ = "snapshots"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=True)  # User-provided name
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    manifest = Column(JSON, nullable=False)  # List of {path, hash, size}
    
    __table_args__ = (
        Index("idx_snapshot_project", "project_id"),
        Index("idx_snapshot_created_at", "created_at"),
    )


class AuditLog(Base):
    """
    Audit trail of important actions.
    """
    __tablename__ = "audit_logs"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    action = Column(Enum(AuditAction), nullable=False)
    resource_type = Column(String, nullable=True)  # project, file, user
    resource_id = Column(String, nullable=True)  # UUID as string
    metadata = Column(JSON, nullable=True)  # Additional context
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    
    # Relationships
    user = relationship("User", back_populates="audit_logs")
    
    __table_args__ = (
        Index("idx_audit_log_user", "user_id"),
        Index("idx_audit_log_action", "action"),
        Index("idx_audit_log_timestamp", "timestamp"),
        Index("idx_audit_log_resource", "resource_type", "resource_id"),
    )
