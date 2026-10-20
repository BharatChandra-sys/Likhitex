"""
Storage backend interface.

Abstraction over object storage (Backblaze B2 / Cloudflare R2 / any S3) with a local filesystem
fallback for development.

Key handling: storage keys are derived from server-side data (project UUID +
content hash), never taken raw from the client. `safe_key()` re-validates
anyway, because a traversal here would escape the storage root.
"""
import hashlib
import logging
import os
import re
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)


class StorageError(RuntimeError):
    """Storage operation failed."""


class StorageBackend(ABC):
    """Abstract storage interface."""

    @abstractmethod
    async def put(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        """
        Store an object and return its key.

        Raises:
            StorageError: on any backend failure.
        """

    @abstractmethod
    async def get(self, key: str) -> bytes:
        """
        Retrieve object content.

        Raises:
            StorageError: when the key is missing or unreadable.
        """

    @abstractmethod
    async def delete(self, key: str) -> None:
        """Delete an object. Deleting a missing key is not an error."""

    @abstractmethod
    async def get_presigned_url(self, key: str, expires: int = 3600) -> str:
        """
        Get a time-limited direct download URL.

        Raises:
            StorageError: when a URL cannot be generated.
        """

    @staticmethod
    def compute_hash(data: bytes) -> str:
        """Compute the SHA256 content hash used for deduplication."""
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def build_key(project_id: Any, file_hash: str, filename: str) -> str:
        """
        Build a deterministic, content-addressed key.

        Content addressing means re-uploading identical bytes reuses one
        object, and a changed file produces a new key instead of mutating an
        object another file may still reference.
        """
        from app.files.schemas import validate_project_path

        safe_name = validate_project_path(filename)
        return f"{project_id}/{file_hash[:2]}/{file_hash}/{safe_name}"

    @staticmethod
    def safe_key(key: str) -> str:
        """
        Reject keys that could escape the storage root.

        Raises:
            StorageError: on absolute paths, traversal, or control characters.
        """
        if not key or not isinstance(key, str):
            raise StorageError("Invalid storage key")
        if key.startswith("/") or "\\" in key or "\x00" in key:
            raise StorageError("Invalid storage key")
        if any(part in ("", ".", "..") for part in key.split("/")):
            raise StorageError("Invalid storage key")
        if len(key) > 1024:
            raise StorageError("Storage key too long")
        return key


class S3Storage(StorageBackend):
    """
    Generic S3-compatible storage backend.

    Works with Backblaze B2, AWS S3, MinIO, and anything else that speaks the
    S3 API at a configurable endpoint.
    """

    def __init__(
        self,
        endpoint_url: str,
        access_key_id: str,
        secret_access_key: str,
        bucket_name: str,
        region: str = "",
    ) -> None:
        if not endpoint_url or not access_key_id or not secret_access_key or not bucket_name:
            raise StorageError("S3 credentials are incomplete")
        self.endpoint = endpoint_url.rstrip("/")
        self.access_key_id = access_key_id
        self.secret_access_key = secret_access_key
        self.bucket_name = bucket_name
        self.region = region or self.region_from_endpoint(self.endpoint)

    @staticmethod
    def region_from_endpoint(endpoint: str) -> str:
        """
        Derive the signing region from an endpoint like
        https://s3.us-west-004.backblazeb2.com. Presigned URLs only validate when
        signed for the bucket's real region, so guessing would break them.
        """
        match = re.match(r"^https?://s3\.([a-z0-9-]+)\.", endpoint)
        return match.group(1) if match else "us-east-1"

    def _client(self) -> Any:
        """Create an aioboto3 S3 client scoped to this endpoint."""
        try:
            import aioboto3
            from botocore.config import Config
        except ImportError as exc:  # pragma: no cover - dependency is declared
            raise StorageError("aioboto3 is required for S3 storage") from exc

        session = aioboto3.Session()
        return session.client(
            "s3",
            endpoint_url=self.endpoint,
            aws_access_key_id=self.access_key_id,
            aws_secret_access_key=self.secret_access_key,
            region_name=self.region,
            config=Config(
                signature_version="s3v4",
                # botocore >= 1.36 sends CRC checksums on every request by
                # default, which several S3-compatible services reject.
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )

    async def put(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        """Upload an object."""
        safe = self.safe_key(key)
        try:
            async with self._client() as s3:
                await s3.put_object(
                    Bucket=self.bucket_name,
                    Key=safe,
                    Body=data,
                    ContentType=content_type,
                    # Server-side encryption at rest (SSE-B2 on Backblaze).
                    ServerSideEncryption="AES256",
                )
        except Exception as exc:
            logger.error("S3 put(%s) failed: %s", safe, exc)
            raise StorageError("Failed to store object") from exc

        logger.info("Stored %s in object storage (%d bytes)", safe, len(data))
        return safe

    async def get(self, key: str) -> bytes:
        """Download an object."""
        safe = self.safe_key(key)
        try:
            async with self._client() as s3:
                response = await s3.get_object(Bucket=self.bucket_name, Key=safe)
                body = response["Body"]
                data: bytes = await body.read()
        except Exception as exc:
            logger.error("S3 get(%s) failed: %s", safe, exc)
            raise StorageError("Failed to read object") from exc
        return data

    async def delete(self, key: str) -> None:
        """Delete an object. Deleting a missing key is not an error."""
        safe = self.safe_key(key)
        try:
            async with self._client() as s3:
                await s3.delete_object(Bucket=self.bucket_name, Key=safe)
        except Exception as exc:
            # A failed cleanup must not fail the user's request; the object is
            # content-addressed so it is unreachable but harmless.
            logger.warning("S3 delete(%s) failed: %s", safe, exc)
            return
        logger.info("Deleted %s from object storage", safe)

    async def get_presigned_url(self, key: str, expires: int = 3600) -> str:
        """Generate a presigned GET URL."""
        safe = self.safe_key(key)
        try:
            async with self._client() as s3:
                url: str = await s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": self.bucket_name, "Key": safe},
                    ExpiresIn=max(1, min(expires, 604_800)),
                )
        except Exception as exc:
            logger.error("S3 presign(%s) failed: %s", safe, exc)
            raise StorageError("Failed to generate download URL") from exc
        return url


class R2Storage(S3Storage):
    """Cloudflare R2 storage: S3 with an account-derived endpoint."""

    def __init__(
        self,
        account_id: str,
        access_key_id: str,
        secret_access_key: str,
        bucket_name: str,
    ) -> None:
        if not account_id or not access_key_id or not secret_access_key:
            raise StorageError("R2 credentials are incomplete")
        self.account_id = account_id
        super().__init__(
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            bucket_name=bucket_name,
            region="auto",
        )


class LocalStorage(StorageBackend):
    """
    Local filesystem storage for development.

    Development only: files are world-readable on the host and are not
    encrypted. Every key is resolved against the base path, so a crafted key
    cannot read or write outside the storage root.
    """

    def __init__(self, base_path: str | None = None) -> None:
        self.base_path = Path(base_path or settings.LOCAL_STORAGE_PATH).resolve()
        self.base_path.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        """
        Map a storage key to an absolute path inside the storage root.

        Raises:
            StorageError: when the resolved path escapes the root.
        """
        safe = self.safe_key(key)
        candidate = (self.base_path / safe).resolve()
        if candidate != self.base_path and self.base_path not in candidate.parents:
            raise StorageError("Storage key resolves outside the storage root")
        return candidate

    async def put(
        self,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        """Write an object to disk."""
        target = self._resolve(key)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            # Write to a temp file then rename, so a reader never observes a
            # partially written object.
            temporary = target.with_suffix(target.suffix + ".partial")
            temporary.write_bytes(data)
            os.replace(temporary, target)
        except OSError as exc:
            logger.error("Local put(%s) failed: %s", key, exc)
            raise StorageError("Failed to store object") from exc

        logger.info("Stored %s locally (%d bytes)", key, len(data))
        return key

    async def get(self, key: str) -> bytes:
        """Read an object from disk."""
        target = self._resolve(key)
        if not target.is_file():
            raise StorageError("Object not found")
        try:
            return target.read_bytes()
        except OSError as exc:
            logger.error("Local get(%s) failed: %s", key, exc)
            raise StorageError("Failed to read object") from exc

    async def delete(self, key: str) -> None:
        """Delete an object from disk."""
        target = self._resolve(key)
        try:
            target.unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("Local delete(%s) failed: %s", key, exc)
            return
        logger.info("Deleted %s locally", key)

    async def get_presigned_url(self, key: str, expires: int = 3600) -> str:
        """Return a local file URI (not a network URL)."""
        target = self._resolve(key)
        return target.as_uri()


_storage_backend: StorageBackend | None = None


def get_storage() -> StorageBackend:
    """
    FastAPI dependency returning the configured storage backend.

    The instance is cached: creating an S3 client per request would rebuild
    the connection pool on every call.
    """
    global _storage_backend
    if _storage_backend is None:
        if settings.STORAGE_BACKEND == "s3":
            if not settings.S3_REQUIRED_OK:
                raise StorageError("S3 storage selected but credentials missing")
            _storage_backend = S3Storage(
                endpoint_url=settings.S3_ENDPOINT_URL,
                access_key_id=settings.S3_ACCESS_KEY_ID,
                secret_access_key=settings.S3_SECRET_ACCESS_KEY,
                bucket_name=settings.S3_BUCKET_NAME,
                region=settings.S3_REGION,
            )
            logger.info(
                "Using S3 storage backend (endpoint: %s, bucket: %s)",
                settings.S3_ENDPOINT_URL,
                settings.S3_BUCKET_NAME,
            )
        elif settings.STORAGE_BACKEND == "r2":
            if not settings.R2_REQUIRED_OK:
                raise StorageError("R2 storage selected but credentials missing")
            _storage_backend = R2Storage(
                account_id=settings.R2_ACCOUNT_ID,
                access_key_id=settings.R2_ACCESS_KEY_ID,
                secret_access_key=settings.R2_SECRET_ACCESS_KEY,
                bucket_name=settings.R2_BUCKET_NAME,
            )
            logger.info("Using R2 storage backend (bucket: %s)", settings.R2_BUCKET_NAME)
        else:
            _storage_backend = LocalStorage()
            logger.info("Using local filesystem storage (path: %s)", settings.LOCAL_STORAGE_PATH)
    return _storage_backend


def reset_storage() -> None:
    """Drop the cached backend (used by tests)."""
    global _storage_backend
    _storage_backend = None
