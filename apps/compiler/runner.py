#!/usr/bin/env python3
"""
LaTeX compiler runner.

Reads a JSON job on stdin, compiles it with latexmk, writes a JSON result on
stdout. Runs as a non-root user inside a container with no network, no
capabilities, and a read-only root filesystem.

Defense in depth for hostile input
----------------------------------
1. Input limits - file count, per-file size, total size, path length.
2. Path validation - rejects absolute paths, traversal, symlink tricks, and
   control characters before anything touches the filesystem.
3. Package denylist - packages that execute code or need shell-escape
   (minted, pythontex, shellesc, ...) are rejected before latexmk starts.
4. Shell-escape pattern scan - \\write18, \\immediate\\write18, \\input| are
   rejected outright rather than relying on texmf.cnf alone.
5. Filesystem confinement - TeX's read/write search paths are pinned to the
   per-job scratch directory, so \\input{/etc/passwd} and \\openin cannot
   escape. HOME/TEXMF* point at scratch so nothing writes to the image.
6. Process-group timeout - the whole latexmk process group is killed on
   overrun, not just the parent PID.
7. Output caps - stdout/log size limited so a runaway compile cannot exhaust
   the API's memory.
8. Error sanitisation - absolute host paths are redacted before the result
   leaves the container, so logs do not disclose the filesystem layout.
"""

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path, PurePosixPath
from typing import Any

# --------------------------------------------------------------------------
# Configuration (all overridable by environment for testing)
# --------------------------------------------------------------------------

TIMEOUT_SECONDS = int(os.getenv("COMPILE_TIMEOUT_SECONDS", "60"))
MAX_FILES = int(os.getenv("COMPILE_MAX_FILES", "50"))
MAX_FILE_BYTES = int(os.getenv("COMPILE_MAX_FILE_BYTES", str(2 * 1024 * 1024)))
MAX_TOTAL_BYTES = int(os.getenv("COMPILE_MAX_INPUT_BYTES", str(4 * 1024 * 1024)))
MAX_PATH_LENGTH = 255
MAX_LOG_CHARS = 2_000_000
# Hard byte ceiling applied while streaming child output. Bounds peak memory
# regardless of how much a hostile document tries to print.
MAX_LOG_BYTES = int(os.getenv("COMPILE_MAX_LOG_BYTES", str(8 * 1024 * 1024)))
# Chunk size for the bounded reader loop.
_READ_CHUNK_BYTES = 64 * 1024
# How often the parent re-checks the deadline while the child runs.
_POLL_INTERVAL_SECONDS = 0.05
# Generous ceiling for the reader thread to drain after the pipes are closed.
_READER_JOIN_SECONDS = 10.0
MAX_PDF_BYTES = int(os.getenv("COMPILE_MAX_PDF_BYTES", str(64 * 1024 * 1024)))
# Upper bound on structured errors returned to the API, so a pathological log
# cannot inflate the JSON response.
MAX_PARSED_ERRORS = 200
# Same ceiling for warnings, which a noisy document can emit in bulk.
MAX_PARSED_WARNINGS = 200

# Packages that execute code or require shell-escape. Each is a real
# sandbox-escape path in LaTeX. Kept to genuinely dangerous packages: blocking
# common ones like `svg` or `ctex` would break legitimate documents without
# adding protection, since shell-escape is already disabled at the config level.
BLOCKED_PACKAGES = (
    "minted",        # executes Python via -shell-escape
    "pythontex",     # executes Python
    "shellesc",      # generic shell escape wrapper
    "write18",       # \write18 passthrough
    "catchfile",     # reads arbitrary files from the host filesystem
    "atveryend",     # hooks run after the PDF closes, bypassing restrictions
)

# Hostile TeX primitives that are never legitimate in user documents here.
BLOCKED_PATTERNS = (
    (re.compile(r"\\immediate\s*\\write18", re.IGNORECASE), "write18"),
    (re.compile(r"(?<!\\)\\write18", re.IGNORECASE), "write18"),
    (re.compile(r"\\input\s*\|", re.IGNORECASE), "injection (\\input|)"),
    (re.compile(r"\\openout", re.IGNORECASE), "openout"),
    (re.compile(r"\\special\s*\(.*(ps:|`|cmd)", re.IGNORECASE), "\\special shell pipe"),
    (re.compile(r"\\usepackage\s*\[.*\]\s*\{[^}]*write18", re.IGNORECASE), "write18"),
)

