"""
Collaboration routes - WebSocket ticket issuance.

The WebSocket server itself runs separately (Hocuspocus). This module only
mints short-lived, single-use tickets that that server consumes on connect, so
a session token never has to travel in a WebSocket URL.
"""
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from redis.asyncio import Redis

from app.auth.dependencies import RequireViewer, get_current_user
from app.auth.tickets import count_active_tickets, generate_ticket
from app.cache.redis import get_redis
from app.config import settings
from app.db import Project, User
from app.middleware.rate_limit import RateLimitResult, rate_limit

logger = logging.getLogger(__name__)

router = APIRouter()


class TicketResponse(BaseModel):
    """A single-use WebSocket ticket."""

    ticket: str = Field(description="Opaque single-use token")
    expires_in: int = Field(description="Ticket lifetime in seconds")
    ws_url: str = Field(description="Full WebSocket URL including the ticket")


@router.post(
    "/projects/{project_id}/ws-ticket",
    response_model=TicketResponse,
    summary="Issue a single-use WebSocket ticket",
)
async def create_ws_ticket(
    project_id: UUID,
    project: Project = Depends(RequireViewer),
    user: User = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
    rate: RateLimitResult = Depends(
        rate_limit("ws-ticket", limit=settings.RATE_LIMIT_DEFAULT_PER_MINUTE, window=60)
    ),
) -> TicketResponse:
    """
    Issue a one-time ticket for connecting to the collaboration socket.

    Flow:
    1. Call this endpoint with a Bearer token.
    2. Receive a ticket that expires in `WS_TICKET_TTL` seconds.
    3. Open the WebSocket at the returned `ws_url`.
    4. The socket server consumes the ticket on connect; it cannot be reused.

    Requires: VIEWER role on the project.
    """
    active = await count_active_tickets(redis, user.id)
    if active >= settings.WS_MAX_PENDING_TICKETS_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Too many unused tickets outstanding. "
                "Connect with an existing ticket or retry shortly."
            ),
            headers={"Retry-After": str(settings.WS_TICKET_TTL)},
        )

    try:
        ticket = await generate_ticket(redis, user.id, project_id)
    except RuntimeError as exc:
        # Never hand out a ticket the socket server could not later verify.
        logger.error("Ticket issuance failed for user=%s: %s", user.id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not issue a collaboration ticket",
            headers={"Retry-After": "5"},
        ) from exc

    separator = "&" if "?" in settings.COLLAB_WS_URL else "?"
    return TicketResponse(
        ticket=ticket,
        expires_in=settings.WS_TICKET_TTL,
        ws_url=f"{settings.COLLAB_WS_URL}{separator}ticket={ticket}",
    )


@router.get(
    "/projects/{project_id}/presence",
    summary="List users connected to a project",
)
async def get_presence(
    project_id: UUID,
    project: Project = Depends(RequireViewer),
) -> dict[str, object]:
    """
    Report which collaborators are currently connected.

    Presence is owned by the WebSocket server; until it publishes a presence
    key this reports an empty roster rather than guessing.
    """
    return {
        "project_id": str(project_id),
        "online_users": [],
        "implemented": False,
    }
