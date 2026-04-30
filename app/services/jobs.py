import time
import uuid

from app.core.settings import QUEUE_NAME, STALE_RUNNING_SECONDS
from .redis_db import get_redis


def job_key(job_id: str) -> str:
    return f"job:{job_id}"

def _safe_int(value, default=0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default

async def create_job(
    task_type: str,
    fasta_text: str,
    engine: str,
    *,
    request_json: str = "",
    schema_version: str = "",
    analysis_method: str = "",
    support_type: str = ""
):
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
        "updated_at": str(now),
        "running_at": "",
        "completed_at": "",
        "failed_at": "",
         "cancelled_at": "",
        "result_text": "",
        "result_json": "",
        "request_json": request_json,
        "schema_version": schema_version,
        "analysis_method": analysis_method,
        "support_type": support_type,
        "error": "",
        "error_type": ""
    }

    await redis.hset(job_key(job_id), mapping=payload)
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

async def cancel_queued_job(job_id: str):
    redis = await get_redis()
    key = job_key(job_id)

    data = await redis.hgetall(key)
    if not data:
        return None

    status = data.get("status")

    if status == "cancelled":
        data["position"] = None
        return {
            "ok": True,
            "job": data
        }

    if status != "queued":
        return {
            "ok": False,
            "status": status,
            "message": f"Only queued jobs can be cancelled. Current status: {status or 'unknown'}"
        }

    removed_count = await redis.lrem(QUEUE_NAME, 0, job_id)

    if removed_count <= 0:
        latest = await redis.hgetall(key)
        latest_status = latest.get("status") if latest else None

        return {
            "ok": False,
            "status": latest_status or status,
            "message": "Job is no longer waiting in the queue and cannot be cancelled."
        }

    now = int(time.time())

    await redis.hset(key, mapping={
        "status": "cancelled",
        "message": "Task cancelled.",
        "cancelled_at": str(now),
        "updated_at": str(now),
        "error": "",
        "error_type": ""
    })

    cancelled_job = await redis.hgetall(key)
    cancelled_job["position"] = None

    return {
        "ok": True,
        "job": cancelled_job
    }

async def fail_stale_running_jobs(max_age_seconds: int = STALE_RUNNING_SECONDS):
    redis = await get_redis()
    now = int(time.time())
    failed_job_ids = []

    async for key in redis.scan_iter(match="job:*"):
        data = await redis.hgetall(key)

        if not data:
            continue

        if data.get("status") != "running":
            continue

        started_at = _safe_int(
            data.get("running_at") or data.get("created_at"),
            default=now
        )

        age = now - started_at

        if age <= max_age_seconds:
            continue

        job_id = data.get("job_id") or str(key).split(":", 1)[-1]

        await redis.hset(key, mapping={
            "status": "failed",
            "message": "İşlem zaman aşımına uğradı",
            "error": f"Job stale running timeout exceeded ({age}s > {max_age_seconds}s).",
            "error_type": "stale_running_timeout",
            "failed_at": str(now),
            "updated_at": str(now)
        })

        failed_job_ids.append(job_id)

    return failed_job_ids