# TeX's own resource guards. The container memory limit is the real ceiling;
# these make TeX fail fast and legibly instead of thrashing.
TEX_MEMORY_LIMITS = {
    "main_memory": 500_000,
    "extra_mem_bot": 200_000,
    "font_mem_size": 2_000_000,
    "pool_size": 1_500_000,
    "buf_size": 200_000,
    "stack_size": 50_000,
}

TEXT_EXTENSIONS = {".tex", ".sty", ".cls", ".bst", ".bib", ".txt", ".md", ".cfg", ".def"}
BINARY_EXTENSIONS = {".png", ".jpg", ".jpeg", ".pdf", ".gif", ".eps", ".woff", ".ttf", ".otf"}

# Absolute paths are redacted from any message that leaves the container. The
# lookbehind keeps project-relative references such as './sub/file.tex'
# readable, since those are the ones a user needs to debug their document.
_PATH_REDACT_RE = re.compile(
    r"(?<![A-Za-z0-9_.\\-])(?:/[A-Za-z0-9_.+-]+){2,}/?"
)


class CompileError(Exception):
    """Compilation was rejected or failed for a user-visible reason."""

    def __init__(self, message: str, error_type: str = "compile_error") -> None:
        super().__init__(message)
        self.error_type = error_type


class CompileTimeout(CompileError):
    """Compilation exceeded the time budget."""

    def __init__(self, message: str) -> None:
        super().__init__(message, error_type="timeout")


class CompileResourceLimit(CompileError):
    """Compilation was stopped because it exceeded a TeX resource limit."""

    def __init__(self, message: str) -> None:
        super().__init__(message, error_type="resource_limit")


def sanitize(text: str) -> str:
    """
    Redact absolute filesystem paths so error output reveals nothing about
    the container's layout.
    """
    return _PATH_REDACT_RE.sub("[path]", text)


def validate_path(raw_path: str) -> PurePosixPath:
    """
    Validate a project-relative path.

    Rejects absolute paths, traversal, Windows separators, control characters
    and anything that would resolve outside the scratch directory.

    Raises:
        CompileError: when the path is unusable.
    """
    if not raw_path:
        raise CompileError("Invalid file path: empty", error_type="invalid_path")

    if len(raw_path) > MAX_PATH_LENGTH:
        raise CompileError(f"Invalid file path too long: {raw_path[:32]}...", "invalid_path")

    if raw_path.startswith("/") or raw_path.startswith("\\"):
        raise CompileError(f"Invalid absolute file path: {raw_path}", "invalid_path")

    # Reject drive letters, UNC paths and any backslash (Windows semantics).
    if re.match(r"^[A-Za-z]:", raw_path) or "\\" in raw_path:
        raise CompileError(f"Invalid file path: {raw_path}", "invalid_path")

    if any(ord(ch) < 32 or ord(ch) == 127 for ch in raw_path):
        raise CompileError("Invalid file path: control characters", "invalid_path")

    pure = PurePosixPath(raw_path)
    if pure.is_absolute():
        raise CompileError(f"Invalid absolute file path: {raw_path}", "invalid_path")

    for part in pure.parts:
        if part in ("", ".", ".."):
            raise CompileError(f"Invalid file path (traversal): {raw_path}", "invalid_path")
        if part.startswith("-") or part.startswith("."):
            # Reject dotfiles and option-like names (latexmk would treat them
            # as switches).
            raise CompileError(f"Invalid file path: {raw_path}", "invalid_path")

    return pure


