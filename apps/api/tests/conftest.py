"""
Shared pytest fixtures.

Tests run against SQLite in a temporary file and with authentication stubbed, so
the suite needs neither a live Clerk instance nor a running Redis. Networked
dependencies are deliberately not exercised here; the compiler security suite
covers those against real containers.
"""

import asyncio
import os
from collections.abc import AsyncGenerator, Iterator

import pytest

# Must be set before app.config is imported, since Settings reads env at import.
# Forward slashes are required: Path() would emit a backslash on Windows and
# produce an unparseable SQLAlchemy URL.
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "sqlite+aiosqlite:///./test_likhitex.db"
)
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("DATABASE_URL", TEST_DATABASE_URL)
os.environ.setdefault("SECRET_KEY", "test_secret_key_minimum_32_chars_long")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("INVITE_ONLY", "false")
os.environ.setdefault("CLERK_JWKS_URL", "https://clerk.test.invalid/.well-known/jwks.json")
os.environ.setdefault("CLERK_ISSUER", "https://clerk.test.invalid")
os.environ.setdefault("ALLOWED_HOSTS", "testserver,localhost,127.0.0.1")
os.environ.setdefault("LOCAL_STORAGE_PATH", "./var/test-storage")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker  # noqa: E402

from app.auth import dependencies as auth_dependencies  # noqa: E402
from app.db.base import Base, get_db, get_engine  # noqa: E402
from app.db.models import Project, User  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def event_loop():  # noqa: ANN201, ANN201
    """Session-wide event loop for async fixtures."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def engine() -> AsyncGenerator:
    """Create a fresh schema per test so tests cannot leak state."""
    test_engine = get_engine()
    async with test_engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    yield test_engine
    async with test_engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def session(engine) -> AsyncGenerator[AsyncSession, None]:
    """Yield a session bound to the per-test schema."""
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as db_session:
        yield db_session


@pytest.fixture
def override_db(session: AsyncSession):
    """Point the app's `get_db` dependency at the test session."""
    async def _get_db() -> AsyncGenerator[AsyncSession, None]:
        yield session

    app.dependency_overrides[get_db] = _get_db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def current_user() -> User:
    """A stand-in authenticated user."""
    return User(
        id="user_test_00000000000000000001",
        email="owner@test.invalid",
        full_name="Test Owner",
    )


@pytest.fixture
def other_user() -> User:
    """A second user, for access-control tests."""
    return User(
        id="user_test_00000000000000000002",
        email="other@test.invalid",
        full_name="Other User",
    )


@pytest.fixture
def project(current_user: User) -> Project:
    """A project owned by `current_user`."""
    return Project(name="Test Project", description="Fixture", owner_id=current_user.id)


@pytest.fixture
def authed_client(override_db, current_user: User) -> Iterator[TestClient]:
    """Client with authentication bypassed and a known current user."""
    async def _current_user() -> User:
        return current_user

    app.dependency_overrides[auth_dependencies.verify_clerk_token] = lambda: {
        "sub": current_user.id,
        "email": current_user.email,
        "name": current_user.full_name,
    }
    app.dependency_overrides[auth_dependencies.get_current_user] = _current_user
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(auth_dependencies.verify_clerk_token, None)
        app.dependency_overrides.pop(auth_dependencies.get_current_user, None)


@pytest.fixture
def client() -> Iterator[TestClient]:
    """Unauthenticated client (asserts 401 paths)."""
    with TestClient(app) as test_client:
        yield test_client
