"""
Application configuration.
All settings loaded from environment variables.
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment."""

    # App
    APP_NAME: str = "Likhitex"
    APP_ENV: Literal["development", "production"] = "development"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    
    # Security
    SECRET_KEY: str  # Required: min 32 chars
    CLERK_SECRET_KEY: str  # Required
    
    # Database
    DATABASE_URL: str  # Required: postgresql://...
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 2
    DB_POOL_RECYCLE: int = 300  # 5 minutes
    DB_POOL_TIMEOUT: int = 10
    DB_ECHO: bool = False  # Set True for SQL debugging
    
    # Redis
    REDIS_URL: str  # Required: redis://...
    
    # Storage (Cloudflare R2)
    R2_ACCOUNT_ID: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = "likhitex-files"
    R2_PUBLIC_URL: str = ""
    
    # CORS
    CORS_ORIGINS: str = "http://localhost:3000"  # Comma-separated
    
    # Rate Limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_COMPILE_PER_USER: int = 10  # per minute
    RATE_LIMIT_COMPILE_GLOBAL: int = 50    # per minute
    RATE_LIMIT_UPLOAD_PER_USER: int = 50   # per minute
    
    # Quotas
    QUOTA_PER_USER_MB: int = 50
    QUOTA_PER_PROJECT_MB: int = 50
    QUOTA_PER_FILE_MB: int = 10
    
    # Compile
    COMPILE_TIMEOUT_SECONDS: int = 60
    COMPILE_MAX_QUEUE_SIZE: int = 10
    COMPILE_BACKEND: Literal["local", "remote"] = "local"
    
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
    )
    
    @property
    def cors_origins_list(self) -> list[str]:
        """Parse CORS_ORIGINS into list."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]
    
    @property
    def is_production(self) -> bool:
        """Check if running in production."""
        return self.APP_ENV == "production"
    
    @property
    def is_development(self) -> bool:
        """Check if running in development."""
        return self.APP_ENV == "development"


@lru_cache
def get_settings() -> Settings:
    """
    Get cached settings instance.
    Uses lru_cache to avoid re-reading env vars on every call.
    """
    return Settings()


# Convenience export
settings = get_settings()
