"""
Test Redis connection (Upstash).

Usage (PowerShell, from apps/api):
    .\venv\Scripts\python.exe scripts\check_redis.py
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.cache.redis import init_redis, close_redis  # noqa: E402


async def main() -> int:
    """Test Redis connection with basic operations."""
    try:
        # Initialize Redis connection
        manager = await init_redis()
        redis = manager.redis
        
        # Test 1: SET
        test_key = "likhitex:healthcheck:test"
        test_value = "hello from likhitex"
        await redis.set(test_key, test_value, ex=60)
        print("1/4 SET           OK")
        
        # Test 2: GET
        result = await redis.get(test_key)
        if result != test_value:
            print(f"2/4 GET           FAILED: expected '{test_value}', got '{result}'")
            return 1
        print("2/4 GET           OK")
        
        # Test 3: EXISTS
        exists = await redis.exists(test_key)
        if not exists:
            print("3/4 EXISTS        FAILED: key should exist")
            return 1
        print("3/4 EXISTS        OK")
        
        # Test 4: DELETE
        await redis.delete(test_key)
        exists_after = await redis.exists(test_key)
        if exists_after:
            print("4/4 DELETE        FAILED: key should be gone")
            return 1
        print("4/4 DELETE        OK")
        
        print("\nRedis (Upstash) is configured correctly.")
        print(f"Connected to: {os.environ.get('REDIS_URL', 'unknown')}")
        return 0
        
    except Exception as exc:
        print(f"FAILED: {exc}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        await close_redis()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
