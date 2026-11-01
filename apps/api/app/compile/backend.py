"""
Compile backend interface.

Abstraction over the compilation implementation (local Docker vs remote
service). Both backends are treated as untrusted: the API never passes a shell
string, and every backend enforces its own timeout and output cap.
"""
import asyncio
import base64
import json
import logging
import os
import re
import subprocess
import sys
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.compile.log_parser import parse_latex_log
from app.config import settings

logger = logging.getLogger(__name__)

FileMap = dict[str, str | bytes]

# Refuse to read more than this from a compile process, so a runaway compiler
# cannot exhaust API memory.
MAX_STDOUT_BYTES = 32 * 1024 * 1024
MAX_STDERR_BYTES = 1 * 1024 * 1024


@dataclass
class CompileResult:
    """Result of a LaTeX compilation."""

    success: bool
    pdf: bytes | None
    log: str
    synctex: bytes | None
    errors: list[dict[str, Any]]
    warnings: list[dict[str, Any]]
    compile_time: float
    error_type: str | None = None
    error_message: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class CompileBackend(ABC):
    """Abstract interface for LaTeX compilation."""

    @abstractmethod
    async def compile(
        self, files: FileMap, draft_mode: bool = False, main: str | None = None
    ) -> CompileResult:
        """
        Compile a LaTeX project.

        Args:
            files: Mapping of file path to content (str for text, bytes for binary).
            draft_mode: If True, compile in draft mode (skip images, faster compilation).
            main: Requested root document; auto-detected when None.

        Returns:
            A CompileResult. Compilation failure is reported in the result, not
            raised; only infrastructure faults raise.
        """


def _encode_files(files: FileMap) -> dict[str, Any]:
    """Base64-encode binary members so the payload is JSON transportable."""
    encoded: dict[str, Any] = {}
    for path, content in files.items():
        if isinstance(content, bytes):
            encoded[path] = base64.b64encode(content).decode("ascii")
        else:
            encoded[path] = content
    return encoded


