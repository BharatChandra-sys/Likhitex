"""initial schema

Revision ID: 001
Revises: 
Create Date: 2026-10-03 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enums
    role_enum = postgresql.ENUM('OWNER', 'EDITOR', 'VIEWER', name='role')
    compile_status_enum = postgresql.ENUM('QUEUED', 'COMPILING', 'COMPLETED', 'FAILED', 'TIMEOUT', name='compilestatus')
    audit_action_enum = postgresql.ENUM(
        'USER_LOGIN', 'USER_LOGOUT', 'PROJECT_CREATE', 'PROJECT_DELETE',
        'PROJECT_SHARE', 'PROJECT_UNSHARE', 'FILE_UPLOAD', 'FILE_DELETE',
        'COMPILE_START', 'COMPILE_COMPLETE',
        name='auditaction'
    )
    
    role_enum.create(op.get_bind())
    compile_status_enum.create(op.get_bind())
    audit_action_enum.create(op.get_bind())
    
    # Users table
    op.create_table(
        'users',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('email', sa.String(), nullable=False),
        sa.Column('full_name', sa.String(), nullable=True),
        sa.Column('quota_used_bytes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_blocked', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('last_login_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_user_email', 'users', ['email'], unique=True)
    op.create_index('idx_user_created_at', 'users', ['created_at'])
    
    # Allowed emails table
    op.create_table(
        'allowed_emails',
        sa.Column('email', sa.String(), nullable=False),
        sa.Column('invited_by', sa.String(), nullable=True),
        sa.Column('invited_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('note', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['invited_by'], ['users.id']),
        sa.PrimaryKeyConstraint('email')
    )
    
    # Projects table
    op.create_table(
        'projects',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('owner_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('size_bytes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('last_compiled_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_project_owner', 'projects', ['owner_id'])
    op.create_index('idx_project_created_at', 'projects', ['created_at'])
    op.create_index('idx_project_updated_at', 'projects', ['updated_at'])
    
    # Project members table
    op.create_table(
        'project_members',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('role', role_enum, nullable=False),
        sa.Column('added_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('added_by', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['added_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'user_id', name='uq_project_user')
    )
    op.create_index('idx_project_member_project', 'project_members', ['project_id'])
    op.create_index('idx_project_member_user', 'project_members', ['user_id'])
    
    # Files table
    op.create_table(
        'files',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('path', sa.String(), nullable=False),
        sa.Column('type', sa.String(), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('hash', sa.String(), nullable=False),
        sa.Column('storage_key', sa.String(), nullable=True),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('yjs_state', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'path', name='uq_project_file')
    )
    op.create_index('idx_file_project', 'files', ['project_id'])
    op.create_index('idx_file_hash', 'files', ['hash'])
    op.create_index('idx_file_updated_at', 'files', ['updated_at'])
    
    # Compile jobs table
    op.create_table(
        'compile_jobs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('status', compile_status_enum, nullable=False, server_default='QUEUED'),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('compile_time', sa.Float(), nullable=True),
        sa.Column('pdf_storage_key', sa.String(), nullable=True),
        sa.Column('log_storage_key', sa.String(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('error_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('warning_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_compile_job_project', 'compile_jobs', ['project_id'])
    op.create_index('idx_compile_job_user', 'compile_jobs', ['user_id'])
    op.create_index('idx_compile_job_status', 'compile_jobs', ['status'])
    op.create_index('idx_compile_job_created_at', 'compile_jobs', ['created_at'])
    
    # Snapshots table
    op.create_table(
        'snapshots',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(), nullable=True),
        sa.Column('created_by', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('manifest', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_snapshot_project', 'snapshots', ['project_id'])
    op.create_index('idx_snapshot_created_at', 'snapshots', ['created_at'])
    
    # Audit logs table
    op.create_table(
        'audit_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', sa.String(), nullable=True),
        sa.Column('action', audit_action_enum, nullable=False),
        sa.Column('resource_type', sa.String(), nullable=True),
        sa.Column('resource_id', sa.String(), nullable=True),
        sa.Column('metadata', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('ip_address', sa.String(), nullable=True),
        sa.Column('user_agent', sa.String(), nullable=True),
        sa.Column('timestamp', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_audit_log_user', 'audit_logs', ['user_id'])
    op.create_index('idx_audit_log_action', 'audit_logs', ['action'])
    op.create_index('idx_audit_log_timestamp', 'audit_logs', ['timestamp'])
    op.create_index('idx_audit_log_resource', 'audit_logs', ['resource_type', 'resource_id'])


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_index('idx_audit_log_resource', table_name='audit_logs')
    op.drop_index('idx_audit_log_timestamp', table_name='audit_logs')
    op.drop_index('idx_audit_log_action', table_name='audit_logs')
    op.drop_index('idx_audit_log_user', table_name='audit_logs')
    op.drop_table('audit_logs')
    
    op.drop_index('idx_snapshot_created_at', table_name='snapshots')
    op.drop_index('idx_snapshot_project', table_name='snapshots')
    op.drop_table('snapshots')
    
    op.drop_index('idx_compile_job_created_at', table_name='compile_jobs')
    op.drop_index('idx_compile_job_status', table_name='compile_jobs')
    op.drop_index('idx_compile_job_user', table_name='compile_jobs')
    op.drop_index('idx_compile_job_project', table_name='compile_jobs')
    op.drop_table('compile_jobs')
    
    op.drop_index('idx_file_updated_at', table_name='files')
    op.drop_index('idx_file_hash', table_name='files')
    op.drop_index('idx_file_project', table_name='files')
    op.drop_table('files')
    
    op.drop_index('idx_project_member_user', table_name='project_members')
    op.drop_index('idx_project_member_project', table_name='project_members')
    op.drop_table('project_members')
    
    op.drop_index('idx_project_updated_at', table_name='projects')
    op.drop_index('idx_project_created_at', table_name='projects')
    op.drop_index('idx_project_owner', table_name='projects')
    op.drop_table('projects')
    
    op.drop_table('allowed_emails')
    
    op.drop_index('idx_user_created_at', table_name='users')
    op.drop_index('idx_user_email', table_name='users')
    op.drop_table('users')
    
    # Drop enums
    op.execute('DROP TYPE auditaction')
    op.execute('DROP TYPE compilestatus')
    op.execute('DROP TYPE role')
