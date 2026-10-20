import asyncio
import asyncpg

async def test():
    try:
        print("Attempting to connect to 127.0.0.1:5432 WITHOUT password")
        conn = await asyncpg.connect(
            host='127.0.0.1',
            port=5432,
            user='likhitex',
            database='likhitex',
            timeout=10
        )
        print("SUCCESS! Connected to database")
        version = await conn.fetchval('SELECT version()')
        print(f"PostgreSQL version: {version}")
        await conn.close()
        print("Connection closed successfully")
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(test())
