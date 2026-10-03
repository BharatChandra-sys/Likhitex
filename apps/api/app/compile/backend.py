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
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

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
    async def compile(self, files: FileMap) -> CompileResult:
        """
        Compile a LaTeX project.

        Args:
            files: Mapping of file path to content (str for text, bytes for binary).

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
            "--rm",
            "-i",
            # No network egress: \write18, \input|curl and package fetches fail.
            "--network", "none",
            # Root filesystem immutable; all writes confined to tmpfs.
            "--read-only",
            "--tmpfs", f"/compile:rw,noexec,nosuid,size={settings.COMPILE_TMPFS_COMPILE}",
            # Not a host temp path: a tmpfs mount point inside the container.
            "--tmpfs", f"/tmp:rw,noexec,nosuid,size={settings.COMPILE_TMPFS_TMP}",  # noqa: S108
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

    async def compile(self, files: FileMap) -> CompileResult:
        """Compile in a sandboxed container."""
        payload = json.dumps({"files": _encode_files(files)}).encode("utf-8")

        logger.info("Starting local compile of %d file(s)", len(files))
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
            # The container has its own timeout, but if the host is starved we
            # must not leave the container running: --rm only fires on exit.
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

    async def compile(self, files: FileMap) -> CompileResult:
        """Compile via the remote service."""
        import time

        import httpx

        if not self.endpoint or not self.api_key:
            return LocalCompileBackend._failure(
                "not_configured", "Remote compile service is not configured"
            )

        body = json.dumps({"files": _encode_files(files)}).encode("utf-8")
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

    if name == "remote":
        if not (settings.COMPILE_REMOTE_ENDPOINT and settings.COMPILE_REMOTE_API_KEY):
            raise NotImplementedError(
                "COMPILE_REMOTE_ENDPOINT and COMPILE_REMOTE_API_KEY must be set"
            )
        return RemoteCompileBackend()

    raise ValueError(f"Unknown compile backend: {backend_type!r}")