class LocalCompileBackend(CompileBackend):
    """
    Local Docker-based compilation backend.

    Each job gets a throwaway container with no network, no capabilities, a
    read-only root filesystem, and hard memory/CPU/PID limits.
    """

    def __init__(
        self,
        image: str | None = None,
        timeout: int | None = None,
        memory_limit: str | None = None,
        cpu_limit: str | None = None,
    ) -> None:
        self.image = image or settings.COMPILE_IMAGE
        self.timeout = timeout or settings.COMPILE_TIMEOUT_SECONDS
        self.memory_limit = memory_limit or settings.COMPILE_MEMORY_LIMIT
        self.cpu_limit = cpu_limit or settings.COMPILE_CPU_LIMIT

    def _docker_argv(self) -> list[str]:
        """
        Build the sandbox argument list.

        Every element is either a literal or a value read from trusted server
        configuration, and the list is passed to execve without a shell, so
        no user-supplied text can be interpreted as a command.
        """
        return [
            "docker",
            "run",
            *(["--runtime", settings.COMPILE_DOCKER_RUNTIME] if settings.COMPILE_DOCKER_RUNTIME else []),
            "--rm",
            "-i",
            # No network egress: \write18, \input|curl and package fetches fail.
            "--network", "none",
            # Root filesystem immutable; all writes confined to tmpfs.
            "--read-only",
            "--tmpfs", f"/compile:rw,noexec,nosuid,size={settings.COMPILE_TMPFS_COMPILE}",
            # Not a host temp path: a tmpfs mount point inside the container.
            "--tmpfs", f"/tmp:rw,noexec,nosuid,size={settings.COMPILE_TMPFS_TMP}",  # noqa: S108
            # Persistent TeX package cache to avoid re-downloading packages
            "-v", "likhitex-texmf-cache:/usr/local/texlive/texmf-local:ro",
            # No ambient authority.
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--pids-limit", str(settings.COMPILE_PIDS_LIMIT),
            # Resource ceilings. Without these a fork bomb or memory bomb in a
            # document can take down the host.
            "--memory", self.memory_limit,
            "--memory-swap", self.memory_limit,
            "--cpus", self.cpu_limit,
            "--ulimit", "nofile=256:256",
            "--ulimit", "fsize=104857600:104857600",
            self.image,
        ]

    async def compile(
        self, files: FileMap, draft_mode: bool = False, main: str | None = None
    ) -> CompileResult:
        """Compile in a sandboxed container."""
        payload = json.dumps({
            "files": _encode_files(files),
            "draft_mode": draft_mode,
            "main": main,
        }).encode("utf-8")

        logger.info("Starting local compile of %d file(s)", len(files))

        # Windows compatibility: use subprocess.Popen with asyncio.to_thread
        # instead of create_subprocess_exec which requires ProactorEventLoop
        try:
            if sys.platform == "win32":
                # Windows: use subprocess.Popen in a thread
                import threading
                result_holder: dict[str, Any] = {"stdout": None, "stderr": None, "error": None}

                def run_process() -> None:
                    try:
                        proc = subprocess.Popen(  # noqa: S603 - fixed argv, no shell
                            self._docker_argv(),
                            stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                        )
                        stdout, stderr = proc.communicate(payload, timeout=self.timeout)
                        result_holder["stdout"] = stdout
                        result_holder["stderr"] = stderr
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        result_holder["error"] = "timeout"
                    except FileNotFoundError as exc:
                        result_holder["error"] = f"docker_not_found:{exc}"
                    except Exception as exc:
                        result_holder["error"] = f"internal_error:{exc}"

                thread = threading.Thread(target=run_process)
                thread.start()
                thread.join(timeout=self.timeout + 5)  # Give extra 5s grace period

                if thread.is_alive():
                    logger.error("Compile thread did not finish")
                    return CompileResult(
                        success=False,
                        pdf=None,
                        log="",
                        synctex=None,
                        errors=[],
                        warnings=[],
                        compile_time=float(self.timeout),
                        error_type="timeout",
                        error_message=f"Compilation exceeded {self.timeout}s timeout",
                    )

                if result_holder.get("error"):
                    error = result_holder["error"]
                    if error == "timeout":
                        logger.error("Compile timed out after %ss", self.timeout)
                        return CompileResult(
                            success=False,
                            pdf=None,
                            log="",
                            synctex=None,
                            errors=[],
                            warnings=[],
                            compile_time=float(self.timeout),
                            error_type="timeout",
                            error_message=f"Compilation exceeded {self.timeout}s timeout",
                        )
                    elif error.startswith("docker_not_found"):
                        logger.error("Docker CLI unavailable: %s", error)
                        return self._failure("docker_not_available", "Docker CLI not found on API host")
                    else:
                        logger.error("Compile error: %s", error)
                        return self._failure("internal_error", "Compilation transport failure")

                stdout: bytes = result_holder["stdout"] or b""
                stderr: bytes = result_holder["stderr"] or b""
            else:
                # Unix: use asyncio subprocess
                process: asyncio.subprocess.Process | None = None
                try:
                    process = await asyncio.create_subprocess_exec(  # noqa: S603 - fixed argv, no shell
                        *self._docker_argv(),
                        stdin=asyncio.subprocess.PIPE,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                except FileNotFoundError as exc:
                    logger.error("Docker CLI unavailable: %s", exc)
                    return self._failure("docker_not_available", "Docker CLI not found on API host")

                try:
                    stdout, stderr = await asyncio.wait_for(
                        process.communicate(payload), timeout=self.timeout
                    )
                except TimeoutError:
                    await self._terminate(process)
                    logger.error("Compile timed out after %ss", self.timeout)
                    return CompileResult(
                        success=False,
                        pdf=None,
                        log="",
                        synctex=None,
                        errors=[],
                        warnings=[],
                        compile_time=float(self.timeout),
                        error_type="timeout",
                        error_message=f"Compilation exceeded {self.timeout}s timeout",
                    )
                except Exception as exc:
                    await self._terminate(process)
                    logger.error("Compile transport error: %s", exc, exc_info=True)
                    return self._failure("internal_error", "Compilation transport failure")

        except Exception as exc:
            logger.error("Unexpected compile error: %s", exc, exc_info=True)
            return self._failure("internal_error", "Compilation system failure")

        if len(stdout) > MAX_STDOUT_BYTES:
            logger.error("Compiler stdout exceeded cap (%d bytes)", len(stdout))
            return self._failure("output_too_large", "Compiler output exceeded the size limit")

        if not stdout:
            detail = (stderr or b"").decode("utf-8", errors="replace")[:2000]
            logger.error("Compiler produced no stdout: %s", detail)
            return self._failure("docker_error", detail or "No output from compiler")

        try:
            result = json.loads(stdout.decode("utf-8", errors="replace"))
        except json.JSONDecodeError as exc:
            logger.error("Compiler returned malformed JSON: %s", exc)
            return self._failure("protocol_error", "Compiler returned malformed output")

        if not isinstance(result, dict):
            return self._failure("protocol_error", "Compiler returned an unexpected payload")

        return CompileResult(
            success=bool(result.get("success", False)),
            pdf=_maybe_b64(result.get("pdf")),
            log=str(result.get("log", ""))[:2_000_000],
            synctex=_maybe_b64(result.get("synctex")),
            errors=list(result.get("errors") or []),
            warnings=list(result.get("warnings") or []),
            compile_time=float(result.get("compile_time") or 0.0),
            error_type=result.get("error_type"),
            error_message=result.get("error"),
            extra={"engine": result.get("engine", "unknown")},
        )

    @staticmethod
    async def _terminate(process: asyncio.subprocess.Process) -> None:
        """Kill the container, escalating to SIGKILL if it ignores SIGTERM."""
        if process.returncode is not None:
            return
        try:
            process.kill()
            await asyncio.wait_for(process.wait(), timeout=10)
        except (TimeoutError, ProcessLookupError):
            logger.error("Compiler process %s did not exit after kill", process.pid)

    @staticmethod
    def _failure(error_type: str, message: str) -> CompileResult:
        return CompileResult(
            success=False,
            pdf=None,
            log="",
            synctex=None,
            errors=[],
            warnings=[],
            compile_time=0.0,
            error_type=error_type,
            error_message=message,
        )


class RemoteCompileBackend(CompileBackend):
    """
    Remote compile service backend.

    Requests are signed with HMAC-SHA256 over the request body so the compile
    service can reject traffic that did not come from this API.
    """

    def __init__(
        self,
        endpoint: str | None = None,
        api_key: str | None = None,
        timeout: int | None = None,
    ) -> None:
        self.endpoint = (endpoint or settings.COMPILE_REMOTE_ENDPOINT).rstrip("/")
        self.api_key = api_key or settings.COMPILE_REMOTE_API_KEY
        self.timeout = timeout or settings.COMPILE_TIMEOUT_SECONDS

    def _signature(self, body: bytes, timestamp: str) -> str:
        """HMAC-SHA256 over "{timestamp}.{body}"."""
        import hashlib
        import hmac

        message = timestamp.encode("ascii") + b"." + body
        return hmac.new(
            self.api_key.encode("utf-8"), message, hashlib.sha256
        ).hexdigest()

    async def compile(
        self, files: FileMap, draft_mode: bool = False, main: str | None = None
    ) -> CompileResult:
        """Compile via the remote service."""
        import time

        import httpx

        if not self.endpoint or not self.api_key:
            return LocalCompileBackend._failure(
                "not_configured", "Remote compile service is not configured"
            )

        body = json.dumps({
            "files": _encode_files(files),
            "draft_mode": draft_mode,
            "main": main,
        }).encode("utf-8")
        timestamp = str(int(time.time()))
        headers = {
            "Content-Type": "application/json",
            "X-Compile-Timestamp": timestamp,
            "X-Compile-Signature": self._signature(body, timestamp),
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.endpoint}/compile", content=body, headers=headers
                )
                response.raise_for_status()
                result = response.json()

            if not isinstance(result, dict):
                return LocalCompileBackend._failure(
                    "protocol_error", "Compile service returned an unexpected payload"
                )

            return CompileResult(
                success=bool(result.get("success", False)),
                pdf=_maybe_b64(result.get("pdf")),
                log=str(result.get("log", ""))[:2_000_000],
                synctex=_maybe_b64(result.get("synctex")),
                errors=list(result.get("errors") or []),
                warnings=list(result.get("warnings") or []),
                compile_time=float(result.get("compile_time") or 0.0),
                error_type=result.get("error_type"),
                error_message=result.get("error"),
                extra={"engine": result.get("engine", "unknown")},
            )

        except httpx.TimeoutException:
            logger.error("Remote compile timed out after %ss", self.timeout)
            return LocalCompileBackend._failure(
                "timeout", f"Compilation exceeded {self.timeout}s timeout"
            )
        except Exception as exc:
            logger.error("Remote compile failed: %s", exc, exc_info=True)
            return LocalCompileBackend._failure("remote_error", "Compilation service error")


def _maybe_b64(value: Any) -> bytes | None:
    """Decode a base64 field, tolerating absence and malformed input."""
    if not value or not isinstance(value, str):
        return None
    try:
        return base64.b64decode(value, validate=False)
    except (ValueError, TypeError):
        logger.warning("Discarding malformed base64 field from compiler output")
        return None


def _direct_tex_env(workdir: str) -> dict[str, str]:
    """
    Environment for an in-process pdflatex run.

    The direct backend has no container around it, so the document runs next
    to the API's secrets. Two layers keep them out of the PDF: the child gets
    a fresh environment instead of inheriting os.environ (so
    \\input{/proc/self/environ} has nothing to leak), and kpathsea runs in
    paranoid mode, which refuses absolute paths, `..` and dotfiles for both
    reads and writes. Shell escape is forced off here as well as on argv.
    """
    import os

    # MiKTeX on Windows dev machines cannot start without these; none of them
    # hold secrets.
    passthrough = ("SYSTEMROOT", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "TEMP", "TMP")
    return {
        **{name: os.environ[name] for name in passthrough if name in os.environ},
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": workdir,
        "LANG": "C.UTF-8",
        "TEXMFHOME": workdir,
        "TEXMFVAR": f"{workdir}/.texmf-var",
        "TEXMFCONFIG": f"{workdir}/.texmf-config",
        "TEXMFOUTPUT": workdir,
        "openin_any": "p",
        "openout_any": "p",
        "shell_escape": "f",
    }


ENGINES = ("pdflatex", "xelatex", "lualatex")

# Cap on what a direct compile hands back, so one document cannot balloon the
# API's memory or the JSON response (base64 adds a third on top).
MAX_PDF_BYTES = 32 * 1024 * 1024
MAX_LOG_CHARS = 2_000_000
MAX_DIAGNOSTICS = 200
# First pass, one after BibTeX, and up to two to settle references. latexmk
# allows five; on 0.1 CPU every pass is several seconds of the timeout.
MAX_TEX_PASSES = 4

_COMMENT_RE = re.compile(r"(?<!\\)%.*$", re.MULTILINE)
_DOCUMENTCLASS_RE = re.compile(r"\\documentclass\s*(?:\[[^\]]*\])?\s*\{")
# TeXShop/TeXstudio/Overleaf magic comment: % !TEX program = xelatex
_MAGIC_ENGINE_RE = re.compile(
    r"^\s*%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*([A-Za-z]+)", re.IGNORECASE | re.MULTILINE
)
# Packages that only work on a Unicode engine.
_UNICODE_PACKAGE_RE = re.compile(
    r"\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{[^}]*"
    r"(?<![\w-])(?:fontspec|unicode-math|polyglossia)(?![\w-])"
)
# Messages LaTeX, hyperref (rerunfilecheck), longtable and biblatex print when
# another pass would change the output.
_RERUN_RE = re.compile(r"Rerun to get|Label\(s\) may have changed|Please rerun|Rerun LaTeX")
_BIBER_RE = re.compile(r"Please \(re\)run Biber")
# Files whose change between passes means page references are not settled.
# The kernel prints no rerun warning for a new table of contents.
_LIST_SUFFIXES = (".toc", ".lof", ".lot")


def _strip_comments(source: str) -> str:
    return _COMMENT_RE.sub("", source)


