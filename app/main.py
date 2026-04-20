# api.py
import os
import logging
import tempfile
import subprocess
from io import StringIO
from pathlib import Path
from typing import List

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from Bio.Seq import Seq
from Bio.SeqRecord import SeqRecord
from Bio import SeqIO

from app.services.redis_db import get_redis
from app.core.ab1_core import process_ab1_file
from app.routers.contact import router as contact_router
from app.routers.queue import router as queue_router
from app.core.settings import (
    MUSCLE_BIN,
    CLUSTALW_BIN,
    IQTREE_BIN,
    FRONTEND_DIR,
    LOG_DIR,
    TMP_DIR,
)

logging.basicConfig(level=logging.DEBUG)

LOG_DIR.mkdir(parents=True, exist_ok=True)
TMP_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_ORIGINS_RAW = os.getenv(
    "ALLOWED_ORIGINS",
    "https://nucleomic.com,https://www.nucleomic.com"
)
ALLOWED_ORIGINS = [o.strip() for o in ALLOWED_ORIGINS_RAW.split(",") if o.strip()]

def build_fasta_from_uploads(files, quality_threshold: int, mode: str, position_expr: str) -> str:
    """
    UploadFile listesini alır, ab1_core.process_ab1_file ile işler ve
    tek bir FASTA string'i döndürür.
    """
    records = []

    for f in files:
        contents = f.file.read()
        from io import BytesIO
        bio = BytesIO(contents)
        bio.name = f.filename

        res = process_ab1_file(
            bio,
            thr=quality_threshold,
            mode=mode,
            pos_expr=position_expr,
        )

        rec = SeqRecord(
            Seq(res["sequence"]),
            id=res["filename"],
            description="",
        )
        records.append(rec)

    handle = StringIO()
    SeqIO.write(records, handle, "fasta")
    return handle.getvalue()

def run_muscle_alignment(fasta_text: str) -> str:
    """
    FASTA string alır, MUSCLE ile MSA üretir ve hizalanmış FASTA'yı string olarak döndürür.
    """
    muscle_path = Path(MUSCLE_BIN)
    if not muscle_path.exists():
        raise RuntimeError(f"MUSCLE bulunamadı: {muscle_path}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        in_path = tmpdir / "input.fasta"
        out_path = tmpdir / "aligned.fasta"

        in_path.write_text(fasta_text)

        cmd = [str(muscle_path), "-in", str(in_path), "-out", str(out_path)]
        subprocess.run(cmd, check=True)

        return out_path.read_text()


def run_clustalw_alignment(fasta_text: str) -> str:
    clustalw_path = Path(CLUSTALW_BIN)
    if not clustalw_path.exists():
        raise RuntimeError(f"ClustalW bulunamadı: {clustalw_path}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        in_path = tmpdir / "input.fasta"
        out_path = tmpdir / "aligned.fasta"

        in_path.write_text(fasta_text)

        cmd = [
            str(clustalw_path),
            f"-INFILE={in_path}",
            f"-OUTFILE={out_path}",
            "-OUTPUT=FASTA",
        ]
        subprocess.run(cmd, check=True)

        return out_path.read_text()


def run_alignment(fasta_text: str, engine: str) -> str:
    """
    engine: 'muscle' veya 'clustalw'
    """
    engine = engine.lower()
    if engine == "muscle":
        return run_muscle_alignment(fasta_text)
    elif engine == "clustalw":
        return run_clustalw_alignment(fasta_text)
    else:
        raise ValueError(f"Bilinmeyen MSA engine: {engine}")


app = FastAPI(title="Nucleomic AB1 API")
app.include_router(contact_router)
app.include_router(queue_router)

def run_iqtree_on_alignment(alignment_fasta: str) -> str:
    """
    alignment_fasta: hizalanmış FASTA metni (MSA çıktısı)
    IQ-TREE çalıştırır ve .treefile (Newick) içeriğini string olarak döndürür.
    """
    iqtree_path = Path(IQTREE_BIN)
    if not iqtree_path.exists():
        raise RuntimeError(f"IQ-TREE bulunamadı: {iqtree_path}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        aln_path = tmpdir / "alignment.fasta"
        aln_path.write_text(alignment_fasta)

        cmd = [
            str(iqtree_path),
            "-s", str(aln_path),
            "-nt", "AUTO",
            "-quiet",
        ]

        subprocess.run(cmd, check=True, cwd=str(tmpdir))

        tree_path = tmpdir / "alignment.fasta.treefile"
        if not tree_path.exists():
            raise RuntimeError("IQ-TREE treefile oluşturamadı.")

        return tree_path.read_text()

@app.get("/api/health/redis")
async def redis_health():
    try:
        r = await get_redis(force_reconnect=True)
        pong = await r.ping()
        return {"ok": bool(pong), "redis_url": "127.0.0.1:6379"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Redis not ready: {type(exc).__name__}: {exc}")

# CORS (lokal geliştirme için full açık)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,        
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/run_tree")
async def api_run_tree(
    files: List[UploadFile] = File(..., description=".ab1 files"),
    quality_threshold: int = Form(20),
    mode: str = Form("gap"),
    position_expr: str = Form(""),
    engine: str = Form("muscle"),  # MSA motoru: muscle | clustalw
):
    """
    1) .ab1 dosyalarından FASTA üretir
    2) Seçilen MSA motoru ile hizalar
    3) IQ-TREE ile filogenetik ağaç çıkarır
    4) Newick formatında tree döner
    """
    # 1. FASTA
    fasta_text = build_fasta_from_uploads(files, quality_threshold, mode, position_expr)

    # 2. MSA
    aligned_text = run_alignment(fasta_text, engine=engine)

    # 3. IQ-TREE
    newick_text = run_iqtree_on_alignment(aligned_text)

    return PlainTextResponse(
        newick_text,
        headers={
            "Content-Disposition": 'attachment; filename="tree.nwk"'
        },
    )

@app.post("/api/process_ab1")
async def api_process_ab1(
    files: List[UploadFile] = File(..., description=".ab1 files"),
    quality_threshold: int = Form(20),
    mode: str = Form("gap"),            # "gap" | "mask" | "delete"
    position_expr: str = Form(""),      # "0-50,80,90,172,456,500+"
):
    results = []
    for f in files:
        contents = await f.read()
        from io import BytesIO

        bio = BytesIO(contents)
        bio.name = f.filename  

        try:
            res = process_ab1_file(
                bio,
                thr=quality_threshold,
                mode=mode,
                pos_expr=position_expr,
            )
            results.append({"ok": True, "data": res})
        except Exception as e:
            results.append({"ok": False, "filename": f.filename, "error": str(e)})

    return JSONResponse({"ok": True, "results": results})

@app.post("/api/process_ab1_fasta")
async def api_process_ab1_fasta(
    files: List[UploadFile] = File(..., description=".ab1 files"),
    quality_threshold: int = Form(20),
    mode: str = Form("gap"),
    position_expr: str = Form(""),
):
    
    fasta_text = build_fasta_from_uploads(files, quality_threshold, mode, position_expr)
    return PlainTextResponse(
        fasta_text,
        headers={
            "Content-Disposition": 'attachment; filename="sequences.fasta"'
        },
    )

@app.post("/api/run_msa")
async def api_run_msa(
    files: List[UploadFile] = File(..., description=".ab1 files"),
    quality_threshold: int = Form(20),
    mode: str = Form("gap"),
    position_expr: str = Form(""),
    engine: str = Form("muscle"),   # muscle | clustalw
):
    fasta_text = build_fasta_from_uploads(files, quality_threshold, mode, position_expr)
    aligned = run_alignment(fasta_text, engine=engine)
    filename = f"alignment_{engine}.fasta"
    return PlainTextResponse(
        aligned,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )

app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
