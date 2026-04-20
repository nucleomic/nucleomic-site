# ab1_core.py
from pathlib import Path
from typing import Iterable, Tuple, List, Set, Optional

from Bio import SeqIO
from Bio.Seq import Seq
from Bio.SeqRecord import SeqRecord


def parse_forced_mask(expr: str, seqlen: int) -> Set[int]:
    
    expr = (expr or "").strip()
    mask: Set[int] = set()
    if not expr:
        return mask

    parts = [p.strip() for p in expr.replace(";", ",").split(",") if p.strip()]
    for p in parts:
        if "-" in p:
            # a-b veya a-b+ tipi ifade
            a_str, b_str = p.split("-", 1)
            a_str = a_str.strip()
            b_str = b_str.strip()
            if not a_str.lstrip("-").isdigit():
                continue
            a = int(a_str)
            a = max(1, a)

            # b kısmı "500+" gibi olabilir
            if b_str.endswith("+"):
                if not b_str[:-1].lstrip("-").isdigit():
                    continue
                b = seqlen
            else:
                if not b_str.lstrip("-").isdigit():
                    continue
                b = int(b_str)
            if b < a:
                a, b = b, a
            b = min(b, seqlen)
            for i in range(a, b + 1):
                mask.add(i)
        else:
            # tek sayı veya "500+" gibi
            if p.endswith("+"):
                if not p[:-1].lstrip("-").isdigit():
                    continue
                start = int(p[:-1])
                start = max(1, start)
                for i in range(start, seqlen + 1):
                    mask.add(i)
            else:
                if p.lstrip("-").isdigit():
                    k = int(p)
                    k = max(1, k)
                    if k <= seqlen:
                        mask.add(k)
    return mask


def process_one(
    seq: str,
    quals: Iterable[int],
    thr: int,
    mode: str,
    forced_mask: Optional[Set[int]] = None,
) -> Tuple[str, int, int]:
    
    if forced_mask is None:
        forced_mask = set()

    out = []
    forced_cnt = 0
    lowq_cnt = 0

    for pos, (base, q) in enumerate(zip(seq, quals), start=1):
        action = None
        if pos in forced_mask:
            action = "forced"
        elif thr is not None and thr > 0 and q < thr:
            action = "lowq"

        if action is None:
            
            out.append(base)
            continue

        
        if mode == "gap":
            out.append("-")
        elif mode == "mask":
            out.append("N")
        elif mode == "delete":
            
            pass
        else:
            out.append(base)

        if action == "forced":
            forced_cnt += 1
        else:
            lowq_cnt += 1

    return "".join(out), forced_cnt, lowq_cnt


def process_ab1_file(
    file_path_or_obj,
    thr: int = 20,
    mode: str = "gap",
    pos_expr: str = "",
) -> dict:
    
    if hasattr(file_path_or_obj, "read"):
        rec = SeqIO.read(file_path_or_obj, "abi")
        filename = getattr(file_path_or_obj, "name", "uploaded.ab1")
    else:
        path = Path(file_path_or_obj)
        rec = SeqIO.read(str(path), "abi")
        filename = path.name

    seq = str(rec.seq)
    quals = rec.letter_annotations.get("phred_quality", [0] * len(seq))
    forced = parse_forced_mask(pos_expr, len(seq))

    final_seq, forced_cnt, lowq_cnt = process_one(seq, quals, thr, mode, forced)

    return {
        "filename": filename,
        "original_length": len(seq),
        "final_length": len(final_seq),
        "forced_count": forced_cnt,
        "lowq_count": lowq_cnt,
        "sequence": final_seq,
    }


def process_ab1_to_fasta(
    file_paths: List[str],
    thr: int,
    mode: str,
    pos_expr: str,
    out_fasta_path: str,
):
    
    records: List[SeqRecord] = []
    stats = []

    for fp in file_paths:
        result = process_ab1_file(fp, thr=thr, mode=mode, pos_expr=pos_expr)
        rec = SeqRecord(
            Seq(result["sequence"]),
            id=result["filename"],
            description="",
        )
        records.append(rec)
        stats.append(result)

    SeqIO.write(records, out_fasta_path, "fasta")
    return stats
