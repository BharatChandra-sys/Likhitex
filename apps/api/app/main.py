"""
FastAPI application entry point.
"""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.middleware.request_id import RequestIDMiddleware
from app.middleware.request_size import RequestSizeLimitMiddleware

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

API_VERSION = "0.1.0"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Manage startup and shutdown of external resources.

    Redis is optional in development so the API can boot without it; in
    production `REDIS_REQUIRED` makes an unreachable Redis a startup failure,
    because rate limiting and WebSocket tickets depend on it.
    """
    logger.info("Starting %s API v%s", settings.APP_NAME, API_VERSION)
    logger.info("Environment: %s (debug=%s)", settings.APP_ENV, settings.DEBUG)

    from app.cache.redis import RedisNotAvailableError, close_redis, init_redis

    app.state.redis = None
    app.state.redis_ready = False

    try:
        manager = await init_redis()
        app.state.redis = manager.redis
        app.state.redis_ready = True
        logger.info("Redis ready")
    except Exception as exc:
        message = f"Redis unavailable at {settings.REDIS_URL}: {exc}"
        if settings.REDIS_REQUIRED or settings.is_production:
            logger.error("%s - required, aborting startup", message)
            await close_redis()
            raise
        logger.warning("%s - continuing without Redis (development)", message)
        app.state.redis = None
        app.state.redis_ready = False

    yield

    logger.info("Shutting down %s API", settings.APP_NAME)

    from app.db.base import dispose_engine

    try:
        await dispose_engine()
    except Exception as exc:
        logger.error("Error disposing database engine: %s", exc)

    try:
        await close_redis()
    except RedisNotAvailableError:
        pass
    except Exception as exc:
        logger.error("Error closing Redis: %s", exc)


app = FastAPI(
    title=settings.APP_NAME,
    description="Collaborative LaTeX editor API",
    version=API_VERSION,
    docs_url="/docs" if settings.is_development else None,
    redoc_url="/redoc" if settings.is_development else None,
    openapi_url="/openapi.json" if settings.is_development else None,
    lifespan=lifespan,
)

# Middleware executes bottom-up, so the last added runs first (outermost).
# Host validation must wrap CORS so a rejected Host is not answered with CORS
# headers implying the request was legitimate.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(RequestSizeLimitMiddleware, max_body_bytes=settings.COMPILE_MAX_INPUT_BYTES * 8)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=[
        "X-Request-ID",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
    ],
    max_age=600,
)

allowed_hosts = settings.allowed_hosts_list
if allowed_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)
else:
    logger.warning("ALLOWED_HOSTS is empty; Host header validation is disabled")

# Added last so it is outermost and always stamps a request ID, including on
# errors raised by the middleware above it.
app.add_middleware(RequestIDMiddleware)


def _error_body(request: Request, code: str, message: str, detail: Any = None) -> dict[str, Any]:
    """Build a consistent error envelope that always carries the request ID."""
    body: dict[str, Any] = {
        "error": code,
        "message": message,
        "request_id": getattr(request.state, "request_id", "unknown"),
    }
    if detail is not None:
        body["detail"] = detail
    return body


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Render HTTPException with the shared error envelope."""
    # Preserve headers raised deliberately, e.g. WWW-Authenticate / Retry-After.
    headers = dict(exc.headers or {})
    request_id = getattr(request.state, "request_id", "unknown")
    headers.setdefault("X-Request-ID", request_id)

    detail = exc.detail
    message = detail if isinstance(detail, str) else "Request failed"

    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(request, _code_for(exc.status_code), message),
        headers=headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """
    Report validation failures without echoing submitted values.

    Including the offending input in the response would reflect attacker-
    controlled data back to the client and can leak into logs verbatim.
    """
    fields = [
        {"loc": [str(part) for part in error.get("loc", ())], "msg": error.get("msg", "")}
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=_error_body(request, "validation_error", "Request validation failed", fields),
        headers={"X-Request-ID": getattr(request.state, "request_id", "unknown")},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch-all handler.

    Internal messages can contain connection strings and host paths, so they
    are logged with the request ID and never returned to the client outside
    development.
    """
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception("Unhandled error (request_id=%s): %s", request_id, exc)

    if settings.is_development:
        return JSONResponse(
            status_code=500,
            content=_error_body(
                request, "internal_error", "Internal server error", {"exception": type(exc).__name__}
            ),
            headers={"X-Request-ID": request_id},
        )

    return JSONResponse(
        status_code=500,
        content=_error_body(
            request, "internal_error", "Internal server error", {"request_id": request_id}
        ),
        headers={"X-Request-ID": request_id},
    )


def _code_for(status_code: int) -> str:
    """Map an HTTP status to a stable machine-readable error code."""
    return {
        400: "bad_request",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        405: "method_not_allowed",
        409: "conflict",
        413: "payload_too_large",
        422: "validation_error",
        429: "rate_limited",
        500: "internal_error",
        502: "bad_gateway",
        503: "service_unavailable",
    }.get(status_code, "error")


async def _database_ready() -> bool:
    """True when the database answers a trivial query."""
    try:
        from app.db.base import get_engine

        async with get_engine().connect() as connection:
            await connection.execute(text("SELECT 1"))
        return True
    except Exception as exc:
        logger.warning("Database readiness check failed: %s", exc)
        return False


@app.get("/health", tags=["system"], summary="Liveness probe")
async def health_check() -> dict[str, Any]:
    """
    Liveness probe.

    Always 200 while the process is serving requests; it deliberately does not
    touch the database or Redis so a dependency outage does not cause the
    orchestrator to restart an otherwise healthy process.
    """
    return {
        "status": "healthy",
        "version": API_VERSION,
        "environment": settings.APP_ENV,
    }


@app.get("/health/ready", tags=["system"], summary="Readiness probe")
async def readiness_check() -> JSONResponse:
    """
    Readiness probe.

    Reports 503 when a required dependency is down so traffic is routed away
    instead of producing errors for every request.
    """
    from app.cache.redis import redis_ping

    database_ok = await _database_ready()
    redis_ok = await redis_ping()

    dependencies: dict[str, Any] = {
        "database": {"status": "ok" if database_ok else "unavailable"},
        "redis": {
            "status": "ok" if redis_ok else "unavailable",
            "required": settings.REDIS_REQUIRED or settings.is_production,
        },
    }

    ready = database_ok and (redis_ok or not (settings.REDIS_REQUIRED or settings.is_production))

    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "ready" if ready else "not_ready",
            "version": API_VERSION,
            "dependencies": dependencies,
        },
    )


@app.get("/", tags=["system"], summary="Service metadata")
async def root() -> dict[str, Any]:
    """Describe the service and where to find its documentation."""
    return {
        "message": f"{settings.APP_NAME} API",
        "version": API_VERSION,
        "docs": "/docs" if settings.is_development else "disabled",
    }


from app.collab.routes import router as collab_router  # noqa: E402
from app.compile.routes import router as compile_router  # noqa: E402
from app.files.routes import router as files_router  # noqa: E402
from app.projects.routes import router as projects_router  # noqa: E402
from app.users.routes import router as users_router  # noqa: E402

app.include_router(compile_router, prefix="/api/compile", tags=["compile"])
app.include_router(projects_router, prefix="/api/projects", tags=["projects"])
app.include_router(
    files_router,
    prefix="/api/projects/{project_id}/files",
    tags=["files"],
)
app.include_router(users_router, prefix="/api/users", tags=["users"])
app.include_router(collab_router, prefix="/api/collab", tags=["collaboration"])


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=settings.is_development,
        log_level=settings.LOG_LEVEL.lower(),
    )
