import asyncio
from server.redis_db import get_redis

async def main():
    r = await get_redis()
    print(await r.ping())

asyncio.run(main())