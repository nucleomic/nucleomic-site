import asyncio
import time

from app.services.redis_db import get_redis
from app.core.settings import RESULT_TTL_SECONDS

async def cleanup_loop():
    redis = await get_redis()

    while True:
      now = int(time.time())

      async for key in redis.scan_iter(match="job:*", count=100):
          job = await redis.hgetall(key)
          if not job:
              continue

          created_at = int(job.get("created_at") or now)
          status = job.get("status", "")

          if status in {"completed", "failed", "cancelled"}:
              if (now - created_at) > RESULT_TTL_SECONDS:
                  await redis.delete(key)

      await asyncio.sleep(300)

if __name__ == "__main__":
    asyncio.run(cleanup_loop())