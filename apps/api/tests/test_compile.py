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


# --- Sandbox configuration ---------------------------------------------------


def _flag_pairs(argv: list[str]) -> list[tuple[str, str]]:
    """
    Split a docker argv into (flag, value) pairs.

    Boolean flags pair with an empty string, and repeated flags such as the two
    `--tmpfs` mounts are kept as separate pairs so none is silently lost.
    """
    pairs: list[tuple[str, str]] = []
    for index, token in enumerate(argv):
        if not token.startswith("--"):
            continue
        following = argv[index + 1] if index + 1 < len(argv) else ""
        pairs.append((token, "" if following.startswith("--") else following))
    return pairs


def test_local_backend_pins_isolation_flags():
    """
    Every isolation control the compiler relies on is present.

    The container-level tests in `tests/security` assume this configuration.
    Pinning it here means a control cannot be dropped without a red test, even
    where Docker is unavailable to exercise the container directly.
    """
    pairs = _flag_pairs(get_compile_backend("local")._docker_argv())

    for expected in [
        ("--network", "none"),
        ("--cap-drop", "ALL"),
        ("--security-opt", "no-new-privileges"),
    ]:
        assert expected in pairs, f"missing isolation control: {expected[0]}"

    # An immutable root filesystem confines every write to the tmpfs mounts.
    assert ("--read-only", "") in pairs, "root filesystem is not read-only"

    tmpfs = [value for flag, value in pairs if flag == "--tmpfs"]
    assert len(tmpfs) == 2, f"expected two tmpfs mounts, got {tmpfs}"
    for mount in tmpfs:
        for option in ("rw", "noexec", "nosuid"):
            assert option in mount, f"{mount} is missing {option}"
        assert "size=" in mount, f"{mount} has no size ceiling"


def test_local_backend_pins_resource_ceilings():
    """One document must not be able to exhaust the API host."""
    pairs = _flag_pairs(get_compile_backend("local")._docker_argv())
    ulimits = [value for flag, value in pairs if flag == "--ulimit"]
    singles = {flag: value for flag, value in pairs if flag not in ("--tmpfs", "--ulimit")}

    assert int(singles["--pids-limit"]) > 0, "no PID ceiling"
    assert singles["--memory"], "no memory ceiling"
    # Swap is pinned equal to memory, otherwise the limit is only a soft hint
    # and the container can still exceed it.
    assert singles["--memory-swap"] == singles["--memory"], "swap allowance exceeds memory"
    assert float(singles["--cpus"]) > 0, "no CPU ceiling"

    # Both the output size and the file count are bounded, so a runaway document
    # cannot fill the tmpfs or exhaust descriptors.
    assert any(item.startswith("fsize=") for item in ulimits), "no output size ceiling"
    assert any(item.startswith("nofile=") for item in ulimits), "no descriptor ceiling"


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
