import json
import time
import uuid

from app.core.settings import QUEUE_NAME
from .redis_db import get_redis


def job_key(job_id: str) -> str:
    return f"job:{job_id}"


async def create_job(task_type: str, fasta_text: str, engine: str):
    redis = await get_redis()
    job_id = uuid.uuid4().hex
    now = int(time.time())

    payload = {
        "job_id": job_id,
        "task_type": task_type,
        "status": "queued",
        "message": "Sırada bekliyor",
        "engine": engine,
        "fasta_text": fasta_text,
        "created_at": str(now),
        "result_text": "",
        "error": ""
    }

    await redis.hset(job_key(job_id), mapping=payload)

    # Redis RPUSH listenin yeni uzunluğunu döndürür.
    queue_length = await redis.rpush(QUEUE_NAME, job_id)

    return {
        "job_id": job_id,
        "status": "queued",
        "position": queue_length
    }


async def read_job(job_id: str):
    redis = await get_redis()
    data = await redis.hgetall(job_key(job_id))
    if not data:
        return None

    if data.get("status") == "queued":
        queue = await redis.lrange(QUEUE_NAME, 0, -1)
        try:
          data["position"] = queue.index(job_id) + 1
        except ValueError:
          data["position"] = None
    else:
        data["position"] = None

    return data