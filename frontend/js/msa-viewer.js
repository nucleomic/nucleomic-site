(function () {
  function parseFasta(text) {
    const lines = String(text || "").split(/\r?\n/);
    const names = [];
    const seqs = [];
    let name = null;
    let seq = "";

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (line.startsWith(">")) {
        if (name !== null) {
          names.push(name);
          seqs.push(seq);
        }
        name = line.slice(1).trim();
        seq = "";
      } else {
        seq += line;
      }
    }

    if (name !== null) {
      names.push(name);
      seqs.push(seq);
    }

    return { names, seqs };
  }

  function buildMsaDataFromFasta(text) {
    const { names, seqs } = parseFasta(text);
    if (!names.length) {
      throw new Error("MSA output is empty.");
    }

    const maxLen = Math.max(...seqs.map((s) => s.length));
    const paddedSeqs = seqs.map((s) => s.padEnd(maxLen, "-"));

    const consensus = [];
    for (let c = 0; c < maxLen; c++) {
      const counts = {};
      for (const s of paddedSeqs) {
        const b = s[c];
        if (!b || b === "-" || b === " ") continue;
        counts[b] = (counts[b] || 0) + 1;
      }

      let best = "-";
      let bestCount = 0;
      for (const b in counts) {
        if (counts[b] > bestCount) {
          bestCount = counts[b];
          best = b;
        }
      }
      consensus.push(best);
    }

    return { names, paddedSeqs, consensus, maxLen };
  }

  function colorForBase(base, consensusBase, mode) {
    if (!base || base === "-" || base === " ") return "#64748b";

    if (mode === "base") {
      switch (base.toUpperCase()) {
        case "A": return "#f97373";
        case "T": return "#34d399";
        case "G": return "#60a5fa";
        case "C": return "#facc15";
        case "N": return "#d1d5db";
        default: return "#e5e7eb";
      }
    }

    if (!consensusBase || consensusBase === "-" || consensusBase === " ") {
      return "#64748b";
    }

    return consensusBase.toUpperCase() === base.toUpperCase()
      ? "#22c55e"
      : "#f97373";
  }

  function createRowId(index) {
    return `row_${index + 1}`;
  }

  function buildRowsFromBase(base) {
    return base.names.map((name, index) => ({
      id: createRowId(index),
      sourceName: name,
      displayName: name,
      seq: base.paddedSeqs[index]
    }));
  }

  function rebuildConsensusFromRows(rows) {
    const maxLen = rows.reduce((acc, row) => Math.max(acc, (row.seq || "").length), 0);
    const paddedSeqs = rows.map((row) => String(row.seq || "").padEnd(maxLen, "-"));

    const consensus = [];
    for (let c = 0; c < maxLen; c++) {
      const counts = {};
      for (const s of paddedSeqs) {
        const b = s[c];
        if (!b || b === "-" || b === " ") continue;
        counts[b] = (counts[b] || 0) + 1;
      }

      let best = "-";
      let bestCount = 0;
      for (const b in counts) {
        if (counts[b] > bestCount) {
          bestCount = counts[b];
          best = b;
        }
      }
      consensus.push(best);
    }

    return {
      names: rows.map((row) => row.displayName),
      paddedSeqs,
      consensus,
      maxLen
    };
  }

  function setAlignmentFromBase(state, base) {
    state.rawData = base;
    state.rows = buildRowsFromBase(base);
    rebuildVisibleData(state);
  }

    function orderRowsByNameList(rows, orderedNames, matcher) {
    if (!Array.isArray(rows) || !rows.length) return [];
    if (!Array.isArray(orderedNames) || !orderedNames.length) return rows.slice();

    const preferred = [];
    const used = new Set();

    for (const name of orderedNames) {
        const idx = rows.findIndex((row, rowIndex) => {
        if (used.has(rowIndex)) return false;
        return matcher(row, name);
        });

        if (idx === -1) continue;
        used.add(idx);
        preferred.push(rows[idx]);
    }

    rows.forEach((row, idx) => {
        if (!used.has(idx)) preferred.push(row);
    });

    return preferred;
    }

    function rebuildVisibleData(state) {
    if (!Array.isArray(state.rows) || !state.rows.length) {
        state.visibleRows = [];
        state.data = null;
        return;
    }

    let rows = state.rows.slice();

    if (state.orderMode === "tree" && Array.isArray(state.treeLeafOrder) && state.treeLeafOrder.length) {
        rows = orderRowsByNameList(
        rows,
        state.treeLeafOrder,
        (row, name) => row.sourceName === name || row.displayName === name
        );
    } else if (Array.isArray(state.lastFileOrder) && state.lastFileOrder.length) {
        rows = orderRowsByNameList(
        rows,
        state.lastFileOrder,
        (row, name) => row.sourceName === name
        );
    }

    state.visibleRows = rows;
    state.data = rebuildConsensusFromRows(state.visibleRows);
    }

  function ensureMeasureCtx(state) {
    if (!state.measureCtx) {
      state.measureCtx = document.createElement("canvas").getContext("2d");
    }
    return state.measureCtx;
  }

  function updateNameColumnWidth(state, fontPx) {
    const ctx = ensureMeasureCtx(state);
    const names = state.data?.names || [];

    ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;

    let maxTextWidth = 0;
    names.forEach((name) => {
      const w = ctx.measureText(name).width;
      if (w > maxTextWidth) maxTextWidth = w;
    });

    const paddingPx = 18;
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    const minWidthPx = isMobile ? 118 : 160;
    const widthPx = Math.max(minWidthPx, Math.ceil(maxTextWidth + paddingPx));

    state.ui.namesCol.style.minWidth = `${widthPx}px`;
    state.ui.namesCol.style.maxWidth = `${widthPx}px`;
    state.ui.namesCol.style.flex = `0 0 ${widthPx}px`;
  }

  function buildSelection(anchorRow, anchorCol, row, col) {
    return {
        anchorRow,
        anchorCol,
        endRow: row,
        endCol: col,
        minRow: Math.min(anchorRow, row),
        maxRow: Math.max(anchorRow, row),
        minCol: Math.min(anchorCol, col),
        maxCol: Math.max(anchorCol, col)
    };
    }

    function clearSelection(state) {
    if (!state.selection) return;
    state.selection = null;
    scheduleDraw(state);
    }

    function updateSelection(state, row, col) {
    if (!state.selection) return;
    const { anchorRow, anchorCol } = state.selection;
    state.selection = buildSelection(anchorRow, anchorCol, row, col);
    }

    function hideTooltip(state) {
    if (!state.ui.tooltip) return;
    state.ui.tooltip.style.display = "none";
    }

    function setHoverInfo(state, text) {
      if (!state.ui.hoverInfo) return;
      state.ui.hoverInfo.textContent = text || "Hover a base to see sequence, position, and nucleotide.";
    }

    function clearHoverInfo(state) {
      setHoverInfo(state, "Hover a base to see sequence, position, and nucleotide.");
    }

    function hideContextMenu(state) {
    if (!state.ui.contextMenu) return;
    state.ui.contextMenu.style.display = "none";
    }

    function showContextMenu(state, x, y) {
    if (!state.ui.contextMenu) return;
    state.ui.contextMenu.style.left = `${x}px`;
    state.ui.contextMenu.style.top = `${y}px`;
    state.ui.contextMenu.style.display = "block";
    }

    function scheduleDraw(state) {
      if (state.drawFrame) return;

      state.drawFrame = window.requestAnimationFrame(() => {
        state.drawFrame = 0;
        draw(state);
      });
    }

    function cancelScheduledDraw(state) {
      if (!state.drawFrame) return;
      window.cancelAnimationFrame(state.drawFrame);
      state.drawFrame = 0;
    }

    function scheduleDraw(state) {
      if (state.drawFrame) return;
      state.drawFrame = window.requestAnimationFrame(() => {
        state.drawFrame = 0;
        draw(state);
      });
    }

    function cancelScheduledDraw(state) {
      if (!state.drawFrame) return;
      window.cancelAnimationFrame(state.drawFrame);
      state.drawFrame = 0;
    }

    function isCellInsideSelection(selection, row, col) {
    if (!selection) return false;
    return (
        row >= selection.minRow &&
        row <= selection.maxRow &&
        col >= selection.minCol &&
        col <= selection.maxCol
    );
    }

    function normalizeAllRowLengths(state) {
        if (!Array.isArray(state.rows) || !state.rows.length) return;

        const maxLen = state.rows.reduce((acc, row) => {
            return Math.max(acc, String(row.seq || "").length);
        }, 0);

        state.rows.forEach((row) => {
            row.seq = String(row.seq || "").padEnd(maxLen, "-");
        });
    }

    function cloneRows(rows) {
    return (rows || []).map((row) => ({
        id: row.id,
        sourceName: row.sourceName,
        displayName: row.displayName,
        seq: row.seq
    }));
    }

    function createHistorySnapshot(state) {
    return {
        rows: cloneRows(state.rows),
    };
    }

    function applyHistorySnapshot(state, snapshot) {
      
    if (!snapshot) return;
    cancelScheduledDraw(state);
    state.rows = cloneRows(snapshot.rows || []);
    

    rebuildVisibleData(state);
    state.selection = null;
    state.isSelecting = false;
    state.hoverKey = "";
    hideTooltip(state);
    hideContextMenu(state);
    draw(state);
    updateHistoryButtons(state);
    }

    function pushUndoSnapshot(state) {
    if (!Array.isArray(state.undoStack)) state.undoStack = [];
    if (!Array.isArray(state.redoStack)) state.redoStack = [];

    state.undoStack.push(createHistorySnapshot(state));

    if (state.undoStack.length > state.historyLimit) {
        state.undoStack.shift();
    }

    state.redoStack = [];
    updateHistoryButtons(state);
    }

    function resetHistory(state) {
    state.undoStack = [];
    state.redoStack = [];
    updateHistoryButtons(state);
    }

    function performUndo(state) {
    if (!state.undoStack || !state.undoStack.length) return;

    const current = createHistorySnapshot(state);
    const snapshot = state.undoStack.pop();

    state.redoStack.push(current);
    applyHistorySnapshot(state, snapshot);
    }

    function performRedo(state) {
    if (!state.redoStack || !state.redoStack.length) return;

    const current = createHistorySnapshot(state);
    const snapshot = state.redoStack.pop();

    state.undoStack.push(current);
    applyHistorySnapshot(state, snapshot);
    }

    function updateHistoryButtons(state) {
    if (state.ui.btnUndo) {
        state.ui.btnUndo.disabled = !state.undoStack || !state.undoStack.length;
        state.ui.btnUndo.style.opacity = state.ui.btnUndo.disabled ? "0.5" : "1";
        state.ui.btnUndo.style.cursor = state.ui.btnUndo.disabled ? "not-allowed" : "pointer";
    }

    if (state.ui.btnRedo) {
        state.ui.btnRedo.disabled = !state.redoStack || !state.redoStack.length;
        state.ui.btnRedo.style.opacity = state.ui.btnRedo.disabled ? "0.5" : "1";
        state.ui.btnRedo.style.cursor = state.ui.btnRedo.disabled ? "not-allowed" : "pointer";
    }
    }

    function applyEditMode(state, mode) {
        if (!state.selection || !Array.isArray(state.visibleRows) || !state.visibleRows.length) {
            return;
        }

        pushUndoSnapshot(state);

    const { minRow, maxRow, minCol, maxCol } = state.selection;

    for (let r = minRow; r <= maxRow; r++) {
        const row = state.visibleRows[r];
        if (!row) continue;

        let chars = String(row.seq || "").split("");

        for (let c = minCol; c <= maxCol; c++) {
        if (c < 0 || c >= chars.length) continue;

        if (mode === "gap") {
            chars[c] = "-";
        } else if (mode === "mask") {
            chars[c] = "N";
        } else if (mode === "delete") {
            chars[c] = null;
        }
        }

        if (mode === "delete") {
        chars = chars.filter((ch) => ch !== null);
        }

        row.seq = chars.join("");
    }

    if (mode === "delete") {
        normalizeAllRowLengths(state);
    }

    rebuildVisibleData(state);
    hideContextMenu(state);
    hideTooltip(state);
    draw(state);
    }

    function hitTestCell(state, offsetX, offsetY) {
    if (!state.geometry || !state.data) return null;

    const { cellW, cellH, xOffset, yOffset } = state.geometry;
    const col = Math.floor((offsetX - xOffset) / cellW);
    const row = Math.floor((offsetY - yOffset) / cellH);

    if (
        row < 0 ||
        col < 0 ||
        row >= state.data.paddedSeqs.length ||
        col >= state.data.maxLen
    ) {
        return null;
    }

    return { row, col };
    }

    function removeInlineRename(state) {
      const input = state.ui?.renameInput;
      if (input && input.parentNode) {
          input.parentNode.removeChild(input);
      }
      if (state.ui) {
          state.ui.renameInput = null;
      }
  }

  function startInlineRename(state, rowIndex) {
      if (!Array.isArray(state.visibleRows) || !state.visibleRows.length) return;

      const row = state.visibleRows[rowIndex];
      if (!row) return;

      const namesCol = state.ui?.namesCol;
      if (!namesCol) return;

      removeInlineRename(state);

      const oldName = String(row.displayName || "");
      const styles = window.getComputedStyle(namesCol);
      const paddingTop = parseFloat(styles.paddingTop) || 0;
      const fontPx = parseInt(styles.fontSize, 10) || 12;
      const lineH =
          parseFloat(styles.lineHeight) ||
          (fontPx * 1.3);

      const input = document.createElement("input");
      input.type = "text";
      input.value = oldName;
      input.className = "msa-viewer-rename-input";
      input.style.left = "4px";
      input.style.top = `${paddingTop + rowIndex * lineH}px`;

      const measureCtx = ensureMeasureCtx(state);
      measureCtx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;

      const textWidth = measureCtx.measureText(oldName || " ").width;
      const horizontalPadding = 18;
      const namesColWidth = Math.max(120, namesCol.clientWidth || 160);
      const availableWidth = Math.max(80, namesColWidth - 10);

      const contentWidth = Math.ceil(textWidth + horizontalPadding);
      const finalWidth = Math.max(120, Math.min(availableWidth, contentWidth));

      input.style.width = `${finalWidth}px`;

      namesCol.appendChild(input);
      state.ui.renameInput = input;

      input.focus();
      input.select();

      let finished = false;

      function finish(commit) {
          if (finished) return;
          finished = true;

          const next = input.value.trim();
          removeInlineRename(state);

          if (!commit) return;
          if (!next || next === oldName) return;

          pushUndoSnapshot(state);

          cancelScheduledDraw(state);
          row.displayName = next;

          rebuildVisibleData(state);
          state.hoverKey = "";
          hideTooltip(state);
          hideContextMenu(state);
          draw(state);
          updateHistoryButtons(state);
      }

      function resizeRenameInput() {
          const value = input.value || " ";
          const measured = Math.ceil(measureCtx.measureText(value).width + horizontalPadding);
          const nextWidth = Math.max(120, Math.min(availableWidth, measured));
          input.style.width = `${nextWidth}px`;
      }

      input.addEventListener("input", resizeRenameInput);
      resizeRenameInput();

      input.addEventListener("blur", () => finish(true));

      input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
              ev.preventDefault();
              finish(true);
          } else if (ev.key === "Escape") {
              ev.preventDefault();
              finish(false);
          }
      });
    }

    function bindCanvasInteractions(state) {
    if (state.isCanvasBound) return;

    const canvas = state.ui.canvas;
    const wrapper = state.ui.root;

    canvas.addEventListener("mousedown", (ev) => {
        if (ev.button !== 0) return;

        hideContextMenu(state);

        const hit = hitTestCell(state, ev.offsetX, ev.offsetY);
        if (!hit) return;

        state.selection = buildSelection(hit.row, hit.col, hit.row, hit.col);
        state.isSelecting = true;
        scheduleDraw(state);
    });

    canvas.addEventListener("mousemove", (ev) => {
        const hit = hitTestCell(state, ev.offsetX, ev.offsetY);

        if (!hit) {
        hideTooltip(state);
        clearHoverInfo(state);
        state.hoverKey = "";
        return;
        }

        if (state.isSelecting) {
          const sel = state.selection;
          const changed =
            !sel ||
            sel.endRow !== hit.row ||
            sel.endCol !== hit.col;

          if (changed) {
            updateSelection(state, hit.row, hit.col);
            scheduleDraw(state);
          }
        }

        const rowName = state.data?.names?.[hit.row] || "";
        const base = state.data?.paddedSeqs?.[hit.row]?.[hit.col] || "-";

        const hoverKey = `${hit.row}:${hit.col}`;
        if (state.hoverKey !== hoverKey) {
          state.hoverKey = hoverKey;
          setHoverInfo(state, `${rowName} · position ${hit.col} · base ${base}`);
        }

        hideTooltip(state);

        const wrapperRect = wrapper.getBoundingClientRect();
        const scrollX = wrapper.scrollLeft || 0;
        const scrollY = wrapper.scrollTop || 0;

        const tooltipX = ev.clientX - wrapperRect.left + scrollX + 10;
        const tooltipY = ev.clientY - wrapperRect.top + scrollY + 10;

        state.ui.tooltip.style.left = `${tooltipX}px`;
        state.ui.tooltip.style.top = `${tooltipY}px`;
        state.ui.tooltip.style.display = "block";
    });

    canvas.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const hit = hitTestCell(state, ev.offsetX, ev.offsetY);
        if (!hit) {
            hideContextMenu(state);
            return;
        }

        if (!isCellInsideSelection(state.selection, hit.row, hit.col)) {
            state.selection = buildSelection(hit.row, hit.col, hit.row, hit.col);
            scheduleDraw(state);
        }

        const rect = wrapper.getBoundingClientRect();
        const posX = ev.clientX - rect.left + (wrapper.scrollLeft || 0);
        const posY = ev.clientY - rect.top + (wrapper.scrollTop || 0);

        showContextMenu(state, posX, posY);
        });

    canvas.addEventListener("mouseleave", () => {
        state.hoverKey = "";
        hideTooltip(state);
        clearHoverInfo(state);
        if (state.isSelecting) {
            state.isSelecting = false;
        }
    });

    state.globalHandlers = state.globalHandlers || {};

    state.globalHandlers.onWindowMouseUp = () => {
      if (state.isSelecting) {
        state.isSelecting = false;
      }
    };

    state.globalHandlers.onDocumentMouseDown = (ev) => {
      const target = ev.target;

      const insideWrapper = wrapper.contains(target);
      const insideMenu =
        state.ui.contextMenu && state.ui.contextMenu.contains(target);

      if (insideMenu) return;

      hideContextMenu(state);

      if (!insideWrapper) {
        hideTooltip(state);
        clearHoverInfo(state);
        clearSelection(state);
      }
    };

    window.addEventListener("mouseup", state.globalHandlers.onWindowMouseUp);
    document.addEventListener("mousedown", state.globalHandlers.onDocumentMouseDown);

    wrapper.addEventListener("click", (ev) => {
        if (ev.button !== 0) return;
        const target = ev.target;
        if (target === canvas || target === state.ui.namesCol) return;
        if (state.ui.contextMenu && state.ui.contextMenu.contains(target)) return;
        clearSelection(state);
    });



    state.isCanvasBound = true;
    }

  function draw(state) {
    if (!state.data || !state.ui.canvas || !state.ui.rulerCanvas) return;

    const data = state.data;
    const fontSize = parseInt(state.ui.fontInput.value, 10) || 12;
    const colorMode = state.ui.colorSelect.value;

    const cellW = fontSize * 0.6;
    const cellH = fontSize * 1.3;
    const xOffset = 4;
    const yOffset = 0;
    const rulerHeight = 20;

    state.geometry = {
      cellW,
      cellH,
      xOffset,
      yOffset,
      rulerHeight
    };

    updateNameColumnWidth(state, fontSize);

    state.ui.namesCol.textContent = data.names.join("\n");
    state.ui.namesCol.style.fontSize = `${fontSize}px`;
    state.ui.namesCol.style.lineHeight = `${cellH}px`;
    state.ui.namesCol.style.paddingTop = `${rulerHeight}px`;

    const neededW = cellW * data.maxLen + 20;
    const neededH = yOffset + cellH * data.paddedSeqs.length + 20;

    state.ui.canvas.width = neededW;
    state.ui.canvas.height = neededH;
    state.ui.rulerCanvas.width = neededW;
    state.ui.rulerCanvas.height = rulerHeight;

    const ctx = state.ui.ctx;
    const rctx = state.ui.rulerCtx;

    ctx.clearRect(0, 0, neededW, neededH);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, neededW, neededH);
    ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
    ctx.textBaseline = "top";

    for (let r = 0; r < data.paddedSeqs.length; r++) {
      const seq = data.paddedSeqs[r];
      for (let c = 0; c < seq.length; c++) {
        const b = seq[c];
        const x = xOffset + c * cellW;
        const y = yOffset + r * cellH;
        ctx.fillStyle = colorForBase(b, data.consensus[c], colorMode);
        ctx.fillText(b, x, y);
      }
    }

    if (state.selection && typeof state.selection.minRow === "number") {
        const sel = state.selection;
        const minRow = Math.max(0, sel.minRow);
        const maxRow = Math.min(data.paddedSeqs.length - 1, sel.maxRow);
        const minCol = Math.max(0, sel.minCol);
        const maxCol = Math.min(data.maxLen - 1, sel.maxCol);

        const highlightX = xOffset + minCol * cellW;
        const highlightY = yOffset + minRow * cellH;
        const highlightW = (maxCol - minCol + 1) * cellW;
        const highlightH = (maxRow - minRow + 1) * cellH;

        ctx.fillStyle = "rgba(59,130,246,0.18)";
        ctx.fillRect(highlightX, highlightY, highlightW, highlightH);

        ctx.strokeStyle = "rgba(59,130,246,0.8)";
        ctx.lineWidth = 1;
        ctx.strokeRect(
            highlightX + 0.5,
            highlightY + 0.5,
            Math.max(0, highlightW - 1),
            Math.max(0, highlightH - 1)
        );
    }
    rctx.clearRect(0, 0, neededW, rulerHeight);
    rctx.fillStyle = "#020617";
    rctx.fillRect(0, 0, neededW, rulerHeight);
    rctx.strokeStyle = "#4b5563";
    rctx.beginPath();
    rctx.moveTo(0, rulerHeight - 0.5);
    rctx.lineTo(neededW, rulerHeight - 0.5);
    rctx.stroke();

    rctx.fillStyle = "#e5e7eb";
    rctx.font = `${fontSize * 0.8}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
    rctx.textBaseline = "middle";

    for (let pos = 0; pos <= data.maxLen; pos += 50) {
      const x = xOffset + pos * cellW;
      rctx.beginPath();
      rctx.moveTo(x, rulerHeight - 8);
      rctx.lineTo(x, rulerHeight);
      rctx.stroke();
      rctx.fillText(String(pos), x + 2, rulerHeight / 2);
    }
  }

  function bindUI(state) {
    if (state.isUiBound) return;

    state.ui.colorSelect.addEventListener("change", () => scheduleDraw(state));
    state.ui.fontInput.addEventListener("change", () => scheduleDraw(state));
    state.ui.fontInput.addEventListener("input", () => scheduleDraw(state));
    state.ui.btnUndo.addEventListener("click", () => performUndo(state));
    state.ui.btnRedo.addEventListener("click", () => performRedo(state));

    state.ui.namesCol.addEventListener("dblclick", (ev) => {
        if (!state.data || !state.ui.namesCol) return;

        const rect = state.ui.namesCol.getBoundingClientRect();
        const styles = window.getComputedStyle(state.ui.namesCol);
        const paddingTop = parseFloat(styles.paddingTop) || 0;
        const lineH =
        parseFloat(styles.lineHeight) ||
        ((parseInt(styles.fontSize, 10) || 12) * 1.3);

        const y = ev.clientY - rect.top - paddingTop;
        const rowIdx = Math.floor(y / lineH);

        if (rowIdx < 0 || rowIdx >= state.data.names.length) return;

        startInlineRename(state, rowIdx);
    });

    bindCanvasInteractions(state);

    state.isUiBound = true;
    }

  function ensureUI(state) {
    if (state.ui.root) return;

    const container = state.container;
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "msa-viewer-title";
    header.textContent = "MSA (MUSCLE/ClustalW alignment) – colored canvas view:";
    container.appendChild(header);

    const controls = document.createElement("div");
    controls.className = "msa-viewer-controls";

    const colorSelect = document.createElement("select");
    colorSelect.className = "msa-viewer-color-select";
    colorSelect.innerHTML = `
      <option value="match">Color by match</option>
      <option value="base">Color by base</option>
    `;

    const fontLabel = document.createElement("label");
    fontLabel.className = "msa-viewer-font-label";
    fontLabel.textContent = "Font size: ";

    const fontInput = document.createElement("input");
    fontInput.type = "number";
    fontInput.value = "12";
    fontInput.className = "msa-viewer-font-input";
    fontLabel.appendChild(fontInput);

    const btnUndo = document.createElement("button");
    btnUndo.type = "button";
    btnUndo.textContent = "Undo";
    btnUndo.className = "msa-viewer-history-btn";

    const btnRedo = document.createElement("button");
    btnRedo.type = "button";
    btnRedo.textContent = "Redo";
    btnRedo.className = "msa-viewer-history-btn";

    controls.appendChild(colorSelect);
    controls.appendChild(fontLabel);
    controls.appendChild(btnUndo);
    controls.appendChild(btnRedo);
    container.appendChild(controls);

    const hoverInfo = document.createElement("div");
    hoverInfo.className = "msa-viewer-hover-info";
    hoverInfo.textContent = "Hover a base to see sequence, position, and nucleotide.";
    container.appendChild(hoverInfo);

    const wrapper = document.createElement("div");
    wrapper.className = "msa-viewer-surface";

    const namesCol = document.createElement("pre");
    namesCol.className = "msa-viewer-names";

    const rulerCanvas = document.createElement("canvas");
    rulerCanvas.className = "msa-viewer-ruler";

    const canvas = document.createElement("canvas");
    canvas.className = "msa-viewer-canvas";

    const ctx = canvas.getContext("2d");
    const rulerCtx = rulerCanvas.getContext("2d");

    const scrollArea = document.createElement("div");
    scrollArea.className = "msa-viewer-scroll";

    scrollArea.appendChild(rulerCanvas);
    scrollArea.appendChild(canvas);

    const msaRow = document.createElement("div");
    msaRow.className = "msa-viewer-row";

    msaRow.appendChild(namesCol);
    msaRow.appendChild(scrollArea);
    wrapper.appendChild(msaRow);

    const tooltip = document.createElement("div");
    tooltip.className = "msa-viewer-tooltip";

    const contextMenu = document.createElement("div");
    contextMenu.className = "msa-viewer-context-menu";

    function makeMenuItem(label, onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.className = "msa-viewer-context-item";
      btn.addEventListener("click", () => onClick());
      return btn;
    }

    contextMenu.appendChild(
        makeMenuItem("Gap (-)", () => applyEditMode(state, "gap"))
    );
    contextMenu.appendChild(
        makeMenuItem("Mask (N)", () => applyEditMode(state, "mask"))
    );
    contextMenu.appendChild(
        makeMenuItem("Delete", () => applyEditMode(state, "delete"))
    );

    wrapper.appendChild(tooltip);
    wrapper.appendChild(contextMenu);
    container.appendChild(wrapper);

    state.ui = {
      root: wrapper,
      header,
      controls,
      colorSelect,
      fontInput,
      btnUndo,
      btnRedo,
      hoverInfo,
      namesCol,
      rulerCanvas,
      canvas,
      scrollArea,
      msaRow,
      tooltip,
      contextMenu,
      renameInput: null,
      ctx,
      rulerCtx
    };

    bindUI(state);
  }

  function render(state, fastaText) {
    cancelScheduledDraw(state);
    ensureUI(state);
    const base = buildMsaDataFromFasta(fastaText);
    setAlignmentFromBase(state, base);
    state.selection = null;
    state.isSelecting = false;
    state.hoverKey = "";
    hideTooltip(state);
    hideContextMenu(state);
    resetHistory(state);
    draw(state);
  }

  function downloadFasta(state) {
    if (!state.visibleRows || !state.visibleRows.length) {
      return;
    }

    const lines = [];
    state.visibleRows.forEach((row, idx) => {
      lines.push(`>${row.displayName && row.displayName.trim() ? row.displayName.trim() : `record_${idx + 1}`}`);
      lines.push(String(row.seq || ""));
    });

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "alignment.fasta";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function destroyViewer(state) {
    cancelScheduledDraw(state);
    removeInlineRename(state);
    hideTooltip(state);
    hideContextMenu(state);

    if (state.globalHandlers?.onWindowMouseUp) {
      window.removeEventListener("mouseup", state.globalHandlers.onWindowMouseUp);
    }

    if (state.globalHandlers?.onDocumentMouseDown) {
      document.removeEventListener("mousedown", state.globalHandlers.onDocumentMouseDown);
    }

    state.globalHandlers = null;
    state.isCanvasBound = false;
    state.isUiBound = false;
    state.selection = null;
    state.isSelecting = false;
    state.hoverKey = "";

    if (state.container) {
      state.container.innerHTML = "";
    }

    state.ui = {};
  }

  function createViewer(container, options = {}) {
    const state = {
      container,
      rawData: null,
      rows: [],
      visibleRows: [],
      data: null,
      lastFileOrder: Array.isArray(options.lastFileOrder) ? options.lastFileOrder.slice() : [],
      treeLeafOrder: [],
      orderMode: "file",
      selection: null,
      isSelecting: false,
      geometry: null,
      measureCtx: null,
      isUiBound: false,
      isCanvasBound: false,
      undoStack: [],
      redoStack: [],
      historyLimit: 50,
      drawFrame: 0,
      hoverKey: "",
      globalHandlers: null,
      ui: {}
    };

    return {
        render(fastaText, renderOptions = {}) {
            if (Array.isArray(renderOptions.lastFileOrder)) {
            state.lastFileOrder = renderOptions.lastFileOrder.slice();
            }
            render(state, fastaText);
        },
        download() {
            downloadFasta(state);
        },
        setLastFileOrder(order) {
            state.lastFileOrder = Array.isArray(order) ? order.slice() : [];
            rebuildVisibleData(state);
            draw(state);
            updateHistoryButtons(state);
        },
        setTreeLeafOrder(order) {
            state.treeLeafOrder = Array.isArray(order) ? order.slice() : [];
            rebuildVisibleData(state);
            draw(state);
            updateHistoryButtons(state);
        },
        setOrderMode(mode) {
            state.orderMode = mode === "tree" ? "tree" : "file";
            rebuildVisibleData(state);
            draw(state);
            updateHistoryButtons(state);
        },
        undo() {
            performUndo(state);
        },
        redo() {
            performRedo(state);
        },
        canUndo() {
            return !!(state.undoStack && state.undoStack.length);
        },
        canRedo() {
            return !!(state.redoStack && state.redoStack.length);
        },
        destroy() {
          destroyViewer(state);
        },
        getState() {
            return state;
        }
        };
  }

  window.MsaViewer = {
    createViewer,
    parseFasta,
    buildMsaDataFromFasta
  };
})();