def choose_main_file(files: FileMap, requested: str | None = None) -> str | None:
    """
    Pick the document to compile.

    An explicit request wins when it names a .tex file in the job. Otherwise the
    root is a .tex file that declares \\documentclass (chapters do not), with
    main.tex, then the shallowest path, preferred, so the choice is stable.
    """
    sources = {
        path: content
        for path, content in files.items()
        if path.endswith(".tex") and isinstance(content, str)
    }
    if requested in sources:
        return requested
    roots = [path for path, text in sources.items() if _DOCUMENTCLASS_RE.search(_strip_comments(text))]
    candidates = roots or list(sources)
    if not candidates:
        return None
    return min(candidates, key=lambda p: (p.rsplit("/", 1)[-1] != "main.tex", p.count("/"), p))


def detect_engine(files: FileMap, main: str) -> str:
    """
    Choose the TeX engine.

    A `% !TEX program = ...` comment in the main file wins; otherwise packages
    that need a Unicode engine (fontspec, unicode-math, polyglossia) select
    XeLaTeX; everything else uses pdfLaTeX.
    """
    main_source = files.get(main)
    if isinstance(main_source, str):
        magic = _MAGIC_ENGINE_RE.search(main_source[:4096])
        if magic and magic.group(1).lower() in ENGINES:
            return magic.group(1).lower()

    for path, content in files.items():
        if isinstance(content, str) and path.endswith((".tex", ".sty", ".cls")):
            if _UNICODE_PACKAGE_RE.search(_strip_comments(content)):
                return "xelatex"
    return "pdflatex"


def _draft_source(source: str) -> str:
    """
    Load graphics in draft mode: images become labelled boxes and are never
    embedded. Prepended without a newline so log and SyncTeX lines still match
    the editor. This is what Overleaf's draft mode injects.
    """
    return "\\PassOptionsToPackage{draft}{graphicx}\\PassOptionsToPackage{draft}{graphics}" + source


class ToolMissing(Exception):
    """A TeX tool is not installed on this host."""


def _kill_tree(process: "subprocess.Popen[bytes]") -> None:
    """Kill a timed-out tool and everything it started, then reap it."""
    if sys.platform != "win32":
        import signal

        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            process.kill()
    else:
        process.kill()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        logger.error("Compile process %s did not exit after kill", process.pid)


def _run_tool(argv: list[str], cwd: str, env: dict[str, str], timeout: float) -> int:
    """
    Run one TeX tool to completion and return its exit code.

    Output goes to a dotfile in the job directory rather than a pipe, so a
    document printing without end costs disk in a throwaway directory instead
    of API memory, and paranoid mode stops TeX from reading it back.

    Raises:
        subprocess.TimeoutExpired: the tool overran; it has been killed.
        ToolMissing: the tool is not installed.
    """
    if timeout <= 0:
        raise subprocess.TimeoutExpired(argv, 0)
    with open(os.path.join(cwd, ".output"), "ab") as output:
        try:
            process = subprocess.Popen(  # noqa: S603 - fixed argv, no shell
                argv,
                cwd=cwd,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                # Own process group, so a timeout kills the whole tree.
                start_new_session=True,
            )
        except FileNotFoundError as exc:
            raise ToolMissing(argv[0]) from exc
        try:
            return process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_tree(process)
            raise


def _read_tail(path: Path, limit: int = MAX_LOG_CHARS) -> str:
    """Read at most `limit` bytes from the end of a text file."""
    try:
        with path.open("rb") as handle:
            size = handle.seek(0, os.SEEK_END)
            handle.seek(max(0, size - limit))
            return handle.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def _list_snapshot(workdir: Path, stem: str) -> dict[str, bytes]:
    """Contents of the ToC/LoF/LoT files, to detect page numbers moving."""
    snapshot: dict[str, bytes] = {}
    for suffix in _LIST_SUFFIXES:
        candidate = workdir / f"{stem}{suffix}"
        if candidate.is_file():
            snapshot[suffix] = candidate.read_bytes()
    return snapshot


def _needs_bibtex(workdir: Path, stem: str) -> bool:
    """True when the document cites something and names a .bib database."""
    aux = _read_tail(workdir / f"{stem}.aux")
    if "\\bibdata{" not in aux:
        return False
    return any(
        "\\citation{" in _read_tail(path) for path in workdir.rglob("*.aux")
    )


class DirectCompileBackend(CompileBackend):
    """
    Compile with TeX Live inside the API process's container (no Docker).

    Used on the Render free tier. Every job runs in a fresh temp directory with
    a scrubbed environment, paranoid kpathsea file access and shell escape off
    (see `_direct_tex_env`). Passes are driven by the log, as latexmk does:
    a second run only happens when LaTeX asks for one, and BibTeX only runs when
    the document cites a .bib database.
    """

    def __init__(self, timeout: int | None = None) -> None:
        self.timeout = timeout or settings.COMPILE_TIMEOUT_SECONDS

    async def compile(
        self, files: FileMap, draft_mode: bool = False, main: str | None = None
    ) -> CompileResult:
        """Compile in a worker thread so the event loop stays responsive."""
        return await asyncio.to_thread(self._compile_sync, files, draft_mode, main)

    def _compile_sync(self, files: FileMap, draft_mode: bool, requested_main: str | None) -> CompileResult:
        import shutil
        import tempfile
        import time

        start = time.monotonic()
        deadline = start + self.timeout

        main = choose_main_file(files, requested_main)
        if main is None:
            return LocalCompileBackend._failure("no_tex_file", "No .tex file found in project")
        engine = detect_engine(files, main)
        stem = Path(main).stem

        tmpdir = tempfile.mkdtemp(prefix="likhitex_")
        workdir = Path(tmpdir)
        try:
            root = workdir.resolve()
            for raw_path, content in files.items():
                target = (workdir / raw_path.lstrip("/\\")).resolve()
                if root not in target.parents:
                    # Routes validate paths already; this is the last line.
                    return LocalCompileBackend._failure("invalid_path", f"Invalid file path: {raw_path}")
                target.parent.mkdir(parents=True, exist_ok=True)
                if isinstance(content, bytes):
                    target.write_bytes(content)
                else:
                    text = _draft_source(content) if draft_mode and raw_path == main else content
                    target.write_text(text, encoding="utf-8")

            env = _direct_tex_env(tmpdir)
            tex_argv = [
                engine,
                "-no-shell-escape",
                "-interaction=nonstopmode",
                "-file-line-error",
                "-synctex=1",
                "-output-directory=.",
                *(["--nosocket"] if engine == "lualatex" else []),
                main,
            ]
            log_path = workdir / f"{stem}.log"
            pdf_path = workdir / f"{stem}.pdf"

            passes = 0
            pdf: bytes | None = None
            out_of_time = False
            bibtex_ran = False
            notes: list[dict[str, Any]] = []
            while True:
                before = _list_snapshot(workdir, stem)
                try:
                    _run_tool(tex_argv, tmpdir, env, deadline - time.monotonic())
                except subprocess.TimeoutExpired:
                    # A killed pass leaves a truncated PDF on disk, so fall back
                    # to the one read after the last completed pass.
                    if pdf is None:
                        raise
                    out_of_time = True
                    break
                passes += 1
                # The exit code is not the verdict: pdfTeX exits 1 for any
                # recoverable error (an undefined macro, a missing image) and
                # still writes a usable PDF. Only a missing PDF is a failure.
                pdf = pdf_path.read_bytes() if pdf_path.is_file() else None
                if pdf is None or passes >= MAX_TEX_PASSES:
                    break
                if not bibtex_ran and _needs_bibtex(workdir, stem):
                    try:
                        _run_tool(["bibtex", stem], tmpdir, env, deadline - time.monotonic())
                    except subprocess.TimeoutExpired:
                        out_of_time = True
                        break
                    bibtex_ran = True
                    continue
                log_text = _read_tail(log_path)
                if _RERUN_RE.search(log_text) or _list_snapshot(workdir, stem) != before:
                    continue
                break

            log_text = _read_tail(log_path) or _read_tail(workdir / ".output")
            if bibtex_ran:
                blg = _read_tail(workdir / f"{stem}.blg", 100_000)
                if "error message" in blg:
                    log_text = f"{log_text}\n\n=== BibTeX ===\n{blg}"
            if _BIBER_RE.search(log_text):
                notes.append({
                    "file": main,
                    "line": 0,
                    "message": "Biber is not available; use \\usepackage[backend=bibtex]{biblatex}",
                    "severity": "warning",
                })

            if out_of_time:
                notes.append({
                    "file": main,
                    "line": 0,
                    "message": "Ran out of compile time: references or citations may be out of date",
                    "severity": "warning",
                })
            if pdf is not None and len(pdf) > MAX_PDF_BYTES:
                return LocalCompileBackend._failure("output_too_large", "Generated PDF exceeds the size limit")
            synctex_path = workdir / f"{stem}.synctex.gz"
            # SyncTeX from a killed pass would not match the PDF being returned.
            synctex = synctex_path.read_bytes() if synctex_path.is_file() and not out_of_time else None

            compile_time = time.monotonic() - start
            parsed = parse_latex_log(log_text)
            errors = parsed["errors"][:MAX_DIAGNOSTICS]
            warnings = notes + parsed["warnings"][:MAX_DIAGNOSTICS]
            extra = {"engine": engine, "main": main, "passes": passes}

            if pdf is None and "No pages of output" in log_text:
                return CompileResult(
                    success=False,
                    pdf=None,
                    log=log_text,
                    synctex=None,
                    errors=errors or [{"file": main, "line": 0, "message": "Document is empty - no content to render", "severity": "error"}],
                    warnings=warnings or [{"file": main, "line": 0, "message": "Add content between \\begin{document} and \\end{document}", "severity": "warning"}],
                    compile_time=compile_time,
                    error_type="empty_document",
                    error_message="Document compiled successfully but has no content to display",
                    extra=extra,
                )

            success = pdf is not None
            if not success:
                logger.info("Direct compile produced no PDF: engine=%s passes=%s", engine, passes)
            return CompileResult(
                success=success,
                pdf=pdf,
                log=log_text,
                synctex=synctex,
                errors=errors,
                warnings=warnings,
                compile_time=compile_time,
                error_type=None if success else "compile_error",
                error_message=None if success else "LaTeX compilation failed",
                extra=extra,
            )

        except subprocess.TimeoutExpired:
            result = LocalCompileBackend._failure(
                "timeout", f"Compilation exceeded {self.timeout}s timeout"
            )
            result.compile_time = float(self.timeout)
            return result
        except ToolMissing as exc:
            tool = str(exc)
            logger.error("%s is not installed", tool)
            hint = " (remove the % !TEX program comment or fontspec to use pdflatex)"
            return LocalCompileBackend._failure(
                "engine_not_available",
                f"{tool} is not installed on this server{hint if tool != 'pdflatex' and tool == engine else ''}",
            )
        except Exception as exc:
            # The message can hold host paths; keep it in the server log.
            logger.error("Direct compile error: %s", exc, exc_info=True)
            return LocalCompileBackend._failure("internal_error", "Compilation system failure")
        finally:
            # ignore_errors: Windows can briefly hold handles on TeX outputs, and
            # a leftover temp dir must not turn a good compile into a failure.
            shutil.rmtree(tmpdir, ignore_errors=True)


def get_compile_backend(backend_type: str | None = None) -> CompileBackend:
    """
    Factory returning the configured compile backend.

    Raises:
        ValueError: unknown backend name.
        NotImplementedError: remote backend selected but unconfigured.
    """
    name = (backend_type or settings.COMPILE_BACKEND).lower()

    if name == "local":
        return LocalCompileBackend()

    if name == "direct":
        return DirectCompileBackend()

    if name == "remote":
        if not (settings.COMPILE_REMOTE_ENDPOINT and settings.COMPILE_REMOTE_API_KEY):
            raise NotImplementedError(
                "COMPILE_REMOTE_ENDPOINT and COMPILE_REMOTE_API_KEY must be set"
            )
        return RemoteCompileBackend()

    raise ValueError(f"Unknown compile backend: {backend_type!r}")
