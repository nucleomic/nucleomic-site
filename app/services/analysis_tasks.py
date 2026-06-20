import math
import subprocess
import tempfile
from io import StringIO
from pathlib import Path

from Bio import AlignIO, Phylo
from Bio.Phylo.TreeConstruction import (
    DistanceCalculator,
    DistanceMatrix,
    DistanceTreeConstructor,
)

from app.core.settings import (
    MUSCLE_BIN,
    CLUSTALW_BIN,
    IQTREE_BIN,
    MSA_COMMAND_TIMEOUT_SECONDS,
    TREE_COMMAND_TIMEOUT_SECONDS,
)
from app.services.tree_contracts import collect_tree_run_warnings


def run_muscle_alignment(fasta_text: str) -> str:
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        in_path = tmpdir / "input.fasta"
        out_path = tmpdir / "aligned.fasta"
        in_path.write_text(fasta_text)

        subprocess.run(
            [MUSCLE_BIN, "-in", str(in_path), "-out", str(out_path)],
            check=True,
            timeout=MSA_COMMAND_TIMEOUT_SECONDS
        )
        return out_path.read_text()


def run_clustalw_alignment(fasta_text: str) -> str:
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        in_path = tmpdir / "input.fasta"
        out_path = tmpdir / "aligned.fasta"
        in_path.write_text(fasta_text)

        subprocess.run(
            [CLUSTALW_BIN, f"-INFILE={in_path}", f"-OUTFILE={out_path}", "-OUTPUT=FASTA"],
            check=True,
            timeout=MSA_COMMAND_TIMEOUT_SECONDS
        )
        return out_path.read_text()


def run_alignment(fasta_text: str, engine: str) -> str:
    engine = (engine or "muscle").lower()
    if engine == "muscle":
        return run_muscle_alignment(fasta_text)
    if engine == "clustalw":
        return run_clustalw_alignment(fasta_text)
    raise ValueError(f"Unknown engine: {engine}")


def _read_alignment_from_fasta(fasta_text: str):
    return AlignIO.read(StringIO(fasta_text), "fasta")


def _tree_to_newick_text(tree) -> str:
    handle = StringIO()
    Phylo.write(tree, handle, "newick")
    return handle.getvalue().strip()

BUILTIN_DISTANCE_MODELS = {"identity", "blastn", "trans"}
CUSTOM_DISTANCE_MODELS = {"p_distance", "jc69", "k2p"}
VALID_DNA_BASES = {"A", "C", "G", "T"}
TRANSITIONS = {
    ("A", "G"),
    ("G", "A"),
    ("C", "T"),
    ("T", "C"),
}

def _safe_iqtree_command_summary(
    *,
    model: str,
    support_enabled: bool,
    support_type: str,
    support_replicates: int
) -> list[str]:
    cmd = [
        "iqtree",
        "-s", "<alignment.fasta>",
        "-nt", "AUTO",
        "-quiet",
        "-pre", "<analysis_prefix>",
    ]

    if model.upper() == "AUTO":
        cmd += ["-m", "TEST"]
    else:
        cmd += ["-m", model]

    if support_enabled:
        if support_type == "bootstrap":
            cmd += ["-b", str(support_replicates)]
        elif support_type == "ufboot":
            cmd += ["-bb", str(support_replicates)]

    return cmd

def _normalized_alignment_rows(alignment):
    return [(record.id, str(record.seq).upper()) for record in alignment]


def _pairwise_dna_site_stats(seq_a: str, seq_b: str):
    valid_sites = 0
    differences = 0
    transitions = 0
    transversions = 0

    for a, b in zip(seq_a, seq_b):
        if a not in VALID_DNA_BASES or b not in VALID_DNA_BASES:
            continue

        valid_sites += 1

        if a == b:
            continue

        differences += 1
        if (a, b) in TRANSITIONS:
            transitions += 1
        else:
            transversions += 1

    return valid_sites, differences, transitions, transversions


def _compute_custom_dna_distance(model: str, seq_a: str, seq_b: str) -> float:
    valid_sites, differences, transitions, transversions = _pairwise_dna_site_stats(seq_a, seq_b)

    if valid_sites == 0:
        raise ValueError("Distance hesaplamak için karşılaştırılabilir A/C/G/T sitesi bulunamadı.")

    if model == "p_distance":
        return differences / valid_sites

    if model == "jc69":
        p = differences / valid_sites
        inner = 1.0 - (4.0 * p / 3.0)
        if inner <= 0:
            raise ValueError("JC69 distance bu dizi çifti için tanımsız (çok yüksek divergence).")
        return -0.75 * math.log(inner)

    if model == "k2p":
        P = transitions / valid_sites
        Q = transversions / valid_sites
        inner1 = 1.0 - (2.0 * P) - Q
        inner2 = 1.0 - (2.0 * Q)
        if inner1 <= 0 or inner2 <= 0:
            raise ValueError("K2P distance bu dizi çifti için tanımsız (çok yüksek divergence).")
        return (-0.5 * math.log(inner1)) - (0.25 * math.log(inner2))

    raise ValueError(f"Unknown custom DNA distance model: {model}")


