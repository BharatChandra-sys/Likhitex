"""
FastAPI application entry point.
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan: startup and shutdown logic."""
    # Startup
    logger.info(f"Starting {settings.APP_NAME} API")
    logger.info(f"Environment: {settings.APP_ENV}")
    logger.info(f"Debug mode: {settings.DEBUG}")
    
    # TODO Phase 2: Initialize database connection pool
    # TODO Phase 3: Initialize Redis connection
    # TODO Phase 3: Initialize WebSocket manager
    
    yield
    
    # Shutdown
    logger.info("Shutting down API")
    # TODO: Close database connections
    # TODO: Close Redis connections


# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    description="Collaborative LaTeX editor API",
    version="0.1.0",
    docs_url="/docs" if settings.is_development else None,
    redoc_url="/redoc" if settings.is_development else None,
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Total-Count", "X-Page"],
    max_age=3600,
)


# Health check endpoint
@app.get("/health")
async def health_check() -> dict[str, str]:
    """
    Health check endpoint.
    Returns 200 if service is running.
    """
    return {
        "status": "healthy",
        "version": "0.1.0",
        "environment": settings.APP_ENV,
    }


# Root endpoint
@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint."""
    return {
        "message": f"Welcome to {settings.APP_NAME} API",
        "docs": "/docs" if settings.is_development else "disabled in production",
    }


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    """Catch-all exception handler."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    
    if settings.is_development:
        # Show full error in development
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "detail": str(exc),
                "type": type(exc).__name__,
            },
        )
    else:
        # Hide details in production
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error"},
        )


# Import routers
from app.compile.routes import router as compile_router
from app.projects.routes import router as projects_router
from app.files.routes import router as files_router
from app.users.routes import router as users_router

# Register routers
app.include_router(compile_router, prefix="/api/compile", tags=["compile"])
app.include_router(projects_router, prefix="/api/projects", tags=["projects"])
app.include_router(
    files_router,
    prefix="/api/projects/{project_id}/files",
    tags=["files"]
)
app.include_router(users_router, prefix="/api/users", tags=["users"])

# TODO Phase 3: Add WebSocket routes for collaboration


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.is_development,
        log_level=settings.LOG_LEVEL.lower(),
    )
