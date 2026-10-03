"""
Request body size limit.

Rejects oversized bodies before they are buffered. Without this, an
unauthenticated upload can fill process memory, since reading the body happens
before any handler-level validation runs.
"""
import logging
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import Message

logger = logging.getLogger(__name__)

# Methods that do not carry a body worth limiting.
BODYLESS_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "DELETE", "TRACE"})


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Cap request bodies at a fixed byte size."""

    def __init__(self, app: Any, max_body_bytes: int) -> None:
        super().__init__(app)
        self.max_body_bytes = max_body_bytes

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        if request.method in BODYLESS_METHODS:
            return await call_next(request)

        declared = request.headers.get("content-length")
        if declared is not None:
            try:
                length = int(declared)
            except ValueError:
                return self._too_large("Content-Length is not a valid integer")
            if length < 0:
                return self._too_large("Content-Length is negative")
            if length > self.max_body_bytes:
                logger.warning(
                    "Rejected %s %s: Content-Length %s exceeds limit %s",
                    request.method,
                    request.url.path,
                    length,
                    self.max_body_bytes,
                )
                return self._too_large()

        # Content-Length is optional (chunked transfer encoding), so also cap
        # the streamed body. The original callable is captured first: wrapping
        # `request.receive` from inside `limited_receive` would recurse forever,
        # because that method itself delegates to the wrapped `_receive`.
        received = 0
        original_receive = request.receive

        async def limited_receive() -> Message:
            nonlocal received
            message = await original_receive()
            if message["type"] == "http.request":
                body: bytes = message.get("body", b"")
                received += len(body)
                if received > self.max_body_bytes:
                    raise _BodyTooLarge
            return message

        request._receive = limited_receive  # noqa: SLF001
        try:
            return await call_next(request)
        except _BodyTooLarge:
            logger.warning("Rejected chunked body over limit on %s", request.url.path)
            return self._too_large()

    def _too_large(self, message: str | None = None) -> JSONResponse:
        """
        Build the 413 response.

        No request ID is added here: this middleware sits inside
        RequestIDMiddleware, which stamps the header on whatever comes back.
        """
        return JSONResponse(
            status_code=413,
            content={
                "error": "payload_too_large",
                "message": message or f"Request body exceeds {self.max_body_bytes} bytes",
            },
        )


class _BodyTooLarge(Exception):
    """Internal signal that the streamed body exceeded the limit."""