def scan_source_for_hostile_constructs(sources: dict[str, str]) -> None:
    """
    Reject documents using shell-escape or other execution primitives.

    Raises:
        CompileError: naming the offending construct or package.
    """
    for path, content in sources.items():
        lowered = content.lower()

        for package in BLOCKED_PACKAGES:
            pattern = re.compile(
                r"\\(?:usepackage|RequirePackage|LoadClass)\s*(\[[^\]]*\])?\s*\{[^}]*\b"
                + re.escape(package)
                + r"\b[^}]*\}",
                re.IGNORECASE,
            )
            if pattern.search(content):
                raise CompileError(
                    f"Package '{package}' is not allowed in {path} (blocked package: {package})",
                    error_type="blocked_package",
                )

        for regex, label in BLOCKED_PATTERNS:
            if regex.search(content):
                raise CompileError(
                    f"Blocked TeX construct '{label}' is not allowed in {path}",
                    error_type="blocked_construct",
                )

        if "shell-escape" in lowered and "\\shell" in lowered:
            raise CompileError(
                f"Shell escape is disabled (requested in {path})",
                error_type="blocked_construct",
            )


def setup_compile_dir(files: dict[str, bytes | str], root: Path) -> Path:
    """
    Materialise the project inside `root` after validating every path.

    Raises:
        CompileError: on any invalid path, or when a limit is exceeded.
    """
    if not files:
        raise CompileError("No files provided", error_type="empty_request")

    if len(files) > MAX_FILES:
        raise CompileError(
            f"Too many files: {len(files)} exceeds the limit of {MAX_FILES}",
            error_type="too_many_files",
        )

    compile_dir = root / "project"
    compile_dir.mkdir(parents=True, exist_ok=True)

    total_bytes = 0
    resolved_root = compile_dir.resolve()

    for raw_path, content in files.items():
        relative = validate_path(raw_path)

        data = content if isinstance(content, bytes) else content.encode("utf-8")
        if len(data) > MAX_FILE_BYTES:
            raise CompileError(
                f"File too large: {raw_path} exceeds {MAX_FILE_BYTES} bytes",
                error_type="file_too_large",
            )
        total_bytes += len(data)
        if total_bytes > MAX_TOTAL_BYTES:
            raise CompileError(
                f"Total project size exceeds {MAX_TOTAL_BYTES} bytes",
                error_type="input_too_large",
            )

        target = compile_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)

        # Belt and braces: confirm the resolved path is still inside the job
        # directory even after normalisation (symlink, '..', absolute join).
        if resolved_root not in target.resolve().parents:
            raise CompileError(f"Invalid file path: {raw_path}", error_type="invalid_path")

        target.write_bytes(data)

    return compile_dir


def find_main_file(compile_dir: Path, requested: str | None = None) -> str:
    """
    Choose the entry document.

    An explicit `main` must exist; otherwise prefer main.tex, then
    document.tex, then the single top-level .tex file. Ambiguity is an error
    rather than a coin flip, so results are reproducible.
    """
    if requested:
        candidate = validate_path(requested)
        if candidate.suffix != ".tex" or not (compile_dir / candidate).is_file():
            raise CompileError(
                f"Requested main file not found: {requested}", error_type="main_not_found"
            )
        return str(candidate)

    for preferred in ("main.tex", "document.tex", "paper.tex"):
        if (compile_dir / preferred).is_file():
            return preferred

    top_level = sorted(p.name for p in compile_dir.glob("*.tex"))
    if not top_level:
        raise CompileError("No .tex file found in project", error_type="main_not_found")

    if len(top_level) == 1:
        return top_level[0]

    raise CompileError(
        f"Multiple .tex files found ({', '.join(top_level[:5])}); specify 'main'",
        error_type="ambiguous_main",
    )


