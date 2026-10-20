#!/bin/bash
# Pre-start script for production deployment
# Runs database migrations before starting the server

set -e  # Exit on error

echo "=== Likhitex Pre-Start Script ==="
echo "Environment: ${APP_ENV:-unknown}"

# Run database migrations
echo "Running database migrations..."
alembic upgrade head

echo "✓ Database migrations complete"

# Verify schema
echo "Verifying database schema..."
python -c "
import asyncio
from sqlalchemy import text
from app.db.base import get_engine

async def check():
    engine = get_engine()
    async with engine.begin() as conn:
        # Check alembic version
        result = await conn.execute(text('SELECT version_num FROM alembic_version'))
        version = result.scalar()
        print(f'  Schema version: {version}')
        
        # Check essential tables
        result = await conn.execute(
            text(
                \"SELECT table_name FROM information_schema.tables \"
                \"WHERE table_schema = 'public' \"
                \"ORDER BY table_name\"
            )
        )
        tables = [row[0] for row in result.fetchall()]
        print(f'  Tables: {len(tables)} found')
        print(f'  {', '.join(tables)}')
    await engine.dispose()

asyncio.run(check())
"

echo "✓ Schema verification complete"
echo "=== Ready to start server ==="
