"""
Compile API Routes
Endpoints for LaTeX compilation.
"""
import logging
from typing import Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.compile.backend import get_compile_backend, CompileResult
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


class CompileRequest(BaseModel):
    """Request body for /compile endpoint."""
    files: Dict[str, str] = Field(
        ...,
        description="Dictionary mapping file paths to content",
        example={
            "main.tex": "\\documentclass{article}\\begin{document}Hello\\end{document}"
        }
    )
    main: Optional[str] = Field(
        None,
        description="Main .tex file to compile (auto-detected if not specified)"
    )


class CompileResponse(BaseModel):
    """Response from /compile endpoint."""
    success: bool
    pdf: Optional[str] = Field(None, description="Base64-encoded PDF")
    log: str = Field("", description="LaTeX compilation log")
    synctex: Optional[str] = Field(None, description="Base64-encoded SyncTeX data")
    errors: list[dict] = Field(default_factory=list)
    warnings: list[dict] = Field(default_factory=list)
    compile_time: float = Field(0.0, description="Compilation time in seconds")
    error: Optional[str] = None
    error_type: Optional[str] = None


@router.post("/", response_model=CompileResponse)
async def compile_latex(
    request: CompileRequest,
    http_request: Request
) -> CompileResponse:
    """
    Compile LaTeX document to PDF.
    
    **Security:**
    - Runs in isolated Docker container
    - Shell-escape disabled
    - 60-second timeout enforced
    - Resource limits applied
    
    **Example:**
    ```json
    {
      "files": {
        "main.tex": "\\\\documentclass{article}\\\\begin{document}Hello\\\\end{document}"
      }
    }
    ```
    """
    # TODO Phase 2: Add authentication
    # TODO Phase 2: Check rate limits
    # TODO Phase 2: Check user quota
    
    logger.info(f"Compile request with {len(request.files)} files")
    
    # Validate files
    if not request.files:
        raise HTTPException(status_code=400, detail="No files provided")
    
    # Check for at least one .tex file
    tex_files = [f for f in request.files.keys() if f.endswith('.tex')]
    if not tex_files:
        raise HTTPException(status_code=400, detail="No .tex file found in project")
    
    # Get compile backend
    backend = get_compile_backend(settings.COMPILE_BACKEND)
    
    # Compile
    try:
        result: CompileResult = await backend.compile(request.files)
        
        # Encode binary outputs as base64
        import base64
        pdf_b64 = base64.b64encode(result.pdf).decode() if result.pdf else None
        synctex_b64 = base64.b64encode(result.synctex).decode() if result.synctex else None
        
        # Log result
        if result.success:
            logger.info(f"Compile succeeded in {result.compile_time:.2f}s")
        else:
            logger.warning(f"Compile failed: {result.error_message}")
        
        return CompileResponse(
            success=result.success,
            pdf=pdf_b64,
            log=result.log,
            synctex=synctex_b64,
            errors=result.errors,
            warnings=result.warnings,
            compile_time=result.compile_time,
            error=result.error_message,
            error_type=result.error_type
        )
    
    except Exception as e:
        logger.error(f"Compile route error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Compilation failed: {str(e)}"
        )


@router.get("/health")
async def compile_health():
    """
    Check if compiler is available.
    Verifies Docker image exists.
    """
    import subprocess
    
    try:
        result = subprocess.run(
            ["docker", "images", "-q", "likhitex-compiler"],
            capture_output=True,
            timeout=5
        )
        
        if result.stdout:
            return {
                "status": "healthy",
                "compiler": "available",
                "backend": settings.COMPILE_BACKEND
            }
        else:
            return {
                "status": "unhealthy",
                "compiler": "not_built",
                "message": "Docker image 'likhitex-compiler' not found. Run: docker build -t likhitex-compiler apps/compiler/"
            }
    
    except Exception as e:
        return {
            "status": "unhealthy",
            "compiler": "error",
            "message": str(e)
        }
