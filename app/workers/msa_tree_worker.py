import asyncio
import json
import time

from app.services.redis_db import get_redis
from app.core.settings import QUEUE_NAME, JOB_TIMEOUT_SECONDS
from app.services.jobs import job_key, fail_stale_running_jobs
from app.services.analysis_tasks import run_alignment, run_tree_analysis
from app.services.tree_contracts import (
    TREE_SCHEMA_VERSION,
    build_tree_analysis_result,
    normalize_tree_request,
    validate_tree_request,
)


async def safe_hset(redis, key, mapping):
    try:
        await redis.hset(key, mapping=mapping)
        return redis
    except Exception:
        redis = await get_redis(force_reconnect=True)
        await redis.hset(key, mapping=mapping)
        return redis


def load_tree_request_from_job(job: dict) -> dict:
    raw_request_json = (job.get("request_json") or "").strip()

    if raw_request_json:
        return json.loads(raw_request_json)

    # Geriye dönük fallback
    return normalize_tree_request({
        "task_type": "tree",
        "fasta_text": job.get("fasta_text", ""),
        "engine": job.get("engine", "muscle")
    })

def build_msa_job_result_mapping(job: dict) -> dict:
    now = int(time.time())

    fasta_text = job["fasta_text"]
    engine = job.get("engine", "muscle")

    result_text = run_alignment(fasta_text, engine)

    return {
        "status": "completed",
        "message": "Sonuç hazır",
        "result_text": result_text,
        "error": "",
        "error_type": "",
        "completed_at": str(now),
        "updated_at": str(now)
    }


def build_tree_job_result_mapping(job_id: str, job: dict) -> dict:
    started_at = time.time()

    request_payload = load_tree_request_from_job(job)
    validate_tree_request(request_payload)

    alignment_engine = request_payload["alignment"]["engine"]
    fasta_text = request_payload["input"]["fasta_text"]

    aligned_fasta = run_alignment(fasta_text, alignment_engine)
    analysis_output = run_tree_analysis(request_payload, aligned_fasta)

    raw_newick = analysis_output["raw_newick"]
    runtime_seconds = round(time.time() - started_at, 3)
    now = int(time.time())

    artifacts = analysis_output.get("artifacts") or {}

    result_json = {
        "job_id": job_id,
        "status": "completed",
        "message": "Sonuç hazır",
        "schema_version": job.get("schema_version") or TREE_SCHEMA_VERSION,
        "result": build_tree_analysis_result(
            request_payload,
            raw_newick,
            aligned_fasta,
            warnings=analysis_output.get("warnings") or [],
            provenance={
                "engine_name": analysis_output.get("engine_name"),
                "engine_version": analysis_output.get("engine_version"),
                "runtime_seconds": runtime_seconds,
                "safe_command": artifacts.get("safe_command") or []
            },
            artifacts=artifacts,
            analysis_id=job_id
        ),
        "error": ""
    }

    return {
        "status": "completed",
        "message": "Sonuç hazır",
        "result_text": raw_newick,
        "result_json": json.dumps(result_json),
        "schema_version": job.get("schema_version") or TREE_SCHEMA_VERSION,
        "error": "",
        "error_type": "",
        "completed_at": str(now),
        "updated_at": str(now)
    }

async def worker_loop():
    redis = await get_redis(force_reconnect=True)
    print("=== WORKER START ===")
    print("QUEUE_NAME =", QUEUE_NAME)
    print("JOB_TIMEOUT_SECONDS =", JOB_TIMEOUT_SECONDS)

    try:
        failed_stale = await fail_stale_running_jobs()
        if failed_stale:
            print("STALE RUNNING JOBS FAILED ON START =", failed_stale)
    except Exception as exc:
        print("STALE CLEANUP ON START FAILED:", exc)

    last_stale_scan = 0

    while True:
        try:
            item = await redis.blpop(QUEUE_NAME, timeout=5)
        except Exception as e:
            msg = str(e).lower()

            if "timeout reading from" in msg:
                item = None
            else:
                print("BLPOP error:", e)
                redis = await get_redis(force_reconnect=True)
                await asyncio.sleep(1)
                continue

        if not item:
            now = time.time()
            if now - last_stale_scan >= 60:
                try:
                    failed_stale = await fail_stale_running_jobs()
                    if failed_stale:
                        print("STALE RUNNING JOBS FAILED =", failed_stale)
                except Exception as exc:
                    print("STALE CLEANUP FAILED:", exc)
                last_stale_scan = now

            continue

        _, job_id = item
        print("PICKED JOB =", job_id)

        key = job_key(job_id)
        print("JOB KEY =", key)

        try:
            job = await redis.hgetall(key)
            print("JOB DATA =", job)

            if not job:
                print("JOB HASH BULUNAMADI")
                continue

            current_status = job.get("status")
            if current_status != "queued":
                print("JOB SKIPPED - non-queued status =", current_status)
                continue

            running_now = int(time.time())

            redis = await safe_hset(redis, key, {
                "status": "running",
                "message": "Analiz ediliyor",
                "running_at": str(running_now),
                "updated_at": str(running_now),
                "worker_timeout_seconds": str(JOB_TIMEOUT_SECONDS)
            })
            print("STATUS -> running")

            task_type = job.get("task_type")
            print("TASK TYPE =", task_type)

            if task_type == "msa":
                result_mapping = await asyncio.wait_for(
                    asyncio.to_thread(build_msa_job_result_mapping, job),
                    timeout=JOB_TIMEOUT_SECONDS
                )

                redis = await safe_hset(redis, key, result_mapping)
                print("STATUS -> completed")
                continue

            if task_type == "tree":
                result_mapping = await asyncio.wait_for(
                    asyncio.to_thread(build_tree_job_result_mapping, job_id, job),
                    timeout=JOB_TIMEOUT_SECONDS
                )

                redis = await safe_hset(redis, key, result_mapping)
                print("STATUS -> completed")
                continue
            raise RuntimeError(f"Bilinmeyen task_type: {task_type}")

        except asyncio.TimeoutError:
            print("WORKER TIMEOUT:", job_id)
            now = int(time.time())

            try:
                redis = await safe_hset(redis, key, {
                    "status": "failed",
                    "message": "İşlem zaman aşımına uğradı",
                    "error": f"Job exceeded timeout limit ({JOB_TIMEOUT_SECONDS}s).",
                    "error_type": "job_timeout",
                    "failed_at": str(now),
                    "updated_at": str(now)
                })
                print("STATUS -> failed timeout")
            except Exception as write_exc:
                print(f"Job timeout fail state yazılamadı ({job_id}): {write_exc}")
                redis = await get_redis(force_reconnect=True)

        except Exception as exc:
            print("WORKER EXCEPTION:", exc)
            now = int(time.time())

            try:
                redis = await safe_hset(redis, key, {
                    "status": "failed",
                    "message": "İşlem başarısız",
                    "error": str(exc),
                    "error_type": type(exc).__name__,
                    "failed_at": str(now),
                    "updated_at": str(now)
                })
                print("STATUS -> failed")
            except Exception as write_exc:
                print(f"Job fail state yazılamadı ({job_id}): {write_exc}")
                redis = await get_redis(force_reconnect=True)


if __name__ == "__main__":
    asyncio.run(worker_loop())