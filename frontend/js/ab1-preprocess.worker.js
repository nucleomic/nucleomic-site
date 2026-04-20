function parseForcedMask(expr, seqLen) {
  expr = (expr || "").trim();
  const mask = new Set();
  if (!expr) return mask;

  const parts = expr.replaceAll(";", ",").split(",").map(x => x.trim()).filter(Boolean);

  for (const p of parts) {
    if (p.includes("-")) {
      let [aStr, bStr] = p.split("-", 2);
      aStr = aStr.trim();
      bStr = bStr.trim();

      if (!/^-?\d+$/.test(aStr)) continue;
      let a = Math.max(1, parseInt(aStr, 10));
      let b;

      if (bStr.endsWith("+")) {
        if (!/^-?\d+$/.test(bStr.slice(0, -1))) continue;
        b = seqLen;
      } else {
        if (!/^-?\d+$/.test(bStr)) continue;
        b = parseInt(bStr, 10);
      }

      if (b < a) [a, b] = [b, a];
      b = Math.min(b, seqLen);

      for (let i = a; i <= b; i++) mask.add(i);
    } else {
      if (p.endsWith("+")) {
        const s = p.slice(0, -1);
        if (!/^-?\d+$/.test(s)) continue;
        let start = Math.max(1, parseInt(s, 10));
        for (let i = start; i <= seqLen; i++) mask.add(i);
      } else {
        if (!/^-?\d+$/.test(p)) continue;
        const k = Math.max(1, parseInt(p, 10));
        if (k <= seqLen) mask.add(k);
      }
    }
  }

  return mask;
}

function processOne(seq, quals, thr, mode, forcedMask) {
  const out = [];
  let forcedCnt = 0;
  let lowqCnt = 0;

  for (let i = 0; i < seq.length; i++) {
    const pos = i + 1;
    const base = seq[i];
    const q = quals[i] ?? 0;

    let action = null;
    if (forcedMask.has(pos)) {
      action = "forced";
    } else if (thr != null && thr > 0 && q < thr) {
      action = "lowq";
    }

    if (!action) {
      out.push(base);
      continue;
    }

    if (mode === "gap") out.push("-");
    else if (mode === "mask") out.push("N");
    else if (mode === "delete") {
      // skip
    } else {
      out.push(base);
    }

    if (action === "forced") forcedCnt++;
    else lowqCnt++;
  }

  return {
    sequence: out.join(""),
    forcedCount: forcedCnt,
    lowqCount: lowqCnt
  };
}

/*
  GEÇİCİ PLACEHOLDER:
  Buraya gerçek AB1/ABI parser gelecek.
  Şimdilik çalışır iskelet kurmak için bu fonksiyon hata fırlatıyor.
*/
function parseAb1ArrayBuffer(_buffer, filename) {
  const seq = "ACTGACTGACTGACTGACTGACTGACTG";
  const qualities = Array(seq.length).fill(40);

  return {
    sequence: seq,
    qualities,
    filename
  };
}

self.onmessage = async (event) => {
  const data = event.data;

  if (data.type !== "preprocess") return;

  try {
    const { files, options } = data;
    const results = [];
    const fastaLines = [];

    for (const item of files) {
      const parsed = parseAb1ArrayBuffer(item.buffer, item.name);

      const forcedMask = parseForcedMask(options.position_expr || "", parsed.sequence.length);
      const processed = processOne(
        parsed.sequence,
        parsed.qualities,
        Number(options.quality_threshold || 20),
        options.mode || "gap",
        forcedMask
      );

      results.push({
        filename: item.name,
        original_length: parsed.sequence.length,
        final_length: processed.sequence.length,
        forced_count: processed.forcedCount,
        lowq_count: processed.lowqCount,
        sequence: processed.sequence
      });

      fastaLines.push(`>${item.name}`);
      fastaLines.push(processed.sequence);
    }

    self.postMessage({
      type: "done",
      payload: {
        results,
        fasta_text: fastaLines.join("\n")
      }
    });
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err.message || String(err)
    });
  }
};