def _build_environment(compile_dir: Path, scratch: Path) -> dict[str, str]:
    """
    Build a minimal environment that confines TeX to the scratch directory.

    HOME, TEXMFCONFIG, TEXMFVAR and TEXMFHOME are redirected into scratch
    because the container root filesystem is read-only. TEXMFOUTPUT and
    TEXMFINPUT are set explicitly so `openin_any`/`openout_any = p` in
    texmf.cnf resolve to this job's directory only.
    """
    texmf_config = scratch / "texmf-config"
    texmf_var = scratch / "texmf-var"
    texmf_home = scratch / "texmf-home"
    for directory in (texmf_config, texmf_var, texmf_home):
        directory.mkdir(parents=True, exist_ok=True)

    tex_dist = "/usr/share/texlive/texmf-dist:/usr/share/texmf:/etc/texmf"

    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": str(scratch),
        "TMPDIR": str(scratch),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        # Confine reads and writes to the job directory plus the TeX tree.
        "TEXMFOUTPUT": str(compile_dir),
        "TEXMFINPUT": f"{compile_dir}:{tex_dist}",
        "TEXMFCONFIG": str(texmf_config),
        "TEXMFVAR": str(texmf_var),
        "TEXMFHOME": str(texmf_home),
        "openin_any": "p",
        "openout_any": "p",
        "shell_escape": "f",
        "SOURCE_DATE_EPOCH": "1700000000",  # reproducible PDF timestamps
        "FORCE_SOURCE_DATE": "1",
        "max_print_line": "1000",
        "error_line": "254",
        "half_error_line": "238",
    }


def _memory_args() -> list[str]:
    """Translate TEX_MEMORY_LIMITS into -fmt arguments."""
    args: list[str] = []
    for key, value in TEX_MEMORY_LIMITS.items():
        args.extend([f"-{key}={value}"])
    return args


def _stream_capped(
    stream: Any,
    limit: int,
    deadline: float,
) -> tuple[bytes, bool]:
    """
    Read at most `limit` bytes from `stream` without ever buffering more.

    `communicate()` buffers a runaway document's entire output before the caller
    can truncate it, so a compile loop printing gigabytes would exhaust the
    container's memory. Reading in bounded chunks keeps peak usage flat and
    reports whether the cap was hit.

    Returns:
        (captured bytes, whether the limit was reached before EOF)
    """
    captured = bytearray()
    truncated = False

    while True:
        if time.monotonic() > deadline:
            raise CompileTimeout(
                f"Compilation exceeded the {TIMEOUT_SECONDS}s timeout"
            )

        remaining_time = max(0.1, deadline - time.monotonic())
        try:
            chunk = stream.read(min(_READ_CHUNK_BYTES, limit + 1 - len(captured)))
        except (OSError, ValueError):
            break

        if not chunk:
            break

        captured.extend(chunk)

        if len(captured) > limit:
            truncated = True
            break

        # Only wait for a chunk when the buffer is still under the cap;
        # otherwise drain without blocking so the process can be reaped.
        if len(captured) < limit and remaining_time > 0:
            continue

    return bytes(captured[:limit]), truncated


def detect_engine(sources: dict[str, str]) -> str:
    """
    Choose the TeX engine from the document's own preamble.

    latexmk's `-pdf` always means pdflatex, which cannot handle fontspec or
    system-font usage. Detecting the intent from magic comments and package
    usage lets those documents build instead of failing with a cryptic font
    error.

    Precedence mirrors TeX convention: an explicit `% !TEX` comment wins, then
    packages that only work on a Unicode engine.

    Returns:
        One of 'lualatex', 'xelatex', 'pdflatex'.
    """
    combined = "\n".join(sources.values()) if sources else ""

    # An explicit engine request is authoritative.
    magic = re.search(r"^\s*%+\s*!\s*TEX\s+(\w+)", combined, re.IGNORECASE | re.MULTILINE)
    if magic:
        requested = magic.group(1).lower()
        if requested in ("lualatex", "xelatex", "pdflatex"):
            return requested

    has_fontspec = re.search(r"\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*fontspec", combined, re.IGNORECASE)
    has_luacode = re.search(r"\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*luacode", combined, re.IGNORECASE)
    has_biblatex = re.search(r"\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*biblatex", combined, re.IGNORECASE)
    has_polyglossia = re.search(
        r"\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*polyglossia", combined, re.IGNORECASE
    )
    has_inputenc_utf8 = re.search(
        r"\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*inputenc", combined, re.IGNORECASE
    )

    # polyglossia and biblatex(backend=biber/luatex) both require a Unicode engine.
    if has_luacode or (has_biblatex and "luatex" in combined.lower()):
        return "lualatex"
    if has_fontspec or has_polyglossia:
        return "xelatex"

    del has_inputenc_utf8
    return "pdflatex"


