from typing import Any, Dict, List

TREE_SCHEMA_VERSION = "1.0"

ALLOWED_ALIGNMENT_ENGINES = {"muscle", "clustalw"}
ALLOWED_TREE_METHODS = {"ml", "nj", "upgma"}
ALLOWED_PRESETS = {"fast", "balanced", "rigorous", "custom"}
ALLOWED_SUPPORT_TYPES = {"none", "bootstrap", "ufboot"}
ALLOWED_DISTANCE_MODELS = {
    "identity",
    "blastn",
    "trans",
    "p_distance",
    "jc69",
    "k2p",
}


def _safe_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def _safe_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed


def _parse_fasta_records(fasta_text: str) -> List[Dict[str, str]]:
    lines = _safe_str(fasta_text).splitlines()
    records: List[Dict[str, str]] = []
    current_name = None
    current_seq: List[str] = []

    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        if line.startswith(">"):
            if current_name is not None:
                records.append({
                    "name": current_name,
                    "seq": "".join(current_seq)
                })
            current_name = line[1:].strip() or f"record_{len(records) + 1}"
            current_seq = []
            continue

        current_seq.append(line)

    if current_name is not None:
        records.append({
            "name": current_name,
            "seq": "".join(current_seq)
        })

    return records


def _normalize_seq(seq: str) -> str:
    return str(seq or "").strip().upper()


def _is_gap_char(ch: str) -> bool:
    return ch in {"-", ".", "?"}


def _build_identical_sequence_groups(records: List[Dict[str, str]]) -> List[List[str]]:
    groups: Dict[str, List[str]] = {}

    for record in records:
        seq = _normalize_seq(record["seq"])
        groups.setdefault(seq, []).append(record["name"])

    return [
        names
        for names in groups.values()
        if len(names) > 1
    ]


def summarize_fasta_text(fasta_text: str) -> Dict[str, Any]:
    records = _parse_fasta_records(fasta_text)
    lengths = [len(r["seq"]) for r in records]
    unique_lengths = sorted(set(lengths))

    is_aligned = len(unique_lengths) <= 1
    aligned_length = unique_lengths[0] if len(unique_lengths) == 1 and unique_lengths else (max(lengths) if lengths else 0)

    total_chars = 0
    gap_chars = 0

    for record in records:
        seq = _normalize_seq(record["seq"])
        total_chars += len(seq)
        gap_chars += sum(1 for ch in seq if _is_gap_char(ch))

    gap_fraction = (gap_chars / total_chars) if total_chars else 0.0

    variable_site_count = None
    constant_site_count = None

    if is_aligned and aligned_length > 0 and records:
        variable_site_count = 0
        constant_site_count = 0

        normalized_records = [_normalize_seq(r["seq"]) for r in records]

        for idx in range(aligned_length):
            column = [seq[idx] for seq in normalized_records if idx < len(seq)]
            non_gap = [ch for ch in column if not _is_gap_char(ch)]

            if not non_gap:
                continue

            uniq = set(non_gap)
            if len(uniq) == 1:
                constant_site_count += 1
            else:
                variable_site_count += 1

    identical_sequence_groups = _build_identical_sequence_groups(records)

    return {
        "sequence_count": len(records),
        "sequence_names": [r["name"] for r in records],
        "aligned_length": aligned_length,
        "is_aligned": is_aligned,
        "gap_fraction": round(gap_fraction, 4),
        "variable_site_count": variable_site_count,
        "constant_site_count": constant_site_count,
        "unique_sequence_count": len(records) - sum(len(g) - 1 for g in identical_sequence_groups),
        "identical_sequence_groups": identical_sequence_groups
    }


def collect_tree_run_warnings(request: Dict[str, Any], aligned_fasta: str) -> List[str]:
    summary = summarize_fasta_text(aligned_fasta)
    method = request["analysis"]["method"]

    warnings: List[str] = []

    sequence_count = summary["sequence_count"]
    aligned_length = summary["aligned_length"]
    gap_fraction = summary["gap_fraction"]
    variable_site_count = summary["variable_site_count"]
    unique_sequence_count = summary["unique_sequence_count"]
    identical_sequence_groups = summary["identical_sequence_groups"]

    if sequence_count < 4:
        warnings.append("Low sequence count; topology may be unstable.")

    if aligned_length and aligned_length < 100:
        warnings.append("Short alignment length; phylogenetic signal may be limited.")

    if gap_fraction >= 0.20:
        warnings.append("High gap proportion detected in the alignment.")

    if variable_site_count is not None and variable_site_count < 3:
        warnings.append("Very low sequence divergence detected across aligned sites.")

    if unique_sequence_count < sequence_count:
        warnings.append("Identical sequences detected; redundant taxa may reduce informativeness.")

    if method == "upgma":
        warnings.append("UPGMA assumes ultrametric evolution; interpret branch structure cautiously.")

    return warnings


def normalize_tree_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    payload = payload or {}

    input_block = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    alignment_block = payload.get("alignment") if isinstance(payload.get("alignment"), dict) else {}
    analysis_block = payload.get("analysis") if isinstance(payload.get("analysis"), dict) else {}
    support_block = analysis_block.get("support") if isinstance(analysis_block.get("support"), dict) else {}
    view_defaults = payload.get("view_defaults") if isinstance(payload.get("view_defaults"), dict) else {}
    client_context = payload.get("client_context") if isinstance(payload.get("client_context"), dict) else {}

    fasta_text = _safe_str(input_block.get("fasta_text") or payload.get("fasta_text") or "").strip()
    source_type = _safe_str(input_block.get("source_type") or "ab1_preprocessed_fasta")

    alignment_engine = _safe_str(
        alignment_block.get("engine") or payload.get("engine") or "muscle"
    ).lower()

    method = _safe_str(analysis_block.get("method") or "ml").lower()
    preset = _safe_str(analysis_block.get("preset") or "balanced").lower()

    distance_model = _safe_str(analysis_block.get("distance_model") or "").lower() or None
    if method in {"nj", "upgma"}:
        if distance_model is None:
            distance_model = "k2p"
    else:
        distance_model = None

    substitution_model = analysis_block.get("substitution_model")
    if method == "ml":
        if substitution_model is None:
            substitution_model = "AUTO"
    else:
        substitution_model = None

    support_type = _safe_str(
        support_block.get("type") or ("none" if not support_block.get("enabled") else "bootstrap")
    ).lower()

    support_enabled = bool(support_block.get("enabled")) and support_type != "none"

    default_replicates = 1000 if support_type == "ufboot" else 100
    support_replicates = _safe_int(
        support_block.get("replicates"),
        default_replicates
    )

    if support_type == "none":
        support_enabled = False
        support_replicates = 0

    normalized = {
        "task_type": "tree",
        "input": {
            "fasta_text": fasta_text,
            "source_type": source_type
        },
        "alignment": {
            "engine": alignment_engine
        },
        "analysis": {
            "method": method,
            "preset": preset,
            "distance_model": distance_model,
            "substitution_model": substitution_model,
            "support": {
                "enabled": support_enabled,
                "type": support_type,
                "replicates": support_replicates
            }
        },
        "view_defaults": {
            "preferred_layout": _safe_str(view_defaults.get("preferred_layout") or "scaled"),
            "show_support": bool(view_defaults.get("show_support", True)),
            "show_branch_lengths": bool(view_defaults.get("show_branch_lengths", True))
        },
        "client_context": {
            "app_module": _safe_str(client_context.get("app_module") or "tree"),
            "schema_expectation": _safe_str(client_context.get("schema_expectation") or TREE_SCHEMA_VERSION)
        }
    }

    return normalized


def validate_tree_request(request: Dict[str, Any]) -> None:
    fasta_text = request["input"]["fasta_text"]
    engine = request["alignment"]["engine"]
    method = request["analysis"]["method"]
    preset = request["analysis"]["preset"]
    support = request["analysis"]["support"]

    if not fasta_text.strip():
        raise ValueError("input.fasta_text boş olamaz.")

    if engine not in ALLOWED_ALIGNMENT_ENGINES:
        raise ValueError(f"Desteklenmeyen alignment engine: {engine}")

    if method not in ALLOWED_TREE_METHODS:
        raise ValueError(f"Desteklenmeyen tree method: {method}")

    if preset not in ALLOWED_PRESETS:
        raise ValueError(f"Desteklenmeyen preset: {preset}")

    if support["type"] not in ALLOWED_SUPPORT_TYPES:
        raise ValueError(f"Desteklenmeyen support type: {support['type']}")

    if method in {"nj", "upgma"}:
        distance_model = request["analysis"]["distance_model"]
        if distance_model not in ALLOWED_DISTANCE_MODELS:
            raise ValueError(f"Desteklenmeyen distance model: {distance_model}")

    summary = summarize_fasta_text(fasta_text)
    if summary["sequence_count"] < 2:
        raise ValueError("Tree analizi için en az 2 dizi gerekir.")

    if method in {"nj", "upgma"} and support["enabled"]:
        raise ValueError("Bu ilk patchte NJ/UPGMA için support üretimi aktif değil. Support type 'none' seç.")

    if method == "ml" and support["enabled"]:
        if support["type"] == "bootstrap" and support["replicates"] < 100:
            raise ValueError("Nonparametric bootstrap için replicates en az 100 olmalı.")
        if support["type"] == "ufboot" and support["replicates"] < 1000:
            raise ValueError("UFBoot için replicates en az 1000 olmalı.")


def build_tree_analysis_result(
    request: Dict[str, Any],
    raw_newick: str,
    aligned_fasta: str,
    *,
    warnings: List[str] | None = None,
    provenance: Dict[str, Any] | None = None,
    artifacts: Dict[str, Any] | None = None,
    analysis_id: str | None = None
) -> Dict[str, Any]:
    warnings = warnings or []
    provenance = provenance or {}
    artifacts = artifacts or {}

    support = request["analysis"]["support"]
    support_present = bool(support["enabled"]) and support["type"] != "none"

    result = {
        "analysis_id": analysis_id,
        "input_summary": {
            **summarize_fasta_text(aligned_fasta),
            "source_type": request["input"]["source_type"]
        },
        "analysis_summary": {
            "method": request["analysis"]["method"],
            "preset": request["analysis"]["preset"],
            "alignment_engine": request["alignment"]["engine"],
            "distance_model": request["analysis"]["distance_model"],
            "substitution_model": request["analysis"]["substitution_model"],
            "support_enabled": support["enabled"],
            "support_type": support["type"],
            "support_replicates": support["replicates"]
        },
        "tree": {
            "raw_newick": raw_newick,
            "format": "newick",
            "rooting": {
                "analysis_rooting": "engine_default",
                "viewer_rooting": None
            },
            "support": {
                "present": support_present,
                "type": support["type"],
                "label_mode": "internal_node_label" if support_present else None,
                "range": {"min": 0, "max": 100} if support_present else None
            }
        },
        "artifacts": artifacts,
        "warnings": warnings,
        "provenance": provenance
    }

    return result