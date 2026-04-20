import subprocess
import tempfile
from pathlib import Path

from app.core.settings import MUSCLE_BIN, CLUSTALW_BIN, IQTREE_BIN


def run_muscle_alignment(fasta_text: str) -> str:
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        in_path = tmpdir / "input.fasta"
        out_path = tmpdir / "aligned.fasta"
        in_path.write_text(fasta_text)

        subprocess.run([MUSCLE_BIN, "-in", str(in_path), "-out", str(out_path)], check=True)
        return out_path.read_text()


def run_clustalw_alignment(fasta_text: str) -> str:
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        in_path = tmpdir / "input.fasta"
        out_path = tmpdir / "aligned.fasta"
        in_path.write_text(fasta_text)

        subprocess.run(
            [CLUSTALW_BIN, f"-INFILE={in_path}", f"-OUTFILE={out_path}", "-OUTPUT=FASTA"],
            check=True
        )
        return out_path.read_text()


def run_alignment(fasta_text: str, engine: str) -> str:
    engine = (engine or "muscle").lower()
    if engine == "muscle":
        return run_muscle_alignment(fasta_text)
    if engine == "clustalw":
        return run_clustalw_alignment(fasta_text)
    raise ValueError(f"Unknown engine: {engine}")


def run_iqtree_on_alignment(alignment_fasta: str) -> str:
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        aln_path = tmpdir / "alignment.fasta"
        aln_path.write_text(alignment_fasta)

        subprocess.run(
            [IQTREE_BIN, "-s", str(aln_path), "-nt", "AUTO", "-quiet"],
            check=True,
            cwd=str(tmpdir)
        )

        tree_path = tmpdir / "alignment.fasta.treefile"
        if not tree_path.exists():
            raise RuntimeError("IQ-TREE treefile oluşturamadı.")

        return tree_path.read_text()