def run_latexmk(
    compile_dir: Path,
    scratch: Path,
    main_file: str,
    sources: dict[str, str] | None = None,
) -> dict[str, Any]:
    """
    Run latexmk under a process-group timeout.

    The engine is selected from the document's preamble (see `detect_engine`)
    rather than always forcing pdflatex, so fontspec and polyglossia documents
    build correctly.

    Output is read with a hard byte cap rather than via `communicate()`, so a
    document that prints unbounded output cannot exhaust memory.

    Raises:
        CompileTimeout: the job overran the time budget.
        CompileResourceLimit: TeX aborted on a memory/stack guard.
        CompileError: any other failure to produce a result.
    """
    start_time = time.time()
    deadline = start_time + TIMEOUT_SECONDS

    engine = detect_engine(sources or {})

    cmd = [
        "latexmk",
        # Engine flag rather than bare -pdf (which is always pdflatex).
        f"-{engine}",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        "-synctex=1",
        # Critical: no shell execution, and never invoke make or perl helpers.
        "-no-shell-escape",
        "-norc",
        "-output-directory=.",
        *_memory_args(),
        main_file,
    ]

    env = _build_environment(compile_dir, scratch)

    process = None
    try:
        process = subprocess.Popen(  # noqa: S603 - fixed argv, no shell
            cmd,
            cwd=compile_dir,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            # New session => new process group, so a timeout kills latexmk and
            # every child it spawned, not just the direct child.
            start_new_session=True,
        )
    except FileNotFoundError as exc:
        raise CompileError("latexmk is not installed", error_type="backend_error") from exc

    assert process.stdout is not None  # noqa: S101 - guaranteed by PIPE
    assert process.stderr is not None  # noqa: S101 - guaranteed by PIPE

    timed_out = False
    stdout = b""
    stderr = b""
    truncated = False

    def _pump() -> None:
        nonlocal stdout, stderr, truncated
        stdout, stdout_trunc = _stream_capped(process.stdout, MAX_LOG_BYTES, deadline)
        stderr, stderr_trunc = _stream_capped(process.stderr, MAX_LOG_BYTES, deadline)
        truncated = stdout_trunc or stderr_trunc

    reader = threading.Thread(target=_pump, name="latexmk-output", daemon=True)
    reader.start()

    try:
        # Poll rather than block so the deadline is honoured even when the child
        # keeps a pipe open after its own timeout.
        while True:
            if process.poll() is not None:
                break
            if time.monotonic() > deadline:
                timed_out = True
                break
            time.sleep(_POLL_INTERVAL_SECONDS)

        if timed_out:
            _kill_process_group(process)
            raise CompileTimeout(
                f"Compilation exceeded the {TIMEOUT_SECONDS}s timeout"
            )

        # Close the pipes so the reader thread sees EOF and exits.
        for pipe in (process.stdout, process.stderr):
            try:
                pipe.close()  # type: ignore[union-attr]
            except (OSError, ValueError):
                pass

        reader.join(timeout=_READER_JOIN_SECONDS)

        if truncated:
            logger_line = (
                f"Output truncated at {MAX_LOG_BYTES} bytes; "
                "the document is producing unbounded output"
            )
            stderr = (stderr.decode("utf-8", errors="replace") + logger_line).encode()

    except CompileError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        _kill_process_group(process)
        raise CompileError(f"Failed to execute latexmk: {exc}", error_type="backend_error") from exc

    compile_time = time.time() - start_time
    stdout_text = stdout.decode("utf-8", errors="replace")[:MAX_LOG_CHARS]
    stderr_text = stderr.decode("utf-8", errors="replace")[:MAX_LOG_CHARS]

    log_path = compile_dir / (PurePosixPath(main_file).stem + ".log")
    log_text = ""
    if log_path.is_file():
        try:
            log_text = log_path.read_text(errors="replace")[:MAX_LOG_CHARS]
        except OSError:
            log_text = stdout_text

    # TeX's own guards firing means the document was consuming unbounded
    # resources; report it distinctly from a syntax error.
    combined = f"{log_text}\n{stdout_text}"
    if "capacity exceeded" in combined or "TeX capacity exceeded" in combined:
        raise CompileResourceLimit(
            "Compilation exceeded TeX resource limits (timeout guard triggered)"
        )

    pdf_path = compile_dir / (PurePosixPath(main_file).stem + ".pdf")
    synctex_path = compile_dir / (PurePosixPath(main_file).stem + ".synctex.gz")

    pdf_bytes: bytes | None = None
    if pdf_path.is_file():
        if pdf_path.stat().st_size > MAX_PDF_BYTES:
            raise CompileError(
                f"Generated PDF exceeds {MAX_PDF_BYTES} bytes",
                error_type="output_too_large",
            )
        try:
            pdf_bytes = pdf_path.read_bytes()
        except OSError as exc:
            raise CompileError(f"Could not read generated PDF: {exc}") from exc

    synctex_bytes: bytes | None = None
    if synctex_path.is_file():
        try:
            synctex_bytes = synctex_path.read_bytes()
        except OSError:
            synctex_bytes = None

    if pdf_bytes is None:
        detail = stderr_text or log_text or f"latexmk exited with {process.returncode}"
        raise CompileError(_add_engine_hint(sanitize(detail), engine), "compile_error")

    parsed_errors, parsed_warnings = parse_latex_log(log_text or stdout_text)

    return {
        "pdf": pdf_bytes,
        "log": sanitize(log_text or stdout_text),
        "synctex": synctex_bytes,
        "errors": parsed_errors,
        "warnings": parsed_warnings,
        "compile_time": compile_time,
        "engine": engine,
        "success": True,
    }


# Symptoms that almost always mean "wrong engine for this preamble" rather than
# a genuine authoring mistake, so the user gets an actionable hint.
_ENGINE_MISMATCH_HINTS = (
    ("fontspec.sty", "xelatex", "fontspec requires xelatex or lualatex"),
    ("unicode-math.sty", "xelatex", "unicode-math requires xelatex or lualatex"),
    ("polyglossia.sty", "xelatex", "polyglossia requires xelatex or lualatex"),
    ("Package fontspec Error", "xelatex", "fontspec requires xelatex or lualatex"),
    ("! LaTeX Error: File `fontspec.sty' not found", "xelatex",
     "fontspec is missing; this document also needs xelatex or lualatex"),
    ("Undefined control sequence", "xelatex", None),  # only used as a hint carrier
)


def _add_engine_hint(detail: str, engine: str) -> str:
    """
    Append an engine suggestion when the failure looks engine-related.

    A document that loads fontspec but is built with pdflatex fails with an
    error that does not mention fonts at all, which is a frustrating dead end
    for a student. Naming the engine turns a dead end into one edit.
    """
    lowered = detail.lower()

    for marker, _expected, message in _ENGINE_MISMATCH_HINTS:
        if message is None:
            continue
        if marker.lower() in lowered:
            return f"{detail}\n\nHint: {message}. Add `% !TEX {marker} ' or run without this preamble."

    del engine
    return detail


def _kill_process_group(process: subprocess.Popen) -> None:
    """
    SIGKILL the whole process group, then reap.

    TERM first so latexmk can clean up; SIGKILL is unconditional because a
    hostile document may trap signals.
    """
    if process.poll() is not None:
        return

    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        try:
            process.terminate()
        except ProcessLookupError:
            return

    try:
        process.wait(timeout=5)
        return
    except subprocess.TimeoutExpired:
        pass

    try:
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            process.kill()
        except ProcessLookupError:
            return

    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:  # pragma: no cover - defensive
        print("Warning: compiler process did not exit", file=sys.stderr)


def _normalise_log_path(filepath: str) -> str:
    """
    Reduce a latexmk-reported path to a project-relative one.

    latexmk emits './main.tex' for the top level and './chapters/one.tex' for
    nested files. Only a leading './' is removed: str.strip('./') would also eat
    legitimate characters (e.g. '..main.tex' -> 'main.tex'), which silently
    rewrites the filename the editor tries to open.
    """
    cleaned = filepath.strip()
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    return cleaned


# LaTeX reports problems in two shapes: '<file>:<line>: <message>' when
# -file-line-error is active, and '<Package> Warning: ... on input line <n>.'
# for engine-level warnings that have no file-line prefix at all.
_WARNING_PREFIX_RE = re.compile(
    r"^(?:LaTeX|Package|Class|pdfTeX|TeX)\s+(?:\w+\s+)?Warning:",
    re.IGNORECASE,
)
_INPUT_LINE_RE = re.compile(r"on input line (\d+)", re.IGNORECASE)


def _classify(message: str) -> str:
    """Return 'warning' for LaTeX warnings, otherwise 'error'."""
    if _WARNING_PREFIX_RE.match(message.strip()):
        return "warning"
    if re.match(r"^(?:Overfull|Underfull)\s+\\[hv]box", message.strip()):
        return "warning"
    return "error"


def _normalise_warning_line(message: str) -> tuple[str, int]:
    """
    Strip the trailing 'on input line N.' that LaTeX appends to warnings.

    The line number is reported as a separate field, so keeping it in the
    message would duplicate it in the diagnostics panel. The captured number is
    returned so a warning can still be anchored to a line.

    Returns:
        (message without the suffix, line number or 0 when absent)
    """
    match = _INPUT_LINE_RE.search(message)
    if match is None:
        return message.strip(), 0
    return _INPUT_LINE_RE.sub("", message).strip(), int(match.group(1))


def parse_latex_log(log: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Extract structured errors and warnings from a LaTeX log.

    latexmk is invoked with `-file-line-error`, so most diagnostics arrive as
    `file.tex:12: message`. Engine warnings are matched separately because they
    carry no file prefix and only an `on input line N` suffix.

    Both lists are capped so a pathological log cannot inflate the JSON response.

    Returns:
        (errors, warnings), each a list of diagnostic dicts.
    """
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    seen: set[tuple[str, int, str]] = set()

    for line in log.split("\n"):
        if len(errors) + len(warnings) >= MAX_PARSED_ERRORS + MAX_PARSED_WARNINGS:
            break

        line = line.rstrip()
        if not line:
            continue

        entry: dict[str, Any] | None = None

        match = re.match(r"^(.+?):(\d+):\s*(.*)$", line)
        if match:
            filepath, line_num, message = match.groups()
            message = message.strip()
            if not message:
                continue
            entry = {
                "file": _normalise_log_path(filepath),
                "line": int(line_num),
                "message": sanitize(message)[:1000],
                "severity": _classify(message),
            }
        elif _WARNING_PREFIX_RE.match(line.strip()) or re.match(
            r"^\s*(?:Overfull|Underfull)\s+\\[hv]box", line
        ):
            # Engine-level warning with no file prefix. The file is unknowable,
            # so it is reported against the main document at line 0.
            message, line_no = _normalise_warning_line(line.lstrip())
            if not message:
                continue
            entry = {
                "file": "",
                "line": line_no,
                "message": sanitize(message)[:1000],
                "severity": "warning",
            }
        elif line.lstrip().startswith("!"):
            message = sanitize(line.lstrip("! "))[:1000]
            if not message:
                continue
            entry = {"file": "", "line": 0, "message": message, "severity": "error"}

        if entry is None:
            continue

        key = (entry["file"], entry["line"], entry["message"])
        if key in seen:
            continue
        seen.add(key)

        if entry["severity"] == "warning":
            if len(warnings) < MAX_PARSED_WARNINGS:
                warnings.append(entry)
        elif len(errors) < MAX_PARSED_ERRORS:
            errors.append(entry)

    return errors, warnings


def decode_input_files(raw: dict[str, Any]) -> dict[str, bytes | str]:
    """
    Normalise the request payload to bytes/str per file.

    Binary extensions are base64-decoded; everything else is treated as UTF-8
    text. A decode failure is a client error, not a server error.
    """
    decoded: dict[str, bytes | str] = {}

    for path, content in raw.items():
        if not isinstance(content, str):
            raise CompileError(f"File content must be a string: {path}", error_type="bad_request")

        suffix = PurePosixPath(path).suffix.lower()
        if suffix in BINARY_EXTENSIONS:
            try:
                import base64

                decoded[path] = base64.b64decode(content, validate=True)
                continue
            except Exception as exc:
                raise CompileError(
                    f"Invalid base64 content for {path}", error_type="bad_request"
                ) from exc

        if suffix and suffix not in TEXT_EXTENSIONS and suffix != "":
            raise CompileError(
                f"File type '{suffix}' is not allowed", error_type="disallowed_file_type"
            )

        try:
            decoded[path] = content.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise CompileError(
                f"File {path} is not valid UTF-8", error_type="bad_request"
            ) from exc

    return decoded


def build_result(**kwargs: Any) -> dict[str, Any]:
    """Build a result dict with only JSON-safe, path-sanitised values."""
    result: dict[str, Any] = {
        "success": False,
        "pdf": None,
        "synctex": None,
        "errors": [],
        "warnings": [],
        "compile_time": 0.0,
    }
    result.update(kwargs)
    for key in ("error", "error_type", "log"):
        value = result.get(key)
        if isinstance(value, str):
            result[key] = sanitize(value)
    return result


def emit(result: dict[str, Any], exit_code: int) -> None:
    """Write the JSON result to stdout and exit."""
    try:
        json.dump(result, sys.stdout)
    except (TypeError, ValueError) as exc:  # pragma: no cover - defensive
        json.dump(
            build_result(
                success=False,
                error=f"Failed to serialise result: {exc}",
                error_type="internal_error",
            ),
            sys.stdout,
        )
        exit_code = 2
    sys.stdout.flush()
    sys.exit(exit_code)


def main() -> None:
    """Entry point: read a JSON job from stdin, compile, emit JSON on stdout."""
    import base64

    scratch: Path | None = None

    try:
        raw_stdin = sys.stdin.read(MAX_TOTAL_BYTES * 2)
        if len(raw_stdin) > MAX_TOTAL_BYTES * 2:
            raise CompileError("Request payload too large", error_type="input_too_large")

        try:
            input_data = json.loads(raw_stdin or "{}")
        except json.JSONDecodeError as exc:
            raise CompileError("Malformed JSON request", error_type="bad_request") from exc

        if not isinstance(input_data, dict):
            raise CompileError("Malformed JSON request", error_type="bad_request")

        files = decode_input_files(input_data.get("files") or {})
        requested_main = input_data.get("main")

        scratch = Path(tempfile.mkdtemp(prefix="likhitex_"))
        compile_dir = setup_compile_dir(files, scratch)
        main_file = find_main_file(compile_dir, requested_main)

        # Scan TeX sources only: binary assets cannot define macros.
        sources: dict[str, str] = {}
        for source_path in compile_dir.rglob("*"):
            if source_path.is_file() and source_path.suffix.lower() in TEXT_EXTENSIONS:
                try:
                    relative = source_path.relative_to(compile_dir).as_posix()
                    sources[relative] = source_path.read_text(errors="replace")
                except (OSError, ValueError):
                    continue
        scan_source_for_hostile_constructs(sources)

        outcome = run_latexmk(compile_dir, scratch, main_file, sources=sources)

        emit(
            build_result(
                success=True,
                pdf=base64.b64encode(outcome["pdf"]).decode("ascii"),
                synctex=(
                    base64.b64encode(outcome["synctex"]).decode("ascii")
                    if outcome.get("synctex")
                    else None
                ),
                log=outcome["log"],
                errors=outcome["errors"],
                warnings=outcome["warnings"],
                compile_time=outcome["compile_time"],
            ),
            0,
        )

    except CompileError as exc:
        emit(
            build_result(success=False, error=str(exc), error_type=exc.error_type),
            {"timeout": 124, "resource_limit": 123}.get(exc.error_type, 1),
        )
    except Exception as exc:  # noqa: BLE001 - container boundary, must not traceback
        emit(
            build_result(
                success=False,
                error=f"Internal compiler error: {type(exc).__name__}",
                error_type="internal_error",
            ),
            2,
        )
    finally:
        if scratch is not None:
            shutil.rmtree(scratch, ignore_errors=True)


if __name__ == "__main__":
    main()
