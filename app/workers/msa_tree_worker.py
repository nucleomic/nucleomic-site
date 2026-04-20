import asyncio
from app.services.redis_db import get_redis
from app.core.settings import QUEUE_NAME
from app.services.jobs import job_key
from app.services.analysis_tasks import run_alignment, run_iqtree_on_alignment


async def safe_hset(redis, key, mapping):
    try:
        await redis.hset(key, mapping=mapping)
        return redis
    except Exception:
        redis = await get_redis(force_reconnect=True)
        await redis.hset(key, mapping=mapping)
        return redis


async def worker_loop():
    redis = await get_redis(force_reconnect=True)
    print("=== WORKER START ===")
    print("QUEUE_NAME =", QUEUE_NAME)

    while True:
        try:
            item = await redis.blpop(QUEUE_NAME, timeout=5)
        except Exception as e:
            msg = str(e).lower()

            # Kuyruk boşken client read timeout'a düşüyorsa bunu idle durum kabul et
            if "timeout reading from" in msg:
                item = None
            else:
                print("BLPOP error:", e)
                redis = await get_redis(force_reconnect=True)
                await asyncio.sleep(1)
                continue

        if not item:
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

            redis = await safe_hset(redis, key, {
                "status": "running",
                "message": "Analiz ediliyor"
            })
            print("STATUS -> running")

            fasta_text = job["fasta_text"]
            engine = job.get("engine", "muscle")
            task_type = job.get("task_type")

            print("TASK TYPE =", task_type)
            print("ENGINE =", engine)

            if task_type == "msa":
                result_text = run_alignment(fasta_text, engine)
            elif task_type == "tree":
                aligned = run_alignment(fasta_text, engine)
                result_text = run_iqtree_on_alignment(aligned)
            else:
                raise RuntimeError(f"Bilinmeyen task_type: {task_type}")

            redis = await safe_hset(redis, key, {
                "status": "completed",
                "message": "Sonuç hazır",
                "result_text": result_text,
                "error": ""
            })
            print("STATUS -> completed")

        except Exception as exc:
            print("WORKER EXCEPTION:", exc)
            try:
                redis = await safe_hset(redis, key, {
                    "status": "failed",
                    "message": "İşlem başarısız",
                    "error": str(exc)
                })
                print("STATUS -> failed")
            except Exception as write_exc:
                print(f"Job fail state yazılamadı ({job_id}): {write_exc}")
                redis = await get_redis(force_reconnect=True)


if __name__ == "__main__":
    asyncio.run(worker_loop())