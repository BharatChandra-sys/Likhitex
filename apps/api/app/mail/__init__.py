"""
Mail system with multiple backends.
"""
from app.mail.backend import ConsoleMailer, HttpMailer, Mailer, SmtpMailer, get_mailer

__all__ = [
    "Mailer",
    "ConsoleMailer",
    "SmtpMailer",
    "HttpMailer",
    "get_mailer"
]
