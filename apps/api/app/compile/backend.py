"""
Compile Backend Interface
Abstracts the compilation implementation (local Docker vs remote service).
"""
import json
import logging
import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class CompileResult:
    """Result of a LaTeX compilation."""
    success: bool
    pdf: Optional[bytes]
    log: str
    synctex: Optional[bytes]
    errors: list[dict]
    warnings: list[dict]
    compile_time: float
    error_type: Optional[str] = None
    error_message: Optional[str] = None


class CompileBackend(ABC):
    """Abstract interface for LaTeX compilation."""
    
    @abstractmethod
    async def compile(self, files: Dict[str, str | bytes]) -> CompileResult:
        """
        Compile LaTeX project.
        
        Args:
            files: Dictionary mapping file paths to content
                   (string for text files, bytes for binary)
        
        Returns:
            CompileResult with PDF and metadata
        
        Raises:
            CompileError: If compilation fails
            CompileTimeout: If compilation exceeds timeout
        """
        pass


class LocalCompileBackend(CompileBackend):
    """
    Local Docker-based compilation backend.
    Runs likhitex-compiler container for each compile job.
    """
    
    def __init__(
        self,
        image: str = "likhitex-compiler",
        timeout: int = 90,
        memory_limit: str = "512m",
        cpu_limit: str = "0.5"
    ):
        self.image = image
        self.timeout = timeout
        self.memory_limit = memory_limit
        self.cpu_limit = cpu_limit
    
    async def compile(self, files: Dict[str, str | bytes]) -> CompileResult:
        """Compile using local Docker container."""
        import asyncio
        import base64
        
        # Prepare input JSON
        encoded_files = {}
        for path, content in files.items():
            if isinstance(content, bytes):
                # Binary files: base64 encode
                encoded_files[path] = base64.b64encode(content).decode('utf-8')
            else:
                # Text files: keep as string
                encoded_files[path] = content
        
        input_json = json.dumps({"files": encoded_files})
        
        # Build Docker command
        cmd = [
            "docker", "run", "--rm", "-i",
            "--network", "none",
            "--read-only",
            "--tmpfs", "/compile:rw,noexec,nosuid,size=100m",
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=50m",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--pids-limit", "50",
            "--memory", self.memory_limit,
            "--cpus", self.cpu_limit,
            self.image
        ]
        
        logger.info(f"Starting compile with {len(files)} files")
        
        try:
            # Run Docker container
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            # Send input and wait for output
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input_json.encode()),
                timeout=self.timeout
            )
            
            # Parse output
            if stdout:
                result = json.loads(stdout.decode())
                
                # Decode base64-encoded PDF and synctex
                pdf = None
                synctex = None
                
                if result.get("pdf"):
                    pdf = base64.b64decode(result["pdf"])
                
                if result.get("synctex"):
                    synctex = base64.b64decode(result["synctex"])
                
                return CompileResult(
                    success=result.get("success", False),
                    pdf=pdf,
                    log=result.get("log", ""),
                    synctex=synctex,
                    errors=result.get("errors", []),
                    warnings=result.get("warnings", []),
                    compile_time=result.get("compile_time", 0.0),
                    error_type=result.get("error_type"),
                    error_message=result.get("error")
                )
            else:
                # No stdout, check stderr
                error_msg = stderr.decode() if stderr else "No output from compiler"
                logger.error(f"Compile failed: {error_msg}")
                
                return CompileResult(
                    success=False,
                    pdf=None,
                    log=error_msg,
                    synctex=None,
                    errors=[],
                    warnings=[],
                    compile_time=0.0,
                    error_type="docker_error",
                    error_message=error_msg
                )
        
        except asyncio.TimeoutError:
            logger.error(f"Compile timeout after {self.timeout}s")
            return CompileResult(
                success=False,
                pdf=None,
                log="",
                synctex=None,
                errors=[],
                warnings=[],
                compile_time=self.timeout,
                error_type="timeout",
                error_message=f"Compilation exceeded {self.timeout}s timeout"
            )
        
        except Exception as e:
            logger.error(f"Compile error: {e}", exc_info=True)
            return CompileResult(
                success=False,
                pdf=None,
                log="",
                synctex=None,
                errors=[],
                warnings=[],
                compile_time=0.0,
                error_type="internal_error",
                error_message=str(e)
            )


class RemoteCompileBackend(CompileBackend):
    """
    Remote compile service backend (Phase 4).
    Sends compilation requests to a separate VPS with gVisor.
    """
    
    def __init__(
        self,
        endpoint: str,
        api_key: str,
        timeout: int = 90
    ):
        self.endpoint = endpoint
        self.api_key = api_key
        self.timeout = timeout
    
    async def compile(self, files: Dict[str, str | bytes]) -> CompileResult:
        """Compile using remote service."""
        import httpx
        import base64
        
        # Prepare request
        encoded_files = {}
        for path, content in files.items():
            if isinstance(content, bytes):
                encoded_files[path] = base64.b64encode(content).decode('utf-8')
            else:
                encoded_files[path] = content
        
        # Sign request (HMAC)
        # TODO: Add HMAC signature for security
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.endpoint}/compile",
                    json={"files": encoded_files},
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    timeout=self.timeout
                )
                
                result = response.json()
                
                # Decode base64-encoded outputs
                pdf = base64.b64decode(result["pdf"]) if result.get("pdf") else None
                synctex = base64.b64decode(result["synctex"]) if result.get("synctex") else None
                
                return CompileResult(
                    success=result.get("success", False),
                    pdf=pdf,
                    log=result.get("log", ""),
                    synctex=synctex,
                    errors=result.get("errors", []),
                    warnings=result.get("warnings", []),
                    compile_time=result.get("compile_time", 0.0),
                    error_type=result.get("error_type"),
                    error_message=result.get("error")
                )
        
        except Exception as e:
            logger.error(f"Remote compile error: {e}", exc_info=True)
            return CompileResult(
                success=False,
                pdf=None,
                log="",
                synctex=None,
                errors=[],
                warnings=[],
                compile_time=0.0,
                error_type="remote_error",
                error_message=str(e)
            )


def get_compile_backend(backend_type: str = "local") -> CompileBackend:
    """
    Factory function to get compile backend.
    
    Args:
        backend_type: "local" or "remote"
    
    Returns:
        CompileBackend instance
    """
    if backend_type == "local":
        return LocalCompileBackend()
    elif backend_type == "remote":
        # TODO: Load remote endpoint from config
        raise NotImplementedError("Remote backend not yet configured")
    else:
        raise ValueError(f"Unknown backend type: {backend_type}")
