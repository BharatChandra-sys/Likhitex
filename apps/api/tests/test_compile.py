"""
Compile endpoint tests.

The compile route requires authentication and a Docker image, so these tests
cover request validation and the auth boundary directly, and only exercise the
full container path when the image is present.
"""

import shutil
import subprocess

import pytest

from app.compile.backend import get_compile_backend
from app.compile.routes import CompileRequest

TEX = "\\documentclass{article}\n\\begin{document}\nHello, World!\n\\end{document}"

IMAGE = "likhitex-compiler"


def compiler_image_available() -> bool:
    """True when the Docker CLI is installed and the image exists."""
    if shutil.which("docker") is None:
        return False
    try:
        result = subprocess.run(
            ["docker", "images", "-q", IMAGE],
            capture_output=True,
            timeout=15,
        )
    except (subprocess.SubprocessError, OSError):
        return False
    return bool(result.stdout.strip())


requires_image = pytest.mark.skipif(
    not compiler_image_available(),
    reason=f"Docker image '{IMAGE}' not available",
)


# --- Authentication boundary -------------------------------------------------


def test_compile_requires_authentication(client):
    """An anonymous caller must not be able to spend compile capacity."""
    response = client.post("/api/compile/", json={"files": {"main.tex": TEX}})

    assert response.status_code == 401
    assert response.json()["error"] == "unauthorized"


def test_compile_rejects_malformed_token(client):
    """A bearer token that cannot be verified must not authenticate."""
    response = client.post(
        "/api/compile/",
        json={"files": {"main.tex": TEX}},
        headers={"Authorization": "Bearer clearly.not.a.jwt"},
    )

    assert response.status_code in (401, 503)


# --- Request validation ------------------------------------------------------


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        ({}, "missing files"),
        ({"files": {}}, "empty file map"),
        ({"files": {"readme.md": "# hello"}}, "no .tex file present"),
        ({"files": {"../escape.tex": TEX}}, "path traversal"),
        ({"files": {"/etc/passwd": TEX}}, "absolute path"),
        ({"files": {"..\\escape.tex": TEX}}, "backslash separator"),
        ({"files": {"main.tex": TEX}, "surprise": 1}, "unknown field"),
        ({"files": {f"f{i}.tex": TEX for i in range(200)}}, "too many files"),
        ({"files": {"main.tex": "A" * (3 * 1024 * 1024)}}, "input over the byte cap"),
    ],
)
def test_compile_rejects_bad_requests(body, reason):
    """Malformed compile payloads are refused during validation."""
    with pytest.raises(ValueError):
        CompileRequest.model_validate(body)


def test_compile_accepts_valid_request():
    """A well-formed request passes validation."""
    request = CompileRequest.model_validate({"files": {"main.tex": TEX}})

    assert request.files["main.tex"] == TEX
    assert request.main is None


def test_compile_backend_factory():
    """The local backend is constructible from configuration."""
    backend = get_compile_backend("local")

    assert backend.image
    assert backend.timeout > 0
    assert "--network" in backend._docker_argv()
    assert "none" in backend._docker_argv()


def test_compile_backend_rejects_unknown_name():
    """An unknown backend name is a configuration error."""
    with pytest.raises(ValueError):
        get_compile_backend("nonsense")


# --- Health ------------------------------------------------------------------


def test_compile_health_endpoint(client):
    """The backend probe answers without authentication."""
    response = client.get("/api/compile/health")

    assert response.status_code == 200
    body = response.json()
    assert "status" in body
    assert "backend" in body

    if body["status"] == "healthy":
        assert body["backend"] == "local"


# --- Full container path -----------------------------------------------------


@requires_image
def test_compile_simple_document(authed_client):
    """A minimal document compiles to a PDF."""
    response = authed_client.post("/api/compile/", json={"files": {"main.tex": TEX}})

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["pdf"]
    assert data["compile_time"] > 0


@requires_image
def test_compile_with_bib(authed_client):
    """BibTeX sources compile alongside the main document."""
    response = authed_client.post(
        "/api/compile/",
        json={
            "files": {
                "main.tex": (
                    "\\documentclass{article}\n\\begin{document}\n"
                    "Hello World \\cite{test}\n"
                    "\\bibliographystyle{plain}\n\\bibliography{refs}\n"
                    "\\end{document}"
                ),
                "refs.bib": (
                    "@article{test,\n  title={Test Article},\n"
                    "  author={Author},\n  year={2024}\n}\n"
                ),
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["success"] is True


@requires_image
def test_compile_reports_latex_errors(authed_client):
    """A bad command fails compilation but still returns structured detail."""
    response = authed_client.post(
        "/api/compile/",
        json={
            "files": {
                "main.tex": (
                    "\\documentclass{article}\n\\begin{document}\n"
                    "\\badcommand\n\\end{document}"
                )
            }
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert data["errors"] or data["error"]


@pytest.mark.slow
@requires_image
def test_compile_large_document(authed_client):
    """A long document still compiles within the timeout."""
    body = "\\documentclass{article}\n\\begin{document}\n"
    body += "".join(f"Section {i}\\\\\n" for i in range(100))
    body += "\\end{document}"

    response = authed_client.post("/api/compile/", json={"files": {"main.tex": body}})

    assert response.status_code == 200
    assert response.json()["success"] is True
