"""
Application configuration.
All settings loaded from environment variables.
"""

from functools import lru_cache
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment."""

    # App
    APP_NAME: str = "Likhitex"
    APP_ENV: Literal["development", "test", "production"] = "development"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # Security
    SECRET_KEY: str
    CLERK_SECRET_KEY: str
    CLERK_JWKS_URL: str = "https://clerk.likhitex.app/.well-known/jwks.json"
    CLERK_ISSUER: str = "https://clerk.likhitex.app"
    CLERK_AUDIENCE: str = ""
    CLERK_JWKS_CACHE_SECONDS: int = 3600
    AUTH_CLOCK_SKEW_SECONDS: int = 30
    INVITE_ONLY: bool = True
    ALLOWED_EMAIL_DOMAINS: str = ""  # comma-separated, optional extra allow rule

    # Database
    DATABASE_URL: str
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 2
    DB_POOL_RECYCLE: int = 300
    DB_POOL_TIMEOUT: int = 10
    DB_ECHO: bool = False
    DB_STATEMENT_TIMEOUT_MS: int = 15_000

    # Redis
    REDIS_URL: str
    REDIS_SOCKET_TIMEOUT: int = 5
    REDIS_REQUIRED: bool = False

    # Storage (Cloudflare R2)
    R2_ACCOUNT_ID: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = "likhitex-files"
    R2_PUBLIC_URL: str = ""
    LOCAL_STORAGE_PATH: str = "./var/storage"

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000"
    ALLOWED_HOSTS: str = "localhost,127.0.0.1"

    # Rate Limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_COMPILE_PER_USER: int = 10
    RATE_LIMIT_COMPILE_GLOBAL: int = 50
    RATE_LIMIT_UPLOAD_PER_USER: int = 50
    RATE_LIMIT_DEFAULT_PER_MINUTE: int = 120
    RATE_LIMIT_FAIL_OPEN: bool = False

    # Quotas
    QUOTA_PER_USER_MB: int = 50
    QUOTA_PER_PROJECT_MB: int = 50
    QUOTA_PER_FILE_MB: int = 10

    # Upload limits
    MAX_FILES_PER_PROJECT: int = 200
    MAX_PROJECT_FILES_TOTAL_MB: int = 50

    # Compile
    COMPILE_TIMEOUT_SECONDS: int = 60
    COMPILE_MAX_QUEUE_SIZE: int = 10
    COMPILE_BACKEND: Literal["local", "remote"] = "local"
    COMPILE_IMAGE: str = "likhitex-compiler"
    COMPILE_MEMORY_LIMIT: str = "512m"
    COMPILE_CPU_LIMIT: str = "0.5"
    COMPILE_PIDS_LIMIT: int = 50
    COMPILE_TMPFS_COMPILE: str = "100m"
    COMPILE_TMPFS_TMP: str = "50m"
    COMPILE_MAX_INPUT_BYTES: int = 2 * 1024 * 1024
    COMPILE_MAX_FILES: int = 50
    COMPILE_MAX_CONCURRENT: int = 4
    COMPILE_REMOTE_ENDPOINT: str = ""
    COMPILE_REMOTE_API_KEY: str = ""

    # WebSocket / collaboration
    COLLAB_WS_URL: str = "ws://localhost:1234/collab"
    WS_TICKET_TTL: int = 30
    WS_MAX_PENDING_TICKETS_PER_USER: int = 10

    # Mail
    MAIL_BACKEND: Literal["console", "smtp", "http"] = "console"
    MAIL_FROM: str = "noreply@likhitex.app"

    # SMTP (development only)
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = False

    # HTTP Mail (Resend)
    RESEND_API_KEY: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    @field_validator("SECRET_KEY")
    @classmethod
    def _validate_secret_key(cls, value: str) -> str:
        if len(value.strip()) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters")
        return value

    @field_validator("DATABASE_URL")
    @classmethod
    def _validate_database_url(cls, value: str) -> str:
        if not value.startswith(("postgresql://", "postgresql+asyncpg://", "sqlite+aiosqlite://")):
            raise ValueError(
                "DATABASE_URL must start with postgresql://, postgresql+asyncpg:// or sqlite+aiosqlite://"
            )
        return value

    @field_validator("REDIS_URL")
    @classmethod
    def _validate_redis_url(cls, value: str) -> str:
        if not value.startswith(("redis://", "rediss://", "unix://")):
            raise ValueError("REDIS_URL must start with redis://, rediss:// or unix://")
        return value

    @model_validator(mode="after")
    def _validate_production(self) -> "Settings":
        if self.APP_ENV != "production":
            return self

        if "dev-secret-key" in self.SECRET_KEY.lower():
            raise ValueError("SECRET_KEY still holds a development placeholder in production")
        if self.DEBUG:
            raise ValueError("DEBUG must be disabled in production")
        if self.CORS_ORIGINS.strip() == "*":
            raise ValueError("CORS_ORIGINS must not be '*' in production")
        for origin in self.cors_origins_list:
            if not origin.startswith("https://"):
                raise ValueError(f"CORS origin must use https in production: {origin}")
        if self.MAIL_BACKEND == "smtp":
            raise ValueError("MAIL_BACKEND=smtp is not supported in production")
        if not self.R2_REQUIRED_OK:
            raise ValueError("R2 credentials are required in production")
        if self.COMPILE_BACKEND == "local" and not self.COMPILE_IMAGE:
            raise ValueError("COMPILE_IMAGE must be set when COMPILE_BACKEND=local")
        if self.COMPILE_BACKEND == "remote" and not (
            self.COMPILE_REMOTE_ENDPOINT and self.COMPILE_REMOTE_API_KEY
        ):
            raise ValueError(
                "COMPILE_REMOTE_ENDPOINT and COMPILE_REMOTE_API_KEY are required for remote compile"
            )
        return self

    @property
    def R2_REQUIRED_OK(self) -> bool:
        """True when R2 credentials are present."""
        return bool(self.R2_ACCOUNT_ID and self.R2_ACCESS_KEY_ID and self.R2_SECRET_ACCESS_KEY)

    @property
    def sqlalchemy_database_url(self) -> str:
        """DATABASE_URL rewritten for the async driver."""
        url = self.DATABASE_URL
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+asyncpg://", 1)
        return url

    @property
    def is_sqlite(self) -> bool:
        """True when running against SQLite (tests only)."""
        return self.sqlalchemy_database_url.startswith("sqlite")

    @property
    def cors_origins_list(self) -> list[str]:
        """Parse CORS_ORIGINS into a list of non-empty origins."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def allowed_hosts_list(self) -> list[str]:
        """Parse ALLOWED_HOSTS into a list; empty disables host checking."""
        hosts = [host.strip() for host in self.ALLOWED_HOSTS.split(",") if host.strip()]
        return [host for host in hosts if host != "*"]

    @property
    def allowed_email_domains_list(self) -> list[str]:
        """Parse ALLOWED_EMAIL_DOMAINS into a lowercase list."""
        return [
            domain.strip().lower().lstrip("@")
            for domain in self.ALLOWED_EMAIL_DOMAINS.split(",")
            if domain.strip()
        ]

    @property
    def is_production(self) -> bool:
        """Check if running in production."""
        return self.APP_ENV == "production"

    @property
    def is_development(self) -> bool:
        """Check if running in development."""
        return self.APP_ENV == "development"

    @property
    def is_test(self) -> bool:
        """Check if running under the test suite."""
        return self.APP_ENV == "test"


@lru_cache
def get_settings() -> Settings:
    """
    Get cached settings instance.
    Uses lru_cache to avoid re-reading env vars on every call.
    """
    return Settings()


# Convenience export
settings = get_settings()
