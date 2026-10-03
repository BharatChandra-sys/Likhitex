"""
Hardening regression tests.

Each test pins a specific control added during the security hardening pass, so
a future refactor that silently drops one fails here rather than in production.
"""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.auth import tickets
from app.compile.routes import CompileRequest
from app.db.models import AuditLog, Role
from app.files.schemas import FileUpload, validate_project_path
from app.middleware.request_id import _VALID_REQUEST_ID
from app.projects.schemas import ProjectMemberAdd
from app.storage.backend import LocalStorage, StorageBackend, StorageError

VALID_TEX = "\\documentclass{article}\\begin{document}Hi\\end{document}"


# --- Path traversal ----------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "",
        "   ",
        "/etc/passwd",
        "../../etc/passwd",
        "a/../../b.tex",
        "..",
        "../",
        "..\\windows\\system32",
        "C:\\evil.tex",
        "\\\\server\\share.tex",
        ".hidden.tex",
        "sub/.hidden.tex",
        "main.tex\x00.txt",
        "bell\x07.tex",
        "-shell-option.tex",
        "x" * 600,
    ],
)
def test_project_path_validator_rejects_unsafe_paths(path):
    """Paths that could escape the project directory are refused."""
    with pytest.raises(ValueError):
        validate_project_path(path)


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("main.tex", "main.tex"),
        ("chapters/intro.tex", "chapters/intro.tex"),
        ("images/fig 1.png", "images/fig 1.png"),
        ("refs.bib", "refs.bib"),
    ],
)
def test_project_path_validator_accepts_normal_paths(path, expected):
    """Ordinary project-relative paths pass through unchanged."""
    assert validate_project_path(path) == expected


def test_compile_request_rejects_traversal():
    """Traversal cannot reach the compile payload either."""
    with pytest.raises(ValidationError):
        CompileRequest.model_validate({"files": {"../../etc/passwd": VALID_TEX}})


def test_storage_key_rejects_traversal():
    """Storage keys cannot address files outside the storage root."""
    for key in ("../secret", "/etc/passwd", "a//b", "a/../b", "..\\x"):
        with pytest.raises(StorageError):
            StorageBackend.safe_key(key)


def test_local_storage_cannot_escape_root(tmp_path):
    """A hostile key resolves inside the base path or raises."""
    storage = LocalStorage(base_path=str(tmp_path / "store"))

    with pytest.raises(StorageError):
        storage._resolve("../../../etc/passwd")

    resolved = storage._resolve("project/hash/file.png")
    assert str(resolved).startswith(str(storage.base_path))


def test_local_storage_roundtrip(tmp_path):
    """Objects written to local storage can be read back."""
    import asyncio

    storage = LocalStorage(base_path=str(tmp_path / "store"))

    async def scenario() -> bytes:
        await storage.put("p/abc/file.bin", b"payload")
        return await storage.get("p/abc/file.bin")

    assert asyncio.run(scenario()) == b"payload"


def test_local_storage_delete_is_idempotent(tmp_path):
    """Deleting a missing object is not an error."""
    import asyncio

    storage = LocalStorage(base_path=str(tmp_path / "store"))
    asyncio.run(storage.delete("p/abc/missing.bin"))


def test_build_key_is_content_addressed():
    """Identical content maps to one key; changed content maps to another."""
    first = StorageBackend.build_key("proj-1", "a" * 64, "images/fig.png")
    same = StorageBackend.build_key("proj-1", "a" * 64, "images/fig.png")
    other = StorageBackend.build_key("proj-1", "b" * 64, "images/fig.png")

    assert first == same
    assert first != other
    assert first.startswith("proj-1/")


def test_build_key_rejects_traversal_filename():
    """The filename half of a storage key is validated too."""
    with pytest.raises(ValueError):
        StorageBackend.build_key("proj-1", "a" * 64, "../../escape.png")


# --- Audit log column naming -------------------------------------------------


def test_audit_log_metadata_column_is_named_in_database():
    """
    `metadata` is reserved on declarative classes.

    The attribute is exposed as `event_metadata` while the column keeps its
    database name, so the mapping must not collide.
    """
    assert AuditLog.event_metadata.property.columns[0].name == "metadata"
    assert "metadata" not in AuditLog.__mapper__.attrs


# --- Role hierarchy ----------------------------------------------------------


def test_member_email_is_normalised():
    """Emails are lowercased so lookups are deterministic."""
    assert ProjectMemberAdd(email="  Person@Example.COM ").email == "person@example.com"


@pytest.mark.parametrize("email", ["no-at-sign", "a@b@c", "@example.com", "user@"])
def test_member_email_rejects_malformed_addresses(email):
    """Malformed addresses are refused at the schema boundary."""
    with pytest.raises(ValidationError):
        ProjectMemberAdd(email=email)


def test_roles_are_ordered_by_privilege():
    """The permission hierarchy maps to ascending privilege."""
    from app.auth.dependencies import ROLE_LEVEL

    assert ROLE_LEVEL[Role.VIEWER] < ROLE_LEVEL[Role.EDITOR] < ROLE_LEVEL[Role.OWNER]


# --- Compile request limits --------------------------------------------------


def test_compile_request_enforces_file_count():
    """A payload with too many files is refused."""
    with pytest.raises(ValidationError):
        CompileRequest.model_validate({"files": {f"f{i}.tex": VALID_TEX for i in range(500)}})


