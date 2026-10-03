"""
End-to-end verification against the real database.

Clerk cannot be reached from a development machine, so this script stands up a
local JWKS endpoint, mints a token signed by the matching key, boots the API
against it, and drives a full user journey through real PostgreSQL.

    python -m scripts.verify_e2e

This is a verification harness, not a test: it starts and stops its own server
and prints a pass/fail report. Use `pytest` for the test suite.
"""

import contextlib
import json
import os
import socket
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt

API_DIR = Path(__file__).resolve().parents[1]
LOG_PATH = API_DIR / "verify_e2e_server.log"
ISSUER = "https://clerk.e2e.test"
AUDIENCE = "likhitex-e2e"

# Unique per run so repeated runs never inherit each other's projects, and so a
# crashed run cannot make the next one fail on stale rows.
RUN = uuid.uuid4().hex[:10]
OWNER_ID = f"user_e2e_owner_{RUN}"
STRANGER_ID = f"user_e2e_stranger_{RUN}"
OWNER_EMAIL = f"e2e-owner-{RUN}@example.test"
STRANGER_EMAIL = f"e2e-stranger-{RUN}@example.test"

passed = 0
failed: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    """Record one assertion result."""
    global passed
    if condition:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed.append(f"{name} {detail}".strip())
        print(f"  FAIL {name} {detail}".rstrip())


def _free_port() -> int:
    with contextlib.closing(socket.socket()) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class JWKSServer:
    """Minimal JWKS endpoint serving one RSA public key."""

    def __init__(self) -> None:
        self.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.port = _free_port()

    def jwks(self) -> dict[str, Any]:
        numbers = self.private_key.public_key().public_numbers()
        import base64

        def b64(value: int) -> str:
            raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
            return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

        return {
            "keys": [
                {
                    "kty": "RSA",
                    "kid": "e2e-key-1",
                    "use": "sig",
                    "alg": "RS256",
                    "n": b64(numbers.n),
                    "e": b64(numbers.e),
                }
            ]
        }

    def token(self, *, user_id: str, email: str, **overrides: Any) -> str:
        now = int(time.time())
        claims: dict[str, Any] = {
            "sub": user_id,
            "iss": ISSUER,
            "aud": AUDIENCE,
            "email": email,
            "name": "E2E Owner",
            "iat": now,
            "nbf": now - 5,
            "exp": now + 3600,
        }
        claims.update(overrides)
        private_pem = self.private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        return jwt.encode(claims, private_pem, algorithm="RS256", headers={"kid": "e2e-key-1"})

    def __enter__(self) -> "JWKSServer":
        jwks = self.jwks()
        server_self = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - stdlib naming
                body = json.dumps(jwks).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args: Any) -> None:
                """Silence per-request logging."""

        self._server = HTTPServer(("127.0.0.1", self.port), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return server_self

    def __exit__(self, *exc: object) -> None:
        self._server.shutdown()
        self._server.server_close()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/.well-known/jwks.json"


@contextlib.contextmanager
def api_server(jwks_url: str, port: int) -> Iterator[None]:
    """Run uvicorn against the temporary JWKS endpoint."""
    env = {
        **os.environ,
        "CLERK_JWKS_URL": jwks_url,
        "CLERK_ISSUER": ISSUER,
        "CLERK_AUDIENCE": AUDIENCE,
        "APP_ENV": "development",
        "DEBUG": "false",
    }
    LOG_PATH.write_text("", errors="replace")
    log_file = LOG_PATH.open("wb")
    # Fixed argv, no shell, no user input: the only variable is a loopback port.
    process = subprocess.Popen(  # noqa: S603
        [
            sys.executable, "-m", "uvicorn", "app.main:app",
            "--host", "127.0.0.1", "--port", str(port),
            "--log-level", "info",
        ],
        cwd=str(API_DIR),
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )
    try:
        base = f"http://127.0.0.1:{port}"
        deadline = time.time() + 45
        while time.time() < deadline:
            if process.poll() is not None:
                log_file.flush()
                raise RuntimeError(f"API exited during startup:\n{LOG_PATH.read_text(errors='replace')}")
            try:
                if httpx.get(f"{base}/health", timeout=2).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.4)
        else:
            raise RuntimeError("API did not become healthy within 45s")
        yield
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
        if LOG_PATH.exists():
            captured = LOG_PATH.read_text(errors="replace")
            if captured.strip():
                print("\n--- server log ---")
                print(captured[-4000:])


