import json
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse, PlainTextResponse

from app.services.jobs import create_job, read_job
router = APIRouter()

@router.post("/api/jobs/msa")
async def create_msa_job(payload: dict):
    fasta_text = payload.get("fasta_text", "")
    engine = payload.get("engine", "muscle")
    if not fasta_text.strip():
        raise HTTPException(status_code=400, detail="fasta_text boş olamaz.")
    try:
        return await create_job("msa", fasta_text, engine)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"MSA job create failed: {type(exc).__name__}: {exc}"
        )
    
@router.post("/api/jobs/tree")
async def create_tree_job(payload: dict):
    fasta_text = payload.get("fasta_text", "")
    engine = payload.get("engine", "muscle")
    if not fasta_text.strip():
        raise HTTPException(status_code=400, detail="fasta_text boş olamaz.")
    try:
        return await create_job("tree", fasta_text, engine)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Tree job create failed: {type(exc).__name__}: {exc}"
        )

@router.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    job = await read_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job bulunamadı.")
    return job

@router.get("/api/jobs/{job_id}/result")
async def get_job_result(job_id: str):
    job = await read_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job bulunamadı.")
    if job.get("status") != "completed":
        raise HTTPException(status_code=409, detail="Sonuç henüz hazır değil.")
    return PlainTextResponse(job.get("result_text", ""))

@router.get("/api/jobs/{job_id}/stream")
async def stream_job(job_id: str, request: Request):
    async def event_stream():
        last_json = None

        while True:
            if await request.is_disconnected():
                break

            job = await read_job(job_id)
            if not job:
                payload = {"job_id": job_id, "status": "expired", "message": "Job kaydı bulunamadı"}
                yield f"data: {json.dumps(payload)}\n\n"
                break

            current = json.dumps(job)
            if current != last_json:
                yield f"data: {current}\n\n"
                last_json = current

            if job.get("status") in {"completed", "failed", "cancelled"}:
                break

            import asyncio
            await asyncio.sleep(1)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )