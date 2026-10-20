"""
Test Neon Postgres connection.

Usage (PowerShell, from apps/api):
    .\venv\Scripts\python.exe scripts\check_db.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.config import settings  # noqa: E402


async def main() -> int:
    """Test database connection with basic operations."""
    print(f"Testing connection to: {settings.DATABASE_URL.split('@')[1].split('/')[0]}")
    
    engine = create_async_engine(
        settings.sqlalchemy_database_url,
        pool_size=2,
        max_overflow=0,
        pool_pre_ping=True,
        echo=False,
        connect_args={"ssl": "require"},  # For asyncpg SSL requirement
    )
    
    try:
        # Test 1: Basic connection
        async with engine.begin() as conn:
            result = await conn.execute(text("SELECT 1 as test"))
            row = result.fetchone()
            if row[0] != 1:
                print("1/5 Connection    FAILED: unexpected result")
                return 1
        print("1/5 Connection    OK")
        
        # Test 2: Check Postgres version
        async with engine.begin() as conn:
            result = await conn.execute(text("SELECT version()"))
            version = result.scalar()
            print(f"2/5 Version       OK - {version.split(',')[0]}")
        
        # Test 3: Check database name
        async with engine.begin() as conn:
            result = await conn.execute(text("SELECT current_database()"))
            db_name = result.scalar()
            print(f"3/5 Database      OK - {db_name}")
        
        # Test 4: Check if we can create a temp table
        async with engine.begin() as conn:
            await conn.execute(text(
                "CREATE TEMP TABLE healthcheck (id SERIAL PRIMARY KEY, value TEXT)"
            ))
            await conn.execute(text(
                "INSERT INTO healthcheck (value) VALUES ('test')"
            ))
            result = await conn.execute(text("SELECT value FROM healthcheck"))
            value = result.scalar()
            if value != 'test':
                print("4/5 Write/Read    FAILED: unexpected value")
                return 1
        print("4/5 Write/Read    OK")
        
        # Test 5: Check connection pool
        async with engine.connect() as conn1:
            async with engine.connect() as conn2:
                result1 = await conn1.execute(text("SELECT pg_backend_pid()"))
                result2 = await conn2.execute(text("SELECT pg_backend_pid()"))
                pid1 = result1.scalar()
                pid2 = result2.scalar()
                print(f"5/5 Pool          OK - PIDs: {pid1}, {pid2}")
        
        print("\nNeon Postgres is configured correctly.")
        print(f"✅ Ready for Alembic migrations")
        return 0
        
    except Exception as exc:
        print(f"\nFAILED: {exc}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        await engine.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
