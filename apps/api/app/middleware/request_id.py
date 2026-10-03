"""
Request ID middleware and security headers.

Adds a traceable request ID to every request and response, and applies baseline
security headers. Client-supplied IDs are length/character-validated because
they are echoed into response headers and logs.
"""
import logging
import re
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "X-Request-ID"

# Only accept UUID-ish tokens from clients; anything else is replaced.
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,128}$")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
}


def _resolve_request_id(request: Request) -> str:
    """Validate the inbound request ID or generate a fresh one."""
    supplied = request.headers.get(REQUEST_ID_HEADER, "")
    if supplied and _VALID_REQUEST_ID.match(supplied):
        return supplied
    if supplied:
        logger.warning("Discarded malformed %s header", REQUEST_ID_HEADER)
    return uuid.uuid4().hex


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Attach a request ID to the request state, response, and log context."""

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        request_id = _resolve_request_id(request)
        request.state.request_id = request_id

        response = await call_next(request)

        response.headers[REQUEST_ID_HEADER] = request_id
        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)

        if settings.is_production:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )

        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Apply security headers to responses that bypass RequestIDMiddleware.

    RequestIDMiddleware already sets them; this is a safety net so responses
    produced outside its dispatch path (unhandled errors) still carry them.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        response = await call_next(request)
        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)
        return response


def get_request_id(request: Request) -> str:
    """
    Get the request ID from request state.

    Usage in routes:
        request_id = get_request_id(request)
    """
    return getattr(request.state, "request_id", "unknown")
