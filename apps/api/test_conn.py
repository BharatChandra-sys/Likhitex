import asyncio
import asyncpg
import traceback

async def test():
    try:
        print("Attempting to connect to postgresql://likhitex:admin123@localhost:5432/likhitex")
        conn = await asyncpg.connect(
            host='localhost',
            port=5432,
            user='likhitex',
            password='admin123',
            database='likhitex'
        )
        print("SUCCESS! Connected to database")
        version = await conn.fetchval('SELECT version()')
        print(f"PostgreSQL version: {version}")
        await conn.close()
        print("Connection closed successfully")
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test())
