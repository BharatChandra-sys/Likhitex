"""
Access-control regression tests backed by a real database session.

These cover the project routes end to end, which the SQLite-free unit tests do
not: the original defects were only reachable through a genuine ORM session
driving the permission dependency.
"""

from collections.abc import Awaitable, Callable

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import dependencies as auth_dependencies
from app.auth.dependencies import ensure_not_last_owner
from app.db.models import Project, ProjectMember, Role, User
from app.main import app

STRANGER = User(id="user_test_00000000000000000002", email="stranger@test.invalid")


WriteRows = Callable[..., Awaitable[None]]


@pytest.fixture
async def seeded(
    authed_client: TestClient,
    override_db: None,
    session: AsyncSession,
    current_user: User,
) -> WriteRows:
    """
    Persist the authenticated user and return a helper for writing rows.

    `get_db` is overridden with a session that has `autoflush=False`, so rows
    added from a test must be committed explicitly before a request can see them.
    """
    session.add(current_user)
    await session.commit()

    async def write(*rows: object) -> None:
        session.add_all(list(rows))
        await session.commit()

    return write


def _as_stranger() -> Callable[[], None]:
    """Swap the authenticated identity and return a restore callable."""

    async def _stranger() -> User:
        return STRANGER

    app.dependency_overrides[auth_dependencies.get_current_user] = _stranger

    def restore() -> None:
        app.dependency_overrides.pop(auth_dependencies.get_current_user, None)

    return restore


def test_get_project_returns_owner_details(authed_client: TestClient, seeded: WriteRows) -> None:
    """
    Regression: `project.owner` was lazy-loaded inside an async handler, which
    raises MissingGreenlet and surfaces as a hang rather than a 500.
    """
    project = authed_client.post("/api/projects/", json={"name": "Detail"}).json()

    response = authed_client.get(f"/api/projects/{project['id']}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == project["id"]
    assert body["owner"]["email"] == "owner@test.invalid"
    assert body["file_count"] == 0


def test_non_member_cannot_probe_project_existence(authed_client: TestClient, seeded: WriteRows) -> None:
    """A caller with no relationship gets 404, never 403, so IDs do not leak."""
    project = authed_client.post("/api/projects/", json={"name": "Private"}).json()

    restore = _as_stranger()
    try:
        response = authed_client.get(f"/api/projects/{project['id']}")
    finally:
        restore()

    assert response.status_code == 404, response.text
    assert response.json()["error"] == "not_found"


async def test_member_can_read_but_not_rename(authed_client: TestClient, seeded: WriteRows) -> None:
    """A granted member sees the project but may not change project metadata."""
    project = authed_client.post("/api/projects/", json={"name": "Shared"}).json()
    project_id = project["id"]

    await seeded(STRANGER)

    added = authed_client.post(
        f"/api/projects/{project_id}/members",
        json={"email": "stranger@test.invalid", "role": "editor"},
    )
    assert added.status_code == 201, added.text

    restore = _as_stranger()
    try:
        read = authed_client.get(f"/api/projects/{project_id}")
        assert read.status_code == 200, read.text
        assert read.json()["owner"]["email"] == "owner@test.invalid"

        rename = authed_client.patch(
            f"/api/projects/{project_id}", json={"name": "Hijacked"}
        )
        assert rename.status_code == 403, rename.text
    finally:
        restore()


def test_soft_deleted_project_is_invisible(authed_client: TestClient, seeded: WriteRows) -> None:
    """Deleted projects 404 for everyone, including the owner."""
    project = authed_client.post("/api/projects/", json={"name": "Doomed"}).json()
    project_id = project["id"]

    assert authed_client.delete(f"/api/projects/{project_id}").status_code == 204
    assert authed_client.get(f"/api/projects/{project_id}").status_code == 404


def test_project_owner_is_derived_not_stored(authed_client: TestClient, seeded: WriteRows) -> None:
    """
    The owner is resolved through `owner_id`, so a member row is never required
    and the owner cannot be demoted into losing access.
    """
    project = authed_client.post("/api/projects/", json={"name": "Owned"}).json()
    project_id = project["id"]

    members = authed_client.get(f"/api/projects/{project_id}/members")
    assert members.status_code == 200
    assert members.json() == []

    response = authed_client.get(f"/api/projects/{project_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["owner_id"] == "user_test_00000000000000000001"
    assert body["owner"]["email"] == "owner@test.invalid"


async def test_ensure_not_last_owner_blocks_owner_removal(session: AsyncSession) -> None:
    """Removing the only owner would orphan the project, so it is refused."""
    owner = User(id="owner_1", email="owner@x.invalid")
    project = Project(name="P", owner_id=owner.id)
    session.add_all([owner, project])
    await session.commit()

    member = ProjectMember(
        project_id=project.id,
        user_id=owner.id,
        role=Role.OWNER,
        added_by=owner.id,
    )
    session.add(member)
    await session.commit()

    with pytest.raises(HTTPException) as excinfo:
        await ensure_not_last_owner(session, project, member, Role.VIEWER)

    assert excinfo.value.status_code == 400
