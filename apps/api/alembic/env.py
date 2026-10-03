"""
Alembic environment configuration.

Runs migrations asynchronously through the same engine settings the app uses,
so a migration cannot succeed against a URL the application cannot reach.
"""

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context
from app.config import settings
from app.db import models  # noqa: F401  (registers tables on Base.metadata)
from app.db.base import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Always migrate with the async driver; a sync URL would silently use a driver
# the application itself never uses.
config.set_main_option("sqlalchemy.url", settings.sqlalchemy_database_url)


def _include_object(object_, name, type_, reflected, compare_to) -> bool:  # noqa: ANN001
    """Keep Alembic focused on tables this app owns."""
    if type_ == "table" and name in {"alembic_version", "spatial_ref_sys"}:
        return False
    return True


def _migration_context(connection: Connection | None = None, **kwargs) -> None:  # noqa: ANN003
    """Shared configuration for offline and online modes."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=_include_object,
        compare_type=True,
        compare_server_default=True,
        # Server defaults keep the schema valid for rows inserted outside the app.
        render_as_batch=connection is not None and connection.dialect.name == "sqlite",
        **kwargs,
    )


def run_migrations_offline() -> None:
    """Emit SQL to stdout without connecting to a database."""
    _migration_context(
        url=config.get_main_option("sqlalchemy.url"),
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Run migrations on an established connection."""
    _migration_context(connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Connect asynchronously and run migrations."""
    connectable = create_async_engine(
        config.get_main_option("sqlalchemy.url"),
        poolclass=pool.NullPool,
        echo=settings.DB_ECHO,
    )
    try:
        async with connectable.connect() as connection:
            await connection.run_sync(do_run_migrations)
    finally:
        await connectable.dispose()


def run_migrations_online() -> None:
    """Entry point for online mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
