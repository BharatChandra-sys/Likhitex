"""
S3-compatible storage backend (Backblaze B2).

No network: the aioboto3 client is replaced with an in-memory fake, so these
tests pin how the backend talks to S3 rather than B2 itself.
"""
from typing import Any

import pytest

from app.config import Settings
from app.storage.backend import R2Storage, S3Storage, StorageError

B2_ENDPOINT = "https://s3.us-west-004.backblazeb2.com"


class _FakeBody:
    def __init__(self, data: bytes) -> None:
        self._data = data

    async def read(self) -> bytes:
        return self._data


class _FakeS3:
    """Just enough of the S3 client surface for the backend."""

    def __init__(self, store: dict[str, dict[str, Any]]) -> None:
        self.store = store

    async def __aenter__(self) -> "_FakeS3":
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    async def put_object(self, **kwargs: Any) -> None:
        self.store[kwargs["Key"]] = kwargs

    async def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803
        if Key not in self.store:
            raise KeyError(Key)
        return {"Body": _FakeBody(self.store[Key]["Body"])}

    async def delete_object(self, Bucket: str, Key: str) -> None:  # noqa: N803
        self.store.pop(Key, None)

    async def generate_presigned_url(self, op: str, Params: dict[str, str], ExpiresIn: int) -> str:  # noqa: N803
        return f"{B2_ENDPOINT}/{Params['Bucket']}/{Params['Key']}?X-Amz-Expires={ExpiresIn}"


@pytest.fixture
def b2(monkeypatch: pytest.MonkeyPatch) -> tuple[S3Storage, dict[str, dict[str, Any]]]:
    store: dict[str, dict[str, Any]] = {}
    storage = S3Storage(B2_ENDPOINT, "key-id", "app-key", "likhitex-files")
    monkeypatch.setattr(storage, "_client", lambda: _FakeS3(store))
    return storage, store


def test_region_is_derived_from_b2_endpoint() -> None:
    storage = S3Storage(B2_ENDPOINT, "key-id", "app-key", "bucket")
    assert storage.region == "us-west-004"


def test_explicit_region_wins() -> None:
    storage = S3Storage(B2_ENDPOINT, "key-id", "app-key", "bucket", region="eu-central-003")
    assert storage.region == "eu-central-003"


def test_incomplete_credentials_are_rejected() -> None:
    with pytest.raises(StorageError):
        S3Storage(B2_ENDPOINT, "", "app-key", "bucket")


def test_r2_still_builds_its_endpoint() -> None:
    storage = R2Storage("acct", "key-id", "secret", "bucket")
    assert storage.endpoint == "https://acct.r2.cloudflarestorage.com"
    assert storage.region == "auto"


async def test_round_trip(b2: tuple[S3Storage, dict[str, dict[str, Any]]]) -> None:
    storage, store = b2
    key = await storage.put("proj/ab/abcd/main.tex", b"\\documentclass{article}", "text/x-tex")

    assert store[key]["Bucket"] == "likhitex-files"
    assert store[key]["ServerSideEncryption"] == "AES256"
    assert await storage.get(key) == b"\\documentclass{article}"

    await storage.delete(key)
    with pytest.raises(StorageError):
        await storage.get(key)


async def test_presigned_url_is_capped_at_seven_days(
    b2: tuple[S3Storage, dict[str, dict[str, Any]]],
) -> None:
    storage, _ = b2
    url = await storage.get_presigned_url("proj/ab/abcd/main.tex", expires=10**9)
    assert url.endswith("X-Amz-Expires=604800")


async def test_traversal_keys_never_reach_the_bucket(
    b2: tuple[S3Storage, dict[str, dict[str, Any]]],
) -> None:
    storage, store = b2
    with pytest.raises(StorageError):
        await storage.put("../escape", b"x")
    assert store == {}


def _production_settings(**overrides: str) -> Settings:
    values = {
        "APP_ENV": "production",
        "SECRET_KEY": "x" * 40,
        "CLERK_SECRET_KEY": "sk_test",
        "DATABASE_URL": "postgresql://u:p@h/db",
        "REDIS_URL": "redis://localhost:6379",
        "CORS_ORIGINS": "https://likhitex.vercel.app",
        "STORAGE_BACKEND": "s3",
        **overrides,
    }
    return Settings(_env_file=None, **values)  # type: ignore[arg-type]


def test_production_requires_b2_credentials() -> None:
    with pytest.raises(ValueError, match="STORAGE_BACKEND=s3"):
        _production_settings()


def test_production_accepts_complete_b2_settings() -> None:
    settings = _production_settings(
        S3_ENDPOINT_URL=B2_ENDPOINT,
        S3_ACCESS_KEY_ID="key-id",
        S3_SECRET_ACCESS_KEY="app-key",  # noqa: S106
        S3_BUCKET_NAME="likhitex-files",
    )
    assert settings.S3_REQUIRED_OK
