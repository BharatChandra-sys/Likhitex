import asyncio
import asyncpg

async def test():
    try:
        print("Attempting to connect to 172.18.0.3:5432")
        conn = await asyncpg.connect(
            host='172.18.0.3',
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

if __name__ == "__main__":
    asyncio.run(test())