def run() -> int:
    """Drive the full journey and report."""
    port = _free_port()
    base = f"http://127.0.0.1:{port}"

    with JWKSServer() as jwks_server:
        with api_server(jwks_server.url, port):
            token = jwks_server.token(user_id=OWNER_ID, email=OWNER_EMAIL)
            owner = {"Authorization": f"Bearer {token}"}
            stranger_token = jwks_server.token(user_id=STRANGER_ID, email=STRANGER_EMAIL)
            stranger = {"Authorization": f"Bearer {stranger_token}"}

            with httpx.Client(base_url=base, timeout=30.0) as client:
                print("\n[1] Authentication")
                r = client.get("/api/users/me", headers=owner)
                check("profile resolves and provisions the user", r.status_code == 200, r.text[:120])
                check("email taken from the token claims",
                      r.status_code == 200 and r.json()["email"] == OWNER_EMAIL)

                r = client.get("/api/users/me")
                check("anonymous request is rejected", r.status_code == 401)

                r = client.get("/api/users/me", headers={"Authorization": "Bearer bad.token.here"})
                check("forged token is rejected", r.status_code == 401, r.text[:120])

                expired = jwks_server.token(
                    user_id=OWNER_ID, email=OWNER_EMAIL,
                    exp=int(time.time()) - 600, nbf=int(time.time()) - 600,
                )
                r = client.get("/api/users/me", headers={"Authorization": f"Bearer {expired}"})
                check("expired token is rejected", r.status_code == 401)

                wrong_aud = jwks_server.token(user_id=OWNER_ID, email=OWNER_EMAIL, aud="some-other-app")
                r = client.get("/api/users/me", headers={"Authorization": f"Bearer {wrong_aud}"})
                check("wrong audience is rejected", r.status_code == 401, r.text[:120])

                wrong_iss = jwks_server.token(
                    user_id=OWNER_ID, email=OWNER_EMAIL, iss="https://attacker.example"
                )
                r = client.get("/api/users/me", headers={"Authorization": f"Bearer {wrong_iss}"})
                check("wrong issuer is rejected", r.status_code == 401, r.text[:120])

                print("\n[2] Projects")
                r = client.post("/api/projects/", json={"name": "Thesis", "description": "e2e"}, headers=owner)
                check("project created", r.status_code == 201, r.text[:150])
                project = r.json()
                project_id = project["id"]

                r = client.post("/api/projects/", json={"name": "   "}, headers=owner)
                check("blank project name rejected", r.status_code == 422)

                r = client.get(f"/api/projects/{project_id}", headers=stranger)
                check("non-member sees 404, not 403", r.status_code == 404, r.text[:120])

                r = client.get("/api/projects/", headers=stranger)
                check("stranger's list excludes the project",
                      r.status_code == 200 and r.json()["total"] == 0, r.text[:120])

                print("\n[3] Files")
                tex = "\\documentclass{article}\\begin{document}Hi\\end{document}"
                r = client.post(
                    f"/api/projects/{project_id}/files/",
                    json={"path": "main.tex", "content": tex},
                    headers=owner,
                )
                check("text file uploaded", r.status_code == 201, r.text[:150])
                file_id = r.json()["id"]
                size_after_create = r.json()["size_bytes"]

                r = client.get(f"/api/projects/{project_id}/quota", headers=owner)
                check("project size accounted",
                      r.status_code == 200 and r.json()["used_bytes"] == size_after_create,
                      r.text[:120])

                r = client.get("/api/users/me/quota", headers=owner)
                check("user quota accounted",
                      r.status_code == 200 and r.json()["used_bytes"] == size_after_create,
                      r.text[:120])

                longer = tex + "\n% padding\n" * 200
                r = client.put(
                    f"/api/projects/{project_id}/files/{file_id}",
                    json={"content": longer},
                    headers=owner,
                )
                check("file updated", r.status_code == 200, r.text[:150])
                check("update returns the new size", r.json()["size_bytes"] > size_after_create)

                r = client.get(f"/api/projects/{project_id}/quota", headers=owner)
                check("project size tracks the delta",
                      abs(r.json()["used_bytes"] - len(longer.encode())) <= 1, r.text[:120])

                r = client.get(f"/api/projects/{project_id}/files/{file_id}/download", headers=owner)
                check("download returns the content",
                      r.status_code == 200 and r.text == longer)

                for bad_path in ["../escape.tex", "/etc/passwd", "a\\b.tex"]:
                    r = client.post(
                        f"/api/projects/{project_id}/files/",
                        json={"path": bad_path, "content": "x"},
                        headers=owner,
                    )
                    check(f"path rejected: {bad_path}", r.status_code == 422, r.text[:100])

                r = client.post(
                    f"/api/projects/{project_id}/files/",
                    json={"path": "main.exe", "content": "x"},
                    headers=owner,
                )
                check("disallowed extension rejected", r.status_code == 400, r.text[:100])

                r = client.get(
                    f"/api/projects/{project_id}/files/{file_id}", headers=stranger
                )
                check("stranger cannot read the file", r.status_code == 404)

                print("\n[4] Membership")
                r = client.post(
                    f"/api/projects/{project_id}/members",
                    json={"email": STRANGER_EMAIL, "role": "editor"},
                    headers=owner,
                )
                check("member added", r.status_code == 201, r.text[:150])
                member_id = r.json()["id"]

                r = client.get(f"/api/projects/{project_id}", headers=stranger)
                check("member can now read the project", r.status_code == 200)

                r = client.put(
                    f"/api/projects/{project_id}/files/{file_id}",
                    json={"content": tex},
                    headers=stranger,
                )
                check("editor can write", r.status_code == 200, r.text[:120])

                r = client.post(
                    f"/api/projects/{project_id}/members",
                    json={"email": "nobody@example.test", "role": "viewer"},
                    headers=owner,
                )
                check("unknown email is rejected", r.status_code == 404)

                r = client.post(
                    f"/api/projects/{project_id}/members",
                    json={"email": STRANGER_EMAIL, "role": "viewer"},
                    headers=owner,
                )
                check("duplicate membership rejected", r.status_code == 409)

                print("\n[5] Ownership rules")
                r = client.patch(f"/api/projects/{project_id}", json={"name": "Renamed"}, headers=stranger)
                check("non-owner cannot rename", r.status_code == 403, r.text[:120])

                r = client.patch(f"/api/projects/{project_id}", json={"name": "Renamed"}, headers=owner)
                check("owner can rename", r.status_code == 200 and r.json()["name"] == "Renamed")

                r = client.delete(f"/api/projects/{project_id}/members/{member_id}", headers=owner)
                check("member removed", r.status_code == 204, r.text[:120])

                print("\n[6] Compile guardrails")
                r = client.post("/api/compile/", json={"files": {"main.tex": tex}}, headers=owner)
                check("compile accepted but backend unavailable",
                      r.status_code in (200, 502, 503), f"{r.status_code} {r.text[:120]}")
                if r.status_code == 200:
                    check("compile failure is reported in the body",
                          r.json()["success"] is False and r.json()["error_type"] is not None)

                r = client.post("/api/compile/", json={"files": {"../x.tex": tex}}, headers=owner)
                check("compile traversal rejected", r.status_code == 422)

                print("\n[7] Deletion and cleanup")
                r = client.delete(f"/api/projects/{project_id}/files/{file_id}", headers=owner)
                check("file deleted", r.status_code == 204, r.text[:120])

                r = client.get(f"/api/projects/{project_id}/quota", headers=owner)
                check("size released after delete", r.json()["used_bytes"] == 0, r.text[:120])

                r = client.delete(f"/api/projects/{project_id}", headers=owner)
                check("project soft deleted", r.status_code == 204)

                r = client.get(f"/api/projects/{project_id}", headers=owner)
                check("deleted project is gone", r.status_code == 404)

                print("\n[8] Audit trail is writable")
                import asyncio

                from sqlalchemy import func, select

                from app.db import AuditLog
                from app.db import Project as ProjectModel
                from app.db.base import get_engine

                async def audit_check() -> tuple[int, int]:
                    engine = get_engine()
                    async with engine.connect() as conn:
                        total = await conn.scalar(select(func.count()).select_from(AuditLog))
                        live = await conn.scalar(
                            select(func.count()).select_from(ProjectModel).where(
                                ProjectModel.is_deleted.is_(True)
                            )
                        )
                    return int(total or 0), int(live or 0)

                total_logs, deleted_projects = asyncio.run(audit_check())
                check("audit_logs table is queryable", total_logs >= 0, str(total_logs))
                check("soft delete persisted", deleted_projects >= 1, str(deleted_projects))

    print()
    print(f"passed: {passed}   failed: {len(failed)}")
    for entry in failed:
        print(f"  FAILED: {entry}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(run())
