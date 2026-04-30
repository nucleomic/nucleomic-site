import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse, PlainTextResponse, JSONResponse

from app.services.jobs import create_job, read_job, cancel_queued_job
from app.services.tree_contracts import (
    TREE_SCHEMA_VERSION,
    normalize_tree_request,
    validate_tree_request,
)

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
    try:
        request_payload = normalize_tree_request(payload)
        validate_tree_request(request_payload)

        return await create_job(
            "tree",
            request_payload["input"]["fasta_text"],
            request_payload["alignment"]["engine"],
            request_json=json.dumps(request_payload),
            schema_version=TREE_SCHEMA_VERSION,
            analysis_method=request_payload["analysis"]["method"],
            support_type=request_payload["analysis"]["support"]["type"],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
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

@router.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    result = await cancel_queued_job(job_id)

    if result is None:
        raise HTTPException(status_code=404, detail="Job bulunamadı.")

    if not result.get("ok"):
        raise HTTPException(
            status_code=409,
            detail=result.get("message") or "Job iptal edilemedi."
        )

    return result["job"]

@router.get("/api/jobs/{job_id}/result")
async def get_job_result(job_id: str):
    job = await read_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job bulunamadı.")
    if job.get("status") != "completed":
        raise HTTPException(status_code=409, detail="Sonuç henüz hazır değil.")

    if job.get("task_type") == "tree":
        raw_result_json = (job.get("result_json") or "").strip()

        if raw_result_json:
            try:
                return JSONResponse(json.loads(raw_result_json))
            except json.JSONDecodeError as exc:
                raise HTTPException(
                    status_code=500,
                    detail=f"Tree result_json parse edilemedi: {exc}"
                )

        # Geriye dönük güvenlik fallback'i
        return JSONResponse({
            "job_id": job_id,
            "status": "completed",
            "schema_version": "legacy-text",
            "result": {
                "analysis_id": job_id,
                "analysis_summary": None,
                "tree": {
                    "raw_newick": job.get("result_text", ""),
                    "format": "newick",
                    "rooting": {
                        "analysis_rooting": "unknown",
                        "viewer_rooting": None
                    },
                    "support": {
                        "present": False,
                        "type": "none",
                        "label_mode": None,
                        "range": None
                    }
                },
                "artifacts": {},
                "warnings": [],
                "provenance": {}
            },
            "error": ""
        })

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