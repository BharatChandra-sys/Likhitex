"""
Compiler Security Tests

Tests that the LaTeX compiler properly blocks malicious inputs:
- Shell-escape attempts
- Path traversal
- Resource exhaustion
- Blocked packages

These tests MUST pass before production deployment.
"""
import pytest
import json
import subprocess
from pathlib import Path


@pytest.mark.security
def test_blocks_write18_shell_escape():
    """
    Blocks \write18{} shell-escape command.
    
    Attack: Attacker uses \write18{rm -rf /} to execute shell commands
    Defense: texmf.cnf has shell_escape=f, runner checks for blocked packages
    """
    malicious_tex = r"""
\documentclass{article}
\begin{document}
\immediate\write18{echo "EXPLOIT" > /tmp/exploit.txt}
Hello World
\end{document}
"""
    
    input_data = {
        "files": {
            "main.tex": malicious_tex
        }
    }
    
    result = run_compiler(input_data)
    
    # Should either fail compilation or succeed without executing command
    assert result["success"] is False or not Path("/tmp/exploit.txt").exists()
    
    # Log should mention shell-escape is disabled
    if "log" in result:
        assert "shell" in result["log"].lower() or "disabled" in result["log"].lower()


@pytest.mark.security
def test_blocks_input_etc_passwd():
    """
    Blocks reading /etc/passwd via \input{}.
    
    Attack: Attacker uses \input{/etc/passwd} to read system files
    Defense: texmf.cnf has openin_any=p (paranoid), only reads from compile dir
    """
    malicious_tex = r"""
\documentclass{article}
\begin{document}
\input{/etc/passwd}
\end{document}
"""
    
    input_data = {
        "files": {
            "main.tex": malicious_tex
        }
    }
    
    result = run_compiler(input_data)
    
    # Should fail compilation
    assert result["success"] is False
    
    # Error should mention file not found or forbidden
    assert "errors" in result or "error" in result
    
    # PDF should not contain /etc/passwd content
    if "pdf" in result and result["pdf"]:
        pdf_text = extract_text_from_pdf(result["pdf"])
        assert "root:x:" not in pdf_text  # /etc/passwd content


@pytest.mark.security
def test_blocks_openin_absolute_path():
    """
    Blocks \openin with absolute paths.
    
    Attack: Use \openin to read arbitrary files
    Defense: openin_any=p restricts to compile directory
    """
    malicious_tex = r"""
\documentclass{article}
\newread\myfile
\begin{document}
\openin\myfile=/etc/hostname
\ifeof\myfile
  File not accessible
\else
  File was opened (SECURITY ISSUE)
  \read\myfile to \myline
  \myline
\fi
\closein\myfile
\end{document}
"""
    
    input_data = {
        "files": {
            "main.tex": malicious_tex
        }
    }
    
    result = run_compiler(input_data)
    
    # Should compile but file should not be accessible
    if result["success"] and "pdf" in result:
        pdf_text = extract_text_from_pdf(result["pdf"])
        assert "File not accessible" in pdf_text
        assert "File was opened" not in pdf_text


@pytest.mark.security
def test_blocks_minted_package():
    """
    Blocks minted package (requires shell-escape for Pygments).
    
    Attack: Use minted package to execute Python code
    Defense: Runner checks for blocked packages
    """
    malicious_tex = r"""
\documentclass{article}
\usepackage{minted}
\begin{document}
\begin{minted}{python}
import os
os.system('echo EXPLOIT')
\end{minted}
\end{document}
"""
    
    input_data = {
        "files": {
            "main.tex": malicious_tex
        }
    }
    
    result = run_compiler(input_data)
    
    # Should fail with error about blocked package
    assert result["success"] is False
    assert "error" in result
    assert "minted" in str(result["error"]).lower()


@pytest.mark.security
def test_blocks_pythontex_package():
    """
    Blocks pythontex package (executes Python code).
    
    Attack: Use pythontex to run arbitrary Python
    Defense: Blocked in BLOCKED_PACKAGES list
    """
    malicious_tex = r"""
\documentclass{article}
\usepackage{pythontex}
\begin{document}
\begin{pycode}
import subprocess
subprocess.run(['touch', '/tmp/exploit'])
\end{pycode}
\end{document}
"""
    
    input_data = {
        "files": {
            "main.tex": malicious_tex
        }
    }
    
    result = run_compiler(input_data)
    
    assert result["success"] is False
    assert "pythontex" in str(result.get("error", "")).lower()


@pytest.mark.security
def test_enforces_timeout():
    """
    Enforces 60-second timeout on infinite loops.
    
    Attack: Create infinite recursion to DOS the compiler
    Defense: Process group timeout kills entire job
    """
    infinite_loop_tex = r"""
\documentclass{article}
\begin{document}
\def\recurseme{\recurseme}
\recurseme
\end{document}
"""
    
    input_data = {
        "files": {
            "main.tex": infinite_loop_tex
        }
    }
    
    result = run_compiler(input_data)
    
    # Should timeout
    assert result["success"] is False
    assert "timeout" in str(result.get("error", "")).lower() or \
           "error_type" in result and result["error_type"] == "timeout"


@pytest.mark.security
def test_blocks_path_traversal_in_filenames():
    """
    Blocks path traversal in uploaded file names.
    
    Attack: Upload file with name ../../etc/passwd
    Defense: Runner validates filenames, rejects ../ and absolute paths
    """
    input_data = {
        "files": {
            "../../../etc/passwd": "malicious content",
            "main.tex": r"\documentclass{article}\begin{document}\input{../../../etc/passwd}\end{document}"
        }
    }
    
    result = run_compiler(input_data)
    
    # Should reject the malicious filename
    assert result["success"] is False
    assert "error" in result
    assert "invalid" in str(result["error"]).lower() or "path" in str(result["error"]).lower()


@pytest.mark.security
def test_prevents_memory_exhaustion():
    """
    Prevents memory exhaustion attacks.
    
    Attack: Create huge arrays to exhaust memory
    Defense: texmf.cnf memory limits + Docker --memory limit
    """
    memory_bomb_tex = r"""
\documentclass{article}
\begin{document}
\newcount\mycounter
\mycounter=0
\loop
  \advance\mycounter by 1
  \ifnum\mycounter<1000000
    \meaning\mycounter
\repeat
\end{document}
"""
    
    input_data = {
        "files": {
            "main.tex": memory_bomb_tex
        }
    }
    
    result = run_compiler(input_data)
    
    # Should either timeout or fail with memory error
    assert result["success"] is False
    # Don't assert specific error message, as it varies


@pytest.mark.security
def test_sanitizes_error_messages():
    """
    Error messages don't leak sensitive paths or system info.
    
    Attack: Trigger error to discover system paths
    Defense: Error messages are sanitized
    """
    input_data = {
        "files": {
            "main.tex": r"\documentclass{article}\begin{document}\badcommand\end{document}"
        }
    }
    
    result = run_compiler(input_data)
    
    # Should return error
    assert result["success"] is False
    
    # Error should not contain sensitive paths
    error_str = json.dumps(result)
    assert "/home/" not in error_str or "/home/texuser" in error_str  # texuser is OK
    assert "/root/" not in error_str
    assert "/etc/" not in error_str


# Helper functions

def run_compiler(input_data: dict) -> dict:
    """
    Run the compiler Docker container with given input.
    Returns parsed JSON output.
    """
    try:
        # Run Docker container
        result = subprocess.run(
            [
                "docker", "run", "--rm", "-i",
                "--network", "none",
                "--read-only",
                "--tmpfs", "/compile:rw,noexec,nosuid,size=100m",
                "--tmpfs", "/tmp:rw,noexec,nosuid,size=50m",
                "--cap-drop", "ALL",
                "--security-opt", "no-new-privileges",
                "--pids-limit", "50",
                "--memory", "512m",
                "--cpus", "0.5",
                "likhitex-compiler"
            ],
            input=json.dumps(input_data).encode(),
            capture_output=True,
            timeout=90  # Allow 90s for Docker overhead + 60s compile timeout
        )
        
        # Parse output
        if result.stdout:
            return json.loads(result.stdout.decode())
        else:
            return {
                "success": False,
                "error": result.stderr.decode() if result.stderr else "No output",
                "error_type": "docker_error"
            }
    
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Docker timeout (90s exceeded)",
            "error_type": "timeout"
        }
    
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_type": "internal_error"
        }


def extract_text_from_pdf(pdf_base64: str) -> str:
    """
    Extract text from base64-encoded PDF.
    Requires: pip install PyPDF2
    """
    try:
        import base64
        import io
        from PyPDF2 import PdfReader
        
        pdf_bytes = base64.b64decode(pdf_base64)
        pdf_file = io.BytesIO(pdf_bytes)
        reader = PdfReader(pdf_file)
        
        text = ""
        for page in reader.pages:
            text += page.extract_text()
        
        return text
    
    except ImportError:
        pytest.skip("PyPDF2 not installed, skipping PDF text extraction")
    except Exception as e:
        return f"[PDF extraction failed: {e}]"


@pytest.fixture(scope="module", autouse=True)
def ensure_compiler_built():
    """Ensure Docker image is built before running tests."""
    result = subprocess.run(
        ["docker", "images", "-q", "likhitex-compiler"],
        capture_output=True
    )
    
    if not result.stdout:
        pytest.skip("Docker image 'likhitex-compiler' not built. Run: docker build -t likhitex-compiler apps/compiler/")
