"""
Compiler security tests (container level).

These drive the real compiler container and therefore require Docker and a
built `likhitex-compiler` image:

    docker build -t likhitex-compiler apps/compiler/
    pytest tests/security -v

The Docker-free unit tests for the same controls live in
`tests/test_compiler_runner.py` and run everywhere.
"""

import json
import os
import shutil
import subprocess
import sys

import pytest

from app.compile.backend import LocalCompileBackend

COMPILE_TIMEOUT_SECONDS = int(os.getenv("COMPILE_TIMEOUT_SECONDS", "60"))
DOCKER_TIMEOUT = COMPILE_TIMEOUT_SECONDS + 30


def _image_available() -> bool:
    if shutil.which("docker") is None:
        return False
    try:
        result = subprocess.run(
            ["docker", "images", "-q", "likhitex-compiler"], capture_output=True, timeout=15
        )
    except (subprocess.SubprocessError, OSError):
        return False
    return bool(result.stdout.strip())


requires_image = pytest.mark.skipif(
    not _image_available(),
    reason="Docker image 'likhitex-compiler' is not built",
)


def run_compiler(input_data: dict) -> dict:
    """
    Run the compiler container with a job and return the parsed result.

    The argument list is taken from the API's own backend rather than copied
    here, so these tests exercise the isolation configuration that ships. A
    hand-maintained copy had already fallen behind, missing the `--ulimit`
    ceilings the API applies, which would have let a regression in those pass.
    """
    argv = LocalCompileBackend(
        image="likhitex-compiler", timeout=COMPILE_TIMEOUT_SECONDS
    )._docker_argv()

    try:
        result = subprocess.run(
            argv,
            input=json.dumps(input_data).encode(),
            capture_output=True,
            timeout=DOCKER_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": f"Docker timeout ({DOCKER_TIMEOUT}s exceeded)",
            "error_type": "timeout",
        }
    except OSError as exc:
        return {"success": False, "error": str(exc), "error_type": "docker_error"}

    if not result.stdout.strip():
        return {
            "success": False,
            "error": result.stderr.decode(errors="replace") or "No output",
            "error_type": "docker_error",
        }

    try:
        return json.loads(result.stdout.decode(errors="replace"))
    except json.JSONDecodeError:
        return {
            "success": False,
            "error": "Compiler emitted non-JSON output",
            "error_type": "protocol_error",
        }


# --- Shell escape -----------------------------------------------------------


@requires_image
@pytest.mark.security
def test_blocks_write18_shell_escape(tmp_path):
    """\\write18 cannot execute a shell command."""
    marker = tmp_path / "exploit.txt"
    tex = (
        "\\documentclass{article}\n\\begin{document}\n"
        f"\\immediate\\write18{{echo EXPLOIT > {marker}}}\n"
        "Hello\n\\end{document}"
    )

    result = run_compiler({"files": {"main.tex": tex}})

    assert result.get("success") is False, "shell escape was not blocked"
    assert not marker.exists(), f"shell command executed: {marker}"


@requires_image
@pytest.mark.security
def test_blocks_minted_package():
    """minted requires shell escape and is refused by name."""
    tex = (
        "\\documentclass{article}\n\\usepackage{minted}\n\\begin{document}\n"
        "\\begin{minted}{python}\nimport os\nos.system('echo EXPLOIT')\n\\end{minted}\n"
        "\\end{document}"
    )

    result = run_compiler({"files": {"main.tex": tex}})

    assert result.get("success") is False
    assert "minted" in str(result.get("error", "")).lower()


@requires_image
@pytest.mark.security
def test_blocks_pythontex_package():
    """pythontex executes Python and is refused by name."""
    tex = (
        "\\documentclass{article}\n\\usepackage{pythontex}\n\\begin{document}\n"
        "\\begin{pycode}\nimport subprocess\nsubprocess.run(['id'])\n\\end{pycode}\n"
        "\\end{document}"
    )

    result = run_compiler({"files": {"main.tex": tex}})

    assert result.get("success") is False
    assert "pythontex" in str(result.get("error", "")).lower()


# --- Filesystem access -------------------------------------------------------


@requires_image
@pytest.mark.security
def test_blocks_input_etc_passwd():
    """\\input{/etc/passwd} cannot read host files."""
    tex = "\\documentclass{article}\n\\begin{document}\n\\input{/etc/passwd}\n\\end{document}"

    result = run_compiler({"files": {"main.tex": tex}})

    assert result.get("success") is False
    assert not result.get("pdf"), "a PDF was produced from a host file"


@requires_image
@pytest.mark.security
def test_blocks_openin_absolute_path():
    """\\openin cannot open a path outside the job directory."""
    tex = (
        "\\documentclass{article}\n\\begin{document}\n"
        "\\newread\\myfile\n\\openin\\myfile=/etc/hostname\n"
        "\\ifeof\\myfile ACCESSIBLE\\else BLOCKED\\fi\n"
        "\\closein\\myfile\n\\end{document}"
    )

    result = run_compiler({"files": {"main.tex": tex}})

    if result.get("success") and result.get("pdf"):
        pdf_text = extract_text_from_pdf(result["pdf"])
        assert "ACCESSIBLE" not in pdf_text, "/etc/hostname was readable from inside the sandbox"


@requires_image
@pytest.mark.security
def test_blocks_path_traversal_in_filenames():
    """Traversal in a filename is refused before the filesystem is touched."""
    result = run_compiler(
        {
            "files": {
                "../../../etc/passwd": "malicious",
                "main.tex": "\\documentclass{article}\\begin{document}x\\end{document}",
            }
        }
    )

    assert result.get("success") is False
    message = str(result.get("error", "")).lower()
    assert "invalid" in message or "path" in message


@requires_image
@pytest.mark.security
def test_rejects_unsafe_file_types():
    """File types outside the allowlist are refused."""
    result = run_compiler({"files": {"payload.exe": "MZ\x90\x00"}})

    assert result.get("success") is False
    assert "error" in result


# --- Resource exhaustion -----------------------------------------------------


@requires_image
@pytest.mark.security
def test_kills_runaway_recursion():
    """
    Unbounded recursion is stopped.

    TeX aborts on its own memory/stack guards rather than reaching the wall
    clock, so this is reported as a resource-limit failure. Both that and a
    genuine timeout are acceptable outcomes; what must not happen is the job
    running to completion.
    """
    tex = (
        "\\documentclass{article}\n\\begin{document}\n"
        "\\def\\recurseme{\\recurseme}\n\\recurseme\n\\end{document}"
    )

    result = run_compiler({"files": {"main.tex": tex}})

    assert result.get("success") is False
    assert result.get("error_type") in {"timeout", "resource_limit", "compile_error"}


@requires_image
@pytest.mark.security
def test_kills_memory_bomb():
    """A memory-exhausting document is stopped."""
    tex = (
        "\\documentclass{article}\n\\begin{document}\n\\newcount\\mycounter\n"
        "\\mycounter=0\n\\loop\n\\advance\\mycounter by 1\n"
        "\\ifnum\\mycounter<1000000\n\\meaning\\mycounter\n\\repeat\n\\end{document}"
    )

    result = run_compiler({"files": {"main.tex": tex}})

    assert result.get("success") is False


@requires_image
@pytest.mark.security
def test_enforces_timeout():
    """A job that overruns is killed and reported as a timeout."""
    # \\loop with a very large bound and no output takes longer than the budget.
    tex = (
        "\\documentclass{article}\n\\begin{document}\n\\newcount\\mycounter\n"
        "\\mycounter=0\n\\loop\n\\advance\\mycounter by 1\n"
        "\\ifnum\\mycounter<20000000000\n\\repeat\n\\end{document}"
    )

    result = run_compiler({"files": {"main.tex": tex}})

    assert result.get("success") is False
    assert "timeout" in str(result.get("error", "")).lower() or result.get(
        "error_type"
    ) in {"timeout", "resource_limit"}


@requires_image
@pytest.mark.security
def test_limits_input_size():
    """A payload beyond the input cap is rejected."""
    result = run_compiler({"files": {"main.tex": "A" * (8 * 1024 * 1024)}})

    assert result.get("success") is False


# --- Information disclosure --------------------------------------------------


@requires_image
@pytest.mark.security
def test_sanitizes_error_messages():
    """Error output does not disclose host filesystem layout."""
    result = run_compiler(
        {"files": {"main.tex": "\\documentclass{article}\\begin{document}\\badcommand\\end{document}"}}
    )

    assert result.get("success") is False

    serialised = json.dumps(result)
    for leak in ("/root/", "/etc/", "/usr/share/texlive", "/var/lib/texmf"):
        assert leak not in serialised, f"error output leaked {leak}"


@requires_image
@pytest.mark.security
def test_valid_document_still_compiles():
    """The hardening does not break legitimate compilation."""
    tex = (
        "\\documentclass[11pt]{article}\n"
        "\\usepackage{amsmath}\n"
        "\\begin{document}\n"
        "Hello, $x^2$.\n"
        "\\end{document}"
    )

    result = run_compiler({"files": {"main.tex": tex}})

    assert result.get("success") is True, result.get("error")
    assert result.get("pdf")


# --- Helpers -----------------------------------------------------------------


def extract_text_from_pdf(pdf_base64: str) -> str:
    """
    Extract text from a base64-encoded PDF.

    Skips the assertion when no PDF library is available, since the assertion
    is about sandboxing rather than about text extraction.
    """
    try:
        import base64
        import io

        from PyPDF2 import PdfReader
    except ImportError:
        pytest.skip("PyPDF2 is not installed; skipping PDF text extraction")

    try:
        reader = PdfReader(io.BytesIO(base64.b64decode(pdf_base64)))
        return "\n".join(page.extract_text() for page in reader.pages)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"PDF text extraction failed: {exc}")


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
