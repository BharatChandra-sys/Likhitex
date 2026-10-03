"""
Mail backend implementations.

Mailer interface with three backends:
- ConsoleMailer: logs to stdout (default, safe for Render)
- SmtpMailer: SMTP (Mailpit/Mailtrap, local dev only)
- HttpMailer: HTTP API (Resend, production)

IMPORTANT: Render blocks outbound SMTP ports (25/465/587).
Use console backend by default, HTTP for real delivery.
"""
import logging
from typing import Protocol

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class Mailer(Protocol):
    """Mail backend protocol."""

    async def send(
        self,
        to: str,
        subject: str,
        html: str,
        text: str | None = None
    ) -> bool:
        """
        Send email.

        Args:
            to: Recipient email
            subject: Email subject
            html: HTML body
            text: Plain text body (optional)

        Returns:
            True if sent successfully
        """
        ...


class ConsoleMailer:
    """
    Console mailer - logs emails to stdout.
    Safe default for Render (no SMTP needed).
    """

    async def send(
        self,
        to: str,
        subject: str,
        html: str,
        text: str | None = None
    ) -> bool:
        """Log email to console."""
        logger.info("=" * 60)
        logger.info("📧 EMAIL (Console Backend)")
        logger.info(f"To: {to}")
        logger.info(f"From: {settings.MAIL_FROM}")
        logger.info(f"Subject: {subject}")
        logger.info("-" * 60)
        logger.info(text or html)
        logger.info("=" * 60)
        return True


class SmtpMailer:
    """
    SMTP mailer for local development.
    Works with Mailpit (port 1025) or Mailtrap.

    WARNING: Do NOT use in production on Render (SMTP ports blocked).
    """

    async def send(
        self,
        to: str,
        subject: str,
        html: str,
        text: str | None = None
    ) -> bool:
        """Send email via SMTP."""
        try:
            from email.message import EmailMessage

            import aiosmtplib

            message = EmailMessage()
            message["From"] = settings.MAIL_FROM
            message["To"] = to
            message["Subject"] = subject
            message.set_content(text or html)

            if html:
                message.add_alternative(html, subtype="html")

            await aiosmtplib.send(
                message,
                hostname=settings.SMTP_HOST,
                port=settings.SMTP_PORT,
                username=settings.SMTP_USER or None,
                password=settings.SMTP_PASSWORD or None,
                use_tls=settings.SMTP_USE_TLS,
            )

            logger.info(f"Email sent via SMTP to {to}")
            return True

        except Exception as e:
            logger.error(f"Failed to send email via SMTP: {e}")
            return False


class HttpMailer:
    """
    HTTP mailer using Resend API.
    Works on Render (uses HTTPS, not SMTP).

    Requires RESEND_API_KEY environment variable.
    """

    def __init__(self) -> None:
        self.api_key = settings.RESEND_API_KEY
        self.api_url = "https://api.resend.com/emails"

    async def send(
        self,
        to: str,
        subject: str,
        html: str,
        text: str | None = None
    ) -> bool:
        """Send email via Resend HTTP API."""
        if not self.api_key:
            logger.error("RESEND_API_KEY not configured")
            return False

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.api_url,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "from": settings.MAIL_FROM,
                        "to": [to],
                        "subject": subject,
                        "html": html,
                        "text": text,
                    },
                    timeout=10.0,
                )

                if response.status_code == 200:
                    logger.info(f"Email sent via Resend to {to}")
                    return True
                else:
                    logger.error(
                        f"Resend API error: {response.status_code} {response.text}"
                    )
                    return False

        except Exception as e:
            logger.error(f"Failed to send email via Resend: {e}")
            return False


def get_mailer() -> Mailer:
    """
    Get mailer instance based on MAIL_BACKEND config.

    Returns:
        Mailer implementation
    """
    backend = settings.MAIL_BACKEND

    if backend == "console":
        return ConsoleMailer()
    elif backend == "smtp":
        return SmtpMailer()
    elif backend == "http":
        return HttpMailer()
    else:
        logger.warning(f"Unknown mail backend '{backend}', using console")
        return ConsoleMailer()
