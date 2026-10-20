"""
Live check of the S3/Backblaze B2 storage settings.

Uses the real S3Storage backend against your real bucket: uploads a tiny
object, reads it back, presigns a download URL, fetches it, then deletes the
object. Nothing is left in the bucket.

Usage (PowerShell, from apps/api):
    $env:S3_ENDPOINT_URL="https://s3.us-west-004.backblazeb2.com"
    $env:S3_ACCESS_KEY_ID="<keyID>"
    $env:S3_SECRET_ACCESS_KEY="<applicationKey>"
    $env:S3_BUCKET_NAME="<bucket>"
    .\\venv\\Scripts\\python.exe scripts\\check_b2.py
"""
import asyncio
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from app.storage.backend import S3Storage, StorageError  # noqa: E402

REQUIRED = ("S3_ENDPOINT_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET_NAME")


async def main() -> int:
    missing = [name for name in REQUIRED if not os.environ.get(name)]
    if missing:
        print(f"Missing environment variables: {', '.join(missing)}")
        return 2

    storage = S3Storage(
        endpoint_url=os.environ["S3_ENDPOINT_URL"],
        access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
        bucket_name=os.environ["S3_BUCKET_NAME"],
        region=os.environ.get("S3_REGION", ""),
    )
    print(f"Endpoint {storage.endpoint}  bucket {storage.bucket_name}  region {storage.region}")

    key = f"healthcheck/{uuid.uuid4()}/check.txt"
    payload = b"likhitex b2 check"
    try:
        await storage.put(key, payload, "text/plain")
        print("1/4 upload        OK")

        if await storage.get(key) != payload:
            print("2/4 download      FAILED: content mismatch")
            return 1
        print("2/4 download      OK")

        url = await storage.get_presigned_url(key, expires=120)
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(url)
        if response.status_code != 200 or response.content != payload:
            print(f"3/4 presigned URL FAILED: HTTP {response.status_code} {response.text[:300]}")
            return 1
        print("3/4 presigned URL OK")
    except StorageError as exc:
        print(f"FAILED: {exc} (cause: {exc.__cause__})")
        return 1
    finally:
        await storage.delete(key)

    print("4/4 cleanup       OK")
    print("Backblaze B2 is configured correctly.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