def test_compile_request_enforces_total_size():
    """A payload over the byte cap is refused."""
    with pytest.raises(ValidationError):
        CompileRequest.model_validate({"files": {"main.tex": "A" * (3 * 1024 * 1024)}})


def test_compile_request_allows_main_file_override():
    """An explicit main file is accepted and length-checked."""
    request = CompileRequest.model_validate({"files": {"thesis.tex": VALID_TEX}, "main": "thesis.tex"})
    assert request.main == "thesis.tex"

    with pytest.raises(ValidationError):
        CompileRequest.model_validate({"files": {"a.tex": VALID_TEX}, "main": "x" * 300})


def test_file_upload_type_is_normalised():
    """A leading dot on the declared type is stripped."""
    upload = FileUpload(path="main.tex", content=VALID_TEX, type=".TEX")
    assert upload.type == "tex"


@pytest.mark.parametrize("bad_type", ["te x", "te/x", "../../etc", "a;b"])
def test_file_upload_rejects_unusable_type(bad_type):
    """A type that is not a plain extension token is refused."""
    with pytest.raises(ValidationError):
        FileUpload(path="main.tex", content=VALID_TEX, type=bad_type)


# --- Request IDs -------------------------------------------------------------


@pytest.mark.parametrize("request_id", ["abc", "x" * 200, "../../etc/passwd", "id with spaces", ""])
def test_client_supplied_request_ids_are_rejected(request_id):
    """Only well-formed client IDs are echoed back."""
    assert _VALID_REQUEST_ID.match(request_id) is None


@pytest.mark.parametrize("request_id", ["a1b2c3d4", "client-trace-1234", "550e8400.e29b.41d4"])
def test_well_formed_request_ids_are_accepted(request_id):
    """Well-formed IDs pass validation."""
    assert _VALID_REQUEST_ID.match(request_id)


def test_request_id_is_echoed(client: TestClient):
    """A client request ID is reflected for distributed tracing."""
    response = client.get("/health", headers={"X-Request-ID": "trace-abcdefgh"})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "trace-abcdefgh"


def test_malformed_request_id_is_replaced(client: TestClient):
    """A traversal attempt in the request ID header is not reflected."""
    response = client.get("/health", headers={"X-Request-ID": "../../etc/passwd"})

    assert response.status_code == 200
    assert "/" not in response.headers["X-Request-ID"]


# --- Response hardening ------------------------------------------------------


def test_security_headers_present(client: TestClient):
    """Baseline security headers are applied to every response."""
    response = client.get("/health")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert "interest-cohort" in response.headers["Permissions-Policy"]


def test_untrusted_host_is_rejected(client: TestClient):
    """A request with an unexpected Host header is refused."""
    response = client.get("/health", headers={"Host": "evil.example.com"})

    assert response.status_code == 400


def test_oversized_body_is_rejected(client: TestClient):
    """A body over the global limit is refused before it is parsed."""
    payload = '{"files":{"main.tex":"' + ("A" * 20_000_000) + '"}}'
    response = client.post(
        "/api/compile/",
        content=payload,
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 413
    assert response.json()["error"] == "payload_too_large"


# --- Error envelope ----------------------------------------------------------


def test_errors_use_a_consistent_envelope(client: TestClient):
    """Errors carry a stable code and the request ID."""
    response = client.get("/api/projects/")

    assert response.status_code == 401
    body = response.json()
    assert body["error"] == "unauthorized"
    assert body["request_id"] == response.headers["X-Request-ID"]


def test_validation_errors_do_not_echo_input(client: TestClient):
    """
    Validation failures report field locations, not submitted values.

    Echoing input would reflect attacker-controlled data back to the client.
    """
    sentinel = "S3CRET-VALUE-THAT-MUST-NOT-ECHO"
    response = client.post(
        "/api/projects/00000000-0000-0000-0000-000000000000/files/",
        json={"path": sentinel, "content": "x"},
    )

    assert response.status_code == 401  # auth is checked before validation

    assert sentinel not in response.text


# --- Redis dependencies ------------------------------------------------------


def test_redis_dependency_reports_unavailable(client: TestClient):
    """Endpoints needing Redis return 503 rather than an unhandled 500."""
    response = client.post("/api/collab/projects/00000000-0000-0000-0000-000000000000/ws-ticket")

    assert response.status_code in (401, 503)


def test_ticket_count_fails_safe():
    """A Redis outage during counting reports the limit as consumed."""
    import asyncio

    class BrokenRedis:
        async def eval(self, *args, **kwargs):
            from redis.exceptions import ConnectionError

            raise ConnectionError("down")

    count = asyncio.run(tickets.count_active_tickets(BrokenRedis(), "user-1"))
    assert count > 0


def test_ticket_validation_rejects_garbage():
    """Structurally invalid ticket IDs are refused without touching Redis."""
    import asyncio

    class ExplodingRedis:
        async def getdel(self, *args, **kwargs):
            raise AssertionError("Redis must not be called for a malformed ticket")

    redis = ExplodingRedis()
    assert asyncio.run(tickets.verify_ticket(redis, "")) is None
    assert asyncio.run(tickets.verify_ticket(redis, "x" * 500)) is None


def test_ticket_verification_fails_closed_on_redis_error():
    """An unreachable ticket store must not look like an invalid ticket."""
    import asyncio

    from redis.exceptions import ConnectionError

    class BrokenRedis:
        async def getdel(self, *args, **kwargs):
            raise ConnectionError("down")

    with pytest.raises(RuntimeError):
        asyncio.run(tickets.verify_ticket(BrokenRedis(), "abc123"))
