"""
WebSocket ticket system for secure WebSocket authentication.

Flow:
1. Client calls POST /api/collab/projects/{id}/ws-ticket with a Bearer token.
2. Server verifies the token, checks project access, mints a one-time ticket.
3. The ticket is stored under ws:ticket:{id} with a short TTL, and its expiry
   is recorded in a per-user sorted set ws:tickets:user:{user_id}.
4. Client connects to the WebSocket with ?ticket={ticket}.
5. The WebSocket server consumes the ticket with GETDEL and drops the index
   entry, so the ticket cannot be replayed.
6. Index entries also expire on their own score, so a crash between consume
   and cleanup cannot inflate the counter and lock a user out.

Why tickets rather than a JWT in the query string:
- Query strings land in proxy logs, browser history, and Referer headers.
- The short TTL bounds the exposure window even if the URL leaks.
- Single-use consumption prevents replay.
- Each ticket is bound to one user and one project.

Concurrency: the per-user limit is enforced with ZCARD against a sorted set,
so counting a user's pending tickets is O(log n) instead of a full keyspace
SCAN (which was a denial-of-service vector).
"""
import logging
import secrets
import time
from dataclasses import dataclass
from uuid import UUID

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.config import settings

logger = logging.getLogger(__name__)

TICKET_PREFIX = "ws:ticket"
USER_INDEX_PREFIX = "ws:tickets:user"

# Drop entries that have already expired, then report how many remain.
_PRUNE_AND_COUNT_LUA = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
return redis.call('ZCARD', KEYS[1])
"""


@dataclass(frozen=True)
class TicketData:
    """Parsed ticket payload."""
    user_id: str
    project_id: UUID


def _ticket_key(ticket_id: str) -> str:
    return f"{TICKET_PREFIX}:{ticket_id}"


def _index_key(user_id: str) -> str:
    return f"{USER_INDEX_PREFIX}:{user_id}"


async def generate_ticket(redis: Redis, user_id: str, project_id: UUID) -> str:
    """
    Mint a single-use WebSocket ticket bound to a user and project.

    Args:
        redis: Live Redis client.
        user_id: Clerk user id (`sub`).
        project_id: Project the ticket grants access to.

    Returns:
        Opaque ticket token to place in the WebSocket query string.

    Raises:
        RuntimeError: when Redis is unavailable, so a ticket is never issued
            that the WebSocket server could not later validate.
    """
    ticket_id = secrets.token_urlsafe(32)
    ttl = max(5, settings.WS_TICKET_TTL)
    expires_at = time.time() + ttl

    try:
        pipe = redis.pipeline(transaction=True)
        pipe.setex(_ticket_key(ticket_id), ttl, f"{user_id}:{project_id}")
        pipe.zadd(_index_key(user_id), {ticket_id: expires_at})
        pipe.expire(_index_key(user_id), ttl * 4)
        await pipe.execute()
    except RedisError as exc:
        logger.error("Failed to issue WebSocket ticket for %s: %s", user_id, exc)
        raise RuntimeError("Could not issue WebSocket ticket") from exc

    logger.info("Issued WebSocket ticket for user=%s project=%s", user_id, project_id)
    return ticket_id


async def verify_ticket(redis: Redis, ticket_id: str) -> TicketData | None:
    """
    Verify and consume a ticket. GETDEL is what makes it single-use.

    Args:
        redis: Live Redis client.
        ticket_id: Ticket token from the WebSocket query string.

    Returns:
        TicketData when the ticket was valid, otherwise None.

    Raises:
        RuntimeError: on a Redis outage, so the caller fails closed rather than
            treating an unverifiable ticket as merely absent.
    """
    if not ticket_id or len(ticket_id) > 128:
        return None

    try:
        raw = await redis.getdel(_ticket_key(ticket_id))
    except RedisError as exc:
        logger.error("Ticket store unavailable while consuming ticket: %s", exc)
        raise RuntimeError("Ticket store unavailable") from exc

    if not raw:
        logger.warning("Rejected invalid, expired, or replayed WebSocket ticket")
        return None

    user_id, _, project_id_str = str(raw).partition(":")

    # Best effort: the index entry self-expires, so a failure here is not fatal.
    try:
        await redis.zrem(_index_key(user_id), ticket_id)
    except RedisError:
        logger.warning("Could not remove ticket index entry for user=%s", user_id)

    try:
        return TicketData(user_id=user_id, project_id=UUID(project_id_str))
    except ValueError:
        logger.error("Malformed ticket payload")
        return None


async def revoke_ticket(redis: Redis, ticket_id: str) -> bool:
    """
    Revoke an unused ticket.

    Returns:
        True when a ticket was deleted, False when already consumed/expired.
    """
    try:
        return await redis.delete(_ticket_key(ticket_id)) > 0
    except RedisError as exc:
        logger.error("Failed to revoke ticket: %s", exc)
        return False


async def count_active_tickets(redis: Redis, user_id: str) -> int:
    """
    Return the number of unconsumed tickets held by a user.

    Expired index entries are pruned first, so the count self-heals after a
    crash between ticket consumption and index cleanup.
    """
    try:
        count = await redis.eval(_PRUNE_AND_COUNT_LUA, 1, _index_key(user_id), time.time())
    except RedisError as exc:
        logger.error("Failed to count active tickets: %s", exc)
        # Fail safe: report the limit as consumed so a Redis outage cannot be
        # used to mint unbounded tickets.
        return settings.WS_MAX_PENDING_TICKETS_PER_USER
    return int(count or 0)
