"""
Compile API routes.

Endpoint for LaTeX compilation. Requires authentication: compilation is the
most expensive operation in the system, so an unauthenticated endpoint would
hand out compute for free.
"""
import asyncio
import base64
import hashlib
import json
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from app.auth.dependencies import get_current_user
from app.cache.redis import get_redis_manager
from app.compile.backend import CompileBackend, CompileResult, get_compile_backend
from app.config import settings
from app.db import User
from app.middleware.rate_limit import RateLimitResult, rate_limit

logger = logging.getLogger(__name__)

router = APIRouter()

# Bounds the number of containers running at once, so a burst of requests
# cannot spawn unbounded Docker processes.
_compile_slots = asyncio.Semaphore(max(1, settings.COMPILE_MAX_CONCURRENT))

# Control characters and NUL are never valid in a project file path.
_PATH_RE = re.compile(r"^[\w./@+()-]+$")


def compute_compilation_fingerprint(files: dict[str, str]) -> str:
    """
    Compute hash of semantically significant content.
    
    Strips LaTeX comments and normalizes whitespace to detect real changes.
    This allows cache hits for whitespace-only or comment-only edits.
    
    Args:
        files: Mapping of file paths to content
        
    Returns:
        SHA256 hash of normalized content
    """
    normalized = {}
    
    for path, content in files.items():
        if path.endswith('.tex'):
            # Strip LaTeX comments (lines starting with %)
            clean = re.sub(r'%.*$', '', content, flags=re.MULTILINE)
            # Normalize whitespace (spaces, tabs, newlines)
            clean = re.sub(r'\s+', ' ', clean.strip())
            normalized[path] = clean
        else:
            # Binary files or other formats: use as-is
            normalized[path] = content
    
    # Sort by filename for consistency
    canonical = json.dumps(normalized, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


class CompileRequest(BaseModel):
    """Request body for the compile endpoint."""

    model_config = {"extra": "forbid"}

    files: dict[str, str] = Field(
        ...,
        description="Mapping of file paths to text content",
        examples=[{"main.tex": "\\documentclass{article}\\begin{document}Hi\\end{document}"}],
    )
    main: str | None = Field(
        None,
        max_length=256,
        description="Main .tex file to compile (auto-detected when omitted)",
    )

    @field_validator("files")
    @classmethod
    def _validate_files(cls, value: dict[str, str]) -> dict[str, str]:
        if not value:
            raise ValueError("No files provided")
        if len(value) > settings.COMPILE_MAX_FILES:
            raise ValueError(f"At most {settings.COMPILE_MAX_FILES} files per compile request")
        # Nothing can compile without a source document, so reject it here
        # rather than after the request has already been accepted.
        if not any(name.endswith(".tex") for name in value):
            raise ValueError("No .tex file found in project")

        total = 0
        for path, content in value.items():
            if not _PATH_RE.match(path) or path.startswith("/") or ".." in path:
                raise ValueError(f"Invalid file path: {path!r}")
            if not content:
                continue
            total += len(content.encode("utf-8", errors="ignore"))
            if total > settings.COMPILE_MAX_INPUT_BYTES:
                raise ValueError(
                    f"Compile input exceeds {settings.COMPILE_MAX_INPUT_BYTES} bytes"
                )
        return value


class CompileResponse(BaseModel):
    """Result of a LaTeX compilation."""

    success: bool
    pdf: str | None = Field(None, description="Base64-encoded PDF")
    log: str = Field("", description="LaTeX compilation log")
    synctex: str | None = Field(None, description="Base64-encoded SyncTeX data")
    errors: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[dict[str, Any]] = Field(default_factory=list)
    compile_time: float = Field(0.0, description="Wall-clock seconds")
    error: str | None = None
    error_type: str | None = None


def _backend_or_503() -> CompileBackend:
    """Resolve the configured backend, mapping misconfiguration to a 503."""
    try:
        return get_compile_backend(settings.COMPILE_BACKEND)
    except (NotImplementedError, ValueError) as exc:
        logger.error("Compile backend unavailable: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Compilation backend unavailable",
        ) from exc


@router.post(
    "/",
    response_model=CompileResponse,
    dependencies=[Depends(get_current_user)],
    summary="Compile a LaTeX document",
)
async def compile_latex(
    body: CompileRequest,
    request: Request,
    draft: bool = False,
    user: User = Depends(get_current_user),
    rate: RateLimitResult = Depends(
        rate_limit("compile", limit=settings.RATE_LIMIT_COMPILE_PER_USER, window=60)
    ),
) -> CompileResponse:
    """
    Compile a LaTeX document to PDF.

    **Parameters:**
    - draft: Skip image processing for faster compilation (default: False)

    **Security controls applied here:**
    - Bearer authentication required (compilation is billable compute)
    - Per-user rate limit from Redis
    - File count and total input size caps
    - Path traversal rejected before the container sees the request
    - Concurrency capped, container has no network and no capabilities
    - A 60s timeout, enforced both in-process and by the container runtime
    
    **Optimization:**
    - Compilation fingerprinting: identical source returns cached PDF (instant)
    """
    request_id = getattr(request.state, "request_id", "unknown")
    tex_files = [name for name in body.files if name.endswith(".tex")]
    if not tex_files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No .tex file found in project",
        )

    backend = _backend_or_503()
    
    # Compute fingerprint for caching
    fingerprint = compute_compilation_fingerprint(body.files)
    cache_key = f"compiled-pdf:{fingerprint}"
    cached_result = None
    
    # Try to get from Redis cache (gracefully handle unavailable Redis)
    try:
        redis_mgr = get_redis_manager()
        if redis_mgr.is_connected:
            cached_data = await redis_mgr.get_json(cache_key)
            if cached_data:
                logger.info(
                    "compile request=%s user=%s cache_hit=true fingerprint=%s",
                    request_id, user.id, fingerprint[:12]
                )
                # Return cached result immediately
                return CompileResponse(
                    success=cached_data.get("success", True),
                    pdf=cached_data.get("pdf"),
                    log=cached_data.get("log", ""),
                    synctex=cached_data.get("synctex"),
                    errors=cached_data.get("errors", []),
                    warnings=cached_data.get("warnings", []),
                    compile_time=0.0,  # Cached, instant
                    error=cached_data.get("error"),
                    error_type=cached_data.get("error_type"),
                )
    except Exception as exc:
        logger.warning("Cache lookup failed: %s", exc)
    
    logger.info(
        "compile request=%s user=%s files=%d draft=%s rate_remaining=%d cache_hit=false",
        request_id,
        user.id,
        len(body.files),
        draft,
        rate.remaining,
    )

    try:
        async with _compile_slots:
            result: CompileResult = await backend.compile(dict(body.files), draft_mode=draft)
    except HTTPException:
        raise
    except Exception as exc:
        # The message may contain host paths, so log it and return a generic
        # body keyed by the request id instead.
        logger.error("compile request=%s failed: %s", request_id, exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Compilation service error",
            headers={"X-Request-ID": request_id},
        ) from exc

    response = CompileResponse(
        success=result.success,
        pdf=base64.b64encode(result.pdf).decode() if result.pdf else None,
        log=result.log,
        synctex=base64.b64encode(result.synctex).decode() if result.synctex else None,
        errors=result.errors,
        warnings=result.warnings,
        compile_time=result.compile_time,
        error=result.error_message,
        error_type=result.error_type,
    )

    # Cache successful compilations for 1 hour
    if result.success:
        try:
            redis_mgr = get_redis_manager()
            if redis_mgr.is_connected:
                await redis_mgr.set_json(
                    cache_key,
                    {
                        "success": result.success,
                        "pdf": response.pdf,  # Already base64 encoded
                        "log": result.log,
                        "synctex": response.synctex,  # Already base64 encoded
                        "errors": result.errors,
                        "warnings": result.warnings,
                        "error_type": result.error_type,
                        "error": result.error_message,
                    },
                    ex=3600  # 1 hour
                )
                logger.info(
                    "compile request=%s cached fingerprint=%s",
                    request_id, fingerprint[:12]
                )
        except Exception as exc:
            logger.warning("Cache store failed: %s", exc)

    if not result.success:
        logger.info(
            "compile request=%s user=%s failed type=%s",
            request_id,
            user.id,
            result.error_type,
        )
    else:
        logger.info(
            "compile request=%s user=%s ok in %.2fs draft=%s engine=%s",
            request_id,
            user.id,
            result.compile_time,
            draft,
            result.extra.get('engine', 'unknown'),
        )

    return response


@router.get("/health", summary="Report compiler availability")
async def compile_health() -> dict[str, Any]:
    """
    Report whether the configured compile backend can be reached.

    Never requires authentication so orchestrators can probe it.
    """
    backend_name = settings.COMPILE_BACKEND

    if backend_name == "local":
        try:
            process = await asyncio.create_subprocess_exec(
                "docker",
                "images",
                "-q",
                settings.COMPILE_IMAGE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout=5)
        except FileNotFoundError:
            return {
                "status": "unhealthy",
                "backend": backend_name,
                "reason": "docker_not_installed",
                "message": "Docker CLI not found on the API host.",
            }
        except (TimeoutError, OSError) as exc:
            return {
                "status": "unhealthy",
                "backend": backend_name,
                "reason": type(exc).__name__,
            }

        if stdout.strip():
            return {"status": "healthy", "backend": backend_name, "image": settings.COMPILE_IMAGE}

        return {
            "status": "unhealthy",
            "backend": backend_name,
            "reason": "image_not_built",
            "message": f"Build it with: docker build -t {settings.COMPILE_IMAGE} apps/compiler/",
        }

    if not settings.COMPILE_REMOTE_ENDPOINT:
        return {
            "status": "unhealthy",
            "backend": backend_name,
            "reason": "remote_endpoint_unset",
        }

    return {"status": "healthy", "backend": backend_name}