def _build_custom_distance_matrix(alignment_fasta: str, model: str) -> DistanceMatrix:
    alignment = _read_alignment_from_fasta(alignment_fasta)
    rows = _normalized_alignment_rows(alignment)

    names = [name for name, _seq in rows]
    seqs = [seq for _name, seq in rows]

    matrix = []
    for i in range(len(names)):
        row = []
        for j in range(i + 1):
            if i == j:
                row.append(0.0)
            else:
                row.append(round(_compute_custom_dna_distance(model, seqs[i], seqs[j]), 10))
        matrix.append(row)

    return DistanceMatrix(names=names, matrix=matrix)

def run_distance_tree_on_alignment(
    alignment_fasta: str,
    *,
    method: str,
    distance_model: str = "k2p"
) -> dict:
    constructor = DistanceTreeConstructor()
    selected_model = (distance_model or "k2p").lower()

    if selected_model in CUSTOM_DISTANCE_MODELS:
        distance_matrix = _build_custom_distance_matrix(alignment_fasta, selected_model)
        engine_name = f"custom_distance_{method}"
    elif selected_model in BUILTIN_DISTANCE_MODELS:
        alignment = _read_alignment_from_fasta(alignment_fasta)
        calculator = DistanceCalculator(selected_model)
        distance_matrix = calculator.get_distance(alignment)
        engine_name = f"biopython_{method}"
    else:
        raise ValueError(f"Unknown distance model: {selected_model}")

    if method == "nj":
        tree = constructor.nj(distance_matrix)
    elif method == "upgma":
        tree = constructor.upgma(distance_matrix)
    else:
        raise ValueError(f"Unknown distance tree method: {method}")

    raw_newick = _tree_to_newick_text(tree)

    return {
        "raw_newick": raw_newick,
        "engine_name": engine_name,
        "artifacts": {
            "distance_model": selected_model,
            "tree_method": method
        },
        "warnings": []
    }


def run_iqtree_ml_on_alignment(
    alignment_fasta: str,
    *,
    substitution_model: str | None = "AUTO",
    support: dict | None = None
) -> dict:
    support = support or {}

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)

        aln_path = tmpdir / "alignment.fasta"
        prefix = tmpdir / "analysis"

        aln_path.write_text(alignment_fasta)

        cmd = [
            IQTREE_BIN,
            "-s", str(aln_path),
            "-nt", "AUTO",
            "-quiet",
            "-pre", str(prefix)
        ]

        model = (substitution_model or "AUTO").strip()
        if model.upper() == "AUTO":
            cmd += ["-m", "TEST"]
        else:
            cmd += ["-m", model]

        support_enabled = bool(support.get("enabled"))
        support_type = (support.get("type") or "none").lower()
        support_replicates = int(support.get("replicates") or 0)

        if support_enabled:
            if support_type == "bootstrap":
                cmd += ["-b", str(support_replicates)]
            elif support_type == "ufboot":
                cmd += ["-bb", str(support_replicates)]
            else:
                raise ValueError(f"Unknown ML support type: {support_type}")

        subprocess.run(
            cmd,
            check=True,
            cwd=str(tmpdir),
            timeout=TREE_COMMAND_TIMEOUT_SECONDS
        )

        tree_path = tmpdir / "analysis.treefile"
        iqtree_path = tmpdir / "analysis.iqtree"
        log_path = tmpdir / "analysis.log"

        if not tree_path.exists():
            raise RuntimeError("IQ-TREE treefile oluşturamadı.")

        return {
            "raw_newick": tree_path.read_text().strip(),
            "engine_name": "iqtree",
            "artifacts": {
                "tree_method": "ml",
                "requested_substitution_model": model,
                "support_type": support_type if support_enabled else "none",
                "support_replicates": support_replicates if support_enabled else 0,
                "safe_command": _safe_iqtree_command_summary(
                    model=model,
                    support_enabled=support_enabled,
                    support_type=support_type,
                    support_replicates=support_replicates
                ),
                "iqtree_report_available": iqtree_path.exists(),
                "iqtree_log_redacted": True
            },
            "warnings": []
        }


def run_tree_analysis(request: dict, alignment_fasta: str) -> dict:
    method = request["analysis"]["method"]
    preflight_warnings = collect_tree_run_warnings(request, alignment_fasta)

    if method == "ml":
        result = run_iqtree_ml_on_alignment(
            alignment_fasta,
            substitution_model=request["analysis"].get("substitution_model"),
            support=request["analysis"].get("support") or {}
        )
        result["warnings"] = preflight_warnings + (result.get("warnings") or [])
        return result

    if method in {"nj", "upgma"}:
        result = run_distance_tree_on_alignment(
            alignment_fasta,
            method=method,
            distance_model=request["analysis"].get("distance_model") or "identity"
        )
        result["warnings"] = preflight_warnings + (result.get("warnings") or [])
        return result

    raise ValueError(f"Unknown tree method: {method}")