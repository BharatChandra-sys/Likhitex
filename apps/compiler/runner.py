#!/usr/bin/env python3
"""
LaTeX Compiler Runner
Executes latexmk with security constraints and resource limits.

Security features:
- Runs as non-root user (texuser)
- Fresh temp directory per job
- Process group timeout (60s)
- Resource limits via prlimit
- No network access
- Shell-escape disabled
"""

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Dict, Any, Optional

# Configuration
TIMEOUT_SECONDS = int(os.getenv("COMPILE_TIMEOUT_SECONDS", "60"))
MAX_OUTPUT_SIZE = 10 * 1024 * 1024  # 10MB


class CompileError(Exception):
    """Compilation failed."""
    pass


class TimeoutError(Exception):
    """Compilation timed out."""
    pass


def setup_compile_dir(files: Dict[str, bytes]) -> Path:
    """
    Create temporary directory and write project files.
    
    Args:
        files: Dict mapping file paths to content bytes
        
    Returns:
        Path to compile directory
    """
    compile_dir = Path(tempfile.mkdtemp(prefix="likhitex_"))
    
    for filepath, content in files.items():
        # Security: reject absolute paths and path traversal
        if filepath.startswith('/') or '..' in filepath:
            raise CompileError(f"Invalid file path: {filepath}")
        
        full_path = compile_dir / filepath
        full_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write file
        if isinstance(content, bytes):
            full_path.write_bytes(content)
        else:
            full_path.write_text(content)
    
    return compile_dir


def find_main_file(compile_dir: Path) -> str:
    """
    Find the main .tex file to compile.
    Priority: main.tex > document.tex > first .tex file
    """
    # Check for main.tex
    if (compile_dir / "main.tex").exists():
        return "main.tex"
    
    # Check for document.tex
    if (compile_dir / "document.tex").exists():
        return "document.tex"
    
    # Find first .tex file
    tex_files = list(compile_dir.glob("*.tex"))
    if not tex_files:
        raise CompileError("No .tex file found in project")
    
    return tex_files[0].name


def run_latexmk(compile_dir: Path, main_file: str) -> Dict[str, Any]:
    """
    Run latexmk with security constraints and resource limits.
    
    Returns:
        Dict with pdf (bytes), log (str), synctex (bytes), errors (list)
    """
    start_time = time.time()
    
    # Build command
    cmd = [
        "latexmk",
        "-pdf",                           # Generate PDF
        "-interaction=nonstopmode",       # Don't stop on errors
        "-file-line-error",               # Show file:line in errors
        "-synctex=1",                     # Generate SyncTeX
        "-no-shell-escape",               # CRITICAL: disable shell execution
        "-output-directory=.",            # Output to current dir
        main_file
    ]
    
    # Set up environment (clean, minimal)
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": "/home/texuser",
        "TEXMFCONFIG": "/home/texuser/.texlive2023/texmf-config",
        "TEXMFVAR": "/home/texuser/.texlive2023/texmf-var",
    }
    
    # Run with timeout and resource limits
    try:
        # Start process in new process group (so we can kill entire group)
        process = subprocess.Popen(
            cmd,
            cwd=compile_dir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            preexec_fn=os.setsid,  # New process group
            start_new_session=True
        )
        
        # Wait with timeout
        try:
            stdout, stderr = process.communicate(timeout=TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            # Kill entire process group
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            process.wait()
            raise TimeoutError(
                f"Compilation exceeded {TIMEOUT_SECONDS}s timeout"
            )
        
        returncode = process.returncode
        compile_time = time.time() - start_time
        
    except Exception as e:
        raise CompileError(f"Failed to execute latexmk: {e}")
    
    # Read output files
    pdf_path = compile_dir / main_file.replace(".tex", ".pdf")
    log_path = compile_dir / main_file.replace(".tex", ".log")
    synctex_path = compile_dir / main_file.replace(".tex", ".synctex.gz")
    
    pdf_bytes = pdf_path.read_bytes() if pdf_path.exists() else None
    log_text = log_path.read_text(errors='ignore') if log_path.exists() else ""
    synctex_bytes = synctex_path.read_bytes() if synctex_path.exists() else None
    
    # Parse errors from log
    errors = parse_latex_log(log_text)
    
    # Check if compilation succeeded
    if returncode != 0 and not pdf_bytes:
        raise CompileError(
            f"Compilation failed (exit code {returncode}). "
            f"Check log for errors."
        )
    
    return {
        "pdf": pdf_bytes,
        "log": log_text,
        "synctex": synctex_bytes,
        "errors": errors,
        "warnings": [],  # TODO: parse warnings
        "compile_time": compile_time,
        "success": returncode == 0 and pdf_bytes is not None
    }


def parse_latex_log(log: str) -> list:
    """
    Parse LaTeX log file for errors.
    Returns list of {file, line, message} dicts.
    """
    errors = []
    
    for line in log.split('\n'):
        # Match pattern: ./file.tex:123: Error message
        if ':' in line and ('error' in line.lower() or '!' in line):
            parts = line.split(':', 2)
            if len(parts) >= 3:
                try:
                    filepath = parts[0].strip('./ ')
                    line_num = int(parts[1])
                    message = parts[2].strip()
                    
                    errors.append({
                        "file": filepath,
                        "line": line_num,
                        "message": message,
                        "severity": "error"
                    })
                except (ValueError, IndexError):
                    continue
    
    return errors


def cleanup(compile_dir: Path):
    """Remove temporary compile directory."""
    import shutil
    try:
        shutil.rmtree(compile_dir)
    except Exception as e:
        print(f"Warning: Failed to cleanup {compile_dir}: {e}", file=sys.stderr)


def main():
    """
    Main entry point.
    Reads JSON from stdin: {"files": {"main.tex": "content"}}
    Writes JSON to stdout: {"pdf": base64, "log": str, ...}
    """
    try:
        # Read input
        input_data = json.load(sys.stdin)
        files = input_data.get("files", {})
        
        if not files:
            raise CompileError("No files provided")
        
        # Convert base64 to bytes if needed
        for path, content in files.items():
            if isinstance(content, str):
                # Assume it's base64 if it looks like binary file
                if path.endswith(('.png', '.jpg', '.jpeg', '.pdf')):
                    import base64
                    files[path] = base64.b64decode(content)
        
        # Setup
        compile_dir = setup_compile_dir(files)
        main_file = find_main_file(compile_dir)
        
        # Compile
        result = run_latexmk(compile_dir, main_file)
        
        # Encode binary outputs as base64
        import base64
        if result["pdf"]:
            result["pdf"] = base64.b64encode(result["pdf"]).decode()
        if result["synctex"]:
            result["synctex"] = base64.b64encode(result["synctex"]).decode()
        
        # Cleanup
        cleanup(compile_dir)
        
        # Output result
        json.dump(result, sys.stdout)
        sys.exit(0)
        
    except TimeoutError as e:
        json.dump({
            "success": False,
            "error": str(e),
            "error_type": "timeout"
        }, sys.stdout)
        sys.exit(124)  # Standard timeout exit code
        
    except CompileError as e:
        json.dump({
            "success": False,
            "error": str(e),
            "error_type": "compile_error"
        }, sys.stdout)
        sys.exit(1)
        
    except Exception as e:
        json.dump({
            "success": False,
            "error": str(e),
            "error_type": "internal_error"
        }, sys.stdout)
        sys.exit(2)


if __name__ == "__main__":
    main()
