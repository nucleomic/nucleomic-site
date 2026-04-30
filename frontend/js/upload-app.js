const form = document.getElementById("ab1-form");
const fileInput = form.querySelector('input[name="files"]');

const fileListDiv = document.getElementById("file-list");
const fileListWrapper = document.getElementById("file-list-wrapper");
const btnToggleFiles = document.getElementById("btn-toggle-files");
const btnFilePicker = document.getElementById("btn-file-picker");
const filePickerHint = document.getElementById("file-picker-hint");
const dropZone = document.getElementById("drop-zone");
const uploadCard = document.getElementById("upload-card");
const btnToggleUpload = document.getElementById("btn-toggle-upload");

const btnMsaShow = document.getElementById("btn-msa-show");
const btnTreeShow = document.getElementById("btn-tree-show");

const statusCard = document.getElementById("job-status-card");
const statusText = document.getElementById("job-status-text");
const positionText = document.getElementById("job-position-text");
const jobCancelArea = document.getElementById("job-cancel-area");
const btnCancelJob = document.getElementById("btn-cancel-job");

const msaContainer = document.getElementById("msa-container");
const msaDownloadArea = document.getElementById("msa-download-area");
const btnMsaDownload = document.getElementById("btn-msa-download");
const msaLoader = document.getElementById("task-loader-msa");
const msaLoaderLabel = document.getElementById("task-loader-label-msa");
const treeContainer = document.getElementById("tree-container");
const treeDownloadArea = document.getElementById("tree-download-area");
const btnTreeDownload = document.getElementById("btn-tree-download");
const treeLoader = document.getElementById("task-loader-tree");
const treeLoaderLabel = document.getElementById("task-loader-label-tree");
const treeNewickOutput = document.getElementById("tree-newick-output");
const treeResultOverview = document.getElementById("tree-result-overview");
const treeResultBadges = document.getElementById("tree-result-badges");
const treeAnalysisSummary = document.getElementById("tree-analysis-summary");
const treeAnalysisMetrics = document.getElementById("tree-analysis-metrics");
const treeAnalysisWarnings = document.getElementById("tree-analysis-warnings");
const treeAnalysisWarningsList = document.getElementById("tree-analysis-warnings-list");
const treeAnalysisArtifacts = document.getElementById("tree-analysis-artifacts");

const treeMethodSelect = document.getElementById("tree-method");
const treePresetSelect = document.getElementById("tree-preset");
const treeDistanceModelSelect = document.getElementById("tree-distance-model");
const treeSubstitutionModelSelect = document.getElementById("tree-substitution-model");
const treeSupportTypeSelect = document.getElementById("tree-support-type");
const treeSupportReplicatesInput = document.getElementById("tree-support-replicates");

let isFileListOpen = false;
let isUploadCollapsed = false;
let lastFileOrder = [];
let lastMsaResultText = "";
let lastTreeResultText = "";
let lastTreeAnalysisResult = null;
let lastTreeSupportMeta = null;
let lastTreeLeafOrder = [];
let treeOrderButtonsMounted = false;
let currentTreeObj = null;
let originalTreeObj = null;
let treeLabelHitboxes = [];
let treeNodeHitboxes = [];
let selectedTreeNodeId = null;
let collapsedTreeNodeIds = new Set();
let activeHistoryTarget = "msa";
let treeHistory = {
  undoStack: [],
  redoStack: [],
  limit: 50,
  ui: {
    btnUndo: null,
    btnRedo: null
  }
};

let treeViewState = {
  layout: "scaled",
  zoom: 100,
  leafOrder: "original",
  rootTrunkPx: 40,
  minLeafPx: 12,
  scaleMode: "math",
  manualScaleVal: 0.2,
  showLabels: true,
  showBranchLengths: true,
  showSupportValues: true,
  supportMinDisplay: 0
};


let syncMsaOrderOnNextTreeDraw = false;
let forceTreeModeOnNextTreeDraw = false;


function requestTreeOrderSync(options = {}) {
  syncMsaOrderOnNextTreeDraw = true;
  if (options.forceTreeMode) {
    forceTreeModeOnNextTreeDraw = true;
  }
}

function applyPendingTreeOrderSync(nextOrder) {
  const normalized = Array.isArray(nextOrder) ? nextOrder.slice() : [];
  lastTreeLeafOrder = normalized;

  if (!syncMsaOrderOnNextTreeDraw) return;

  syncMsaOrderOnNextTreeDraw = false;

  if (msaViewer && normalized.length) {
    msaViewer.setTreeLeafOrder(normalized);
    if (forceTreeModeOnNextTreeDraw) {
      msaViewer.setOrderMode("tree");
    }
  }

  forceTreeModeOnNextTreeDraw = false;
}

const msaViewer = window.MsaViewer?.createViewer(msaContainer, {
  lastFileOrder
});

msaContainer?.addEventListener("pointerdown", () => {
  activeHistoryTarget = "msa";
});

treeContainer?.addEventListener("pointerdown", () => {
  activeHistoryTarget = "tree";
});

treeDownloadArea?.addEventListener("pointerdown", () => {
  activeHistoryTarget = "tree";
});

treeNewickOutput?.addEventListener("focus", () => {
  activeHistoryTarget = "tree";
});

let browserPreprocessedState = {
  results: [],
  fasta_text: ""
};

let taskRunState = {
  active: false,
  type: null,
  jobId: null
};

const TASK_LOCK_KEY = "nucleomic-active-task-lock-v1";
const TASK_LOCK_TTL_MS = 30 * 60 * 1000;
const TASK_TAB_ID =
  window.crypto?.randomUUID?.() ||
  `tab_${Date.now()}_${Math.random().toString(16).slice(2)}`;

function readTaskLock() {
  try {
    const raw = localStorage.getItem(TASK_LOCK_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const expiresAt = Number(parsed.expiresAt || 0);
    if (!expiresAt || Date.now() > expiresAt) {
      localStorage.removeItem(TASK_LOCK_KEY);
      return null;
    }

    return parsed;
  } catch (_err) {
    localStorage.removeItem(TASK_LOCK_KEY);
    return null;
  }
}

function writeTaskLock(lock) {
  localStorage.setItem(TASK_LOCK_KEY, JSON.stringify(lock));
}

function acquireTaskLock(taskType) {
  const existing = readTaskLock();

  if (existing && existing.owner !== TASK_TAB_ID) {
    return {
      ok: false,
      lock: existing
    };
  }

  const now = Date.now();

  const lock = {
    owner: TASK_TAB_ID,
    taskType,
    jobId: "",
    startedAt: now,
    expiresAt: now + TASK_LOCK_TTL_MS
  };

  writeTaskLock(lock);

  return {
    ok: true,
    lock
  };
}

function refreshTaskLock(jobId = "") {
  const existing = readTaskLock();

  if (!existing || existing.owner !== TASK_TAB_ID) {
    return;
  }

  existing.jobId = jobId || existing.jobId || "";
  existing.expiresAt = Date.now() + TASK_LOCK_TTL_MS;

  writeTaskLock(existing);
}

function releaseTaskLock() {
  const existing = readTaskLock();

  if (existing && existing.owner === TASK_TAB_ID) {
    localStorage.removeItem(TASK_LOCK_KEY);
  }
}

window.addEventListener("beforeunload", () => {
  releaseTaskLock();
});

 function setTaskButtonsDisabled(disabled) {
  [btnMsaShow, btnTreeShow].forEach((btn) => {
    if (!btn) return;
    btn.disabled = disabled;
    btn.style.opacity = disabled ? "0.6" : "1";
    btn.style.cursor = disabled ? "not-allowed" : "pointer";
  });
}

function setMsaLoader(show, label = "Starting task...") {
  if (msaLoader) msaLoader.style.display = show ? "block" : "none";
  if (msaLoaderLabel) msaLoaderLabel.textContent = label;
}

function setTreeLoader(show, label = "Starting task...") {
  if (treeLoader) treeLoader.style.display = show ? "block" : "none";
  if (treeLoaderLabel) treeLoaderLabel.textContent = label;
}

function clustalToFasta(text) {
  const lines = String(text || "").split(/\r?\n/);
  const chunks = new Map();

  for (const rawLine of lines) {
    const line = rawLine || "";
    const trimmed = line.trim();

    if (!trimmed) continue;
    if (/^(CLUSTAL|MUSCLE)\b/i.test(trimmed)) continue;

    // consensus satırları
    if (/^[\*\:\.\s]+$/.test(line)) continue;

    // sadece isimle başlayan gerçek alignment satırları
    const match = line.match(/^(\S+)\s+([A-Za-z\-\.\*]+)(?:\s+\d+)?$/);
    if (!match) continue;

    const name = match[1];
    const seqPart = match[2].replace(/\./g, "-");

    chunks.set(name, (chunks.get(name) || "") + seqPart);
  }

  if (!chunks.size) {
    return String(text || "");
  }

  return Array.from(chunks.entries())
    .map(([name, seq]) => `>${name}\n${seq}`)
    .join("\n");
}

function normalizeMsaTextForViewer(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  // zaten FASTA ise dokunma
  if (raw.startsWith(">")) return raw;

  // CLUSTAL / MUSCLE alignment text ise FASTA'ya çevir
  if (/^(CLUSTAL|MUSCLE)\b/i.test(raw)) {
    return clustalToFasta(raw);
  }

  return raw;
}

function renderMsaResult(text) {
  const normalizedText = normalizeMsaTextForViewer(text);
  lastMsaResultText = normalizedText || "";

  if (!msaContainer) return;

  console.log("MSA raw length:", String(text || "").length);
  console.log("MSA normalized length:", lastMsaResultText.length);
  console.log("MSA preview head:", lastMsaResultText.slice(0, 200));

  try {
    if (window.MsaViewer && msaViewer) {
      msaViewer.render(lastMsaResultText, { lastFileOrder });
    } else {
      msaContainer.innerHTML = "";
      const pre = document.createElement("pre");
      pre.textContent = lastMsaResultText || "(empty result)";
      msaContainer.appendChild(pre);
    }
  } catch (err) {
    console.error("MSA render error:", err);
    msaContainer.innerHTML = "";

    const pre = document.createElement("pre");
    pre.textContent =
      "MSA render error: " + (err?.message || err) + "\n\n" + (lastMsaResultText || "(empty result)");
    msaContainer.appendChild(pre);
  }

  refreshMsaToolbar();

  activeHistoryTarget = "msa";
}

function prettyNewick(text) {
  const s = String(text || "").trim();
  if (!s) return "";

  let out = "";
  let indent = 0;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") {
      out += "(\n" + "  ".repeat(++indent);
    } else if (ch === ",") {
      out += ",\n" + "  ".repeat(indent);
    } else if (ch === ")") {
      out += "\n" + "  ".repeat(--indent) + ")";
    } else if (ch === ";") {
      out += ";\n";
    } else {
      out += ch;
    }
  }

  return out;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseNewickTree(newick) {
  const s = String(newick || "").trim().replace(/;\s*$/, "");
  const ancestors = [];
  let tree = { children: [] };
  let justClosedInternal = false;

  const tokens = s.split(/\s*(;|\(|\)|,|:)\s*/);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    switch (token) {
      case "(":
        {
          const child = { children: [] };
          tree.children = tree.children || [];
          tree.children.push(child);
          ancestors.push(tree);
          tree = child;
          justClosedInternal = false;
        }
        break;

      case ",":
        {
          const sibling = { children: [] };
          const parent = ancestors[ancestors.length - 1];
          parent.children.push(sibling);
          tree = sibling;
          justClosedInternal = false;
        }
        break;

      case ")":
        tree = ancestors.pop();
        justClosedInternal = true;
        break;

      case ":":
      case "":
      case ";":
        break;

      default: {
        const prev = tokens[i - 1];

        if (prev === ":") {
          const len = parseFloat(token);
          tree.length = Number.isFinite(len) ? len : 0;
          justClosedInternal = false;
        } else if (justClosedInternal) {
          const maybeSupport = parseFloat(token);
          if (Number.isFinite(maybeSupport) && String(token).match(/^\d+(\.\d+)?$/)) {
            tree.support = maybeSupport;
          } else {
            tree.name = token;
          }
          justClosedInternal = false;
        } else {
          tree.name = token;
          justClosedInternal = false;
        }
        break;
      }
    }
  }

  return tree;
}

function collectLeaves(node, arr) {
  if (!node) return;
  if (!node.children || node.children.length === 0) {
    arr.push(node);
    return;
  }
  node.children.forEach((child) => collectLeaves(child, arr));
}

function collectSubtreeUiIds(node, set) {
  if (!node) return;
  if (node._uiId) set.add(node._uiId);
  if (Array.isArray(node.children) && node.children.length) {
    node.children.forEach((child) => collectSubtreeUiIds(child, set));
  }
}

function findNodeByUiId(node, uiId) {
  if (!node) return null;
  if (node._uiId === uiId) return node;

  if (Array.isArray(node.children) && node.children.length) {
    for (const child of node.children) {
      const found = findNodeByUiId(child, uiId);
      if (found) return found;
    }
  }

  return null;
}

function findParentOfUiId(node, uiId, parent = null) {
  if (!node) return null;
  if (node._uiId === uiId) return parent;

  if (Array.isArray(node.children) && node.children.length) {
    for (const child of node.children) {
      const found = findParentOfUiId(child, uiId, node);
      if (found) return found;
    }
  }

  return null;
}

function isNodeUnderCollapsedAncestor(root, nodeUiId) {
  if (!root || !nodeUiId) return false;

  let parent = findParentOfUiId(root, nodeUiId);
  while (parent) {
    if (collapsedTreeNodeIds.has(parent._uiId)) {
      return true;
    }
    parent = findParentOfUiId(root, parent._uiId);
  }

  return false;
}

function countVisibleLeaves(node) {
  if (!node) return 0;

  if (collapsedTreeNodeIds.has(node._uiId)) {
    return 1;
  }

  if (!node.children || node.children.length === 0) {
    return 1;
  }

  return node.children.reduce((sum, child) => sum + countVisibleLeaves(child), 0);
}

function collectLeafNames(node, arr, limit = 3) {
  if (!node || arr.length >= limit) return;

  if (!node.children || node.children.length === 0) {
    arr.push(String(node.name || node._sourceName || "").trim());
    return;
  }

  node.children.forEach((child) => {
    if (arr.length < limit) collectLeafNames(child, arr, limit);
  });
}

function makeCollapsedLabel(node) {
  const leafCount = countLeaves(node);
  const names = [];
  collectLeafNames(node, names, 3);

  const preview = names.filter(Boolean).join(", ");
  return preview
    ? `[${leafCount} leaves] ${preview}${leafCount > names.length ? ", ..." : ""}`
    : `[${leafCount} leaves]`;
}

function svgDownload(filename, svgText) {
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function svgLine(x1, y1, x2, y2, stroke = "#000000", width = 1.1) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="square" />`;
}

function svgText(x, y, text, fill = "#000000", anchor = "start") {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace" font-size="12" text-anchor="${anchor}" dominant-baseline="middle">${escapeXml(text)}</text>`;
}

function buildTreeSvg({
  root,
  allNodes,
  edges,
  canvasWidth,
  canvasHeight,
  leftMargin,
  rootTrunkPx,
  showScaleBar,
  scale,
  maxDist,
  selectedUiIds,
  visibleLeaves,
  showSupportValues,
  supportMeta,
  supportMinDisplay,
  footerLines
}) {

  const parts = [];

  const SVG_BRANCH_COLOR = "#000000";
  const SVG_TEXT_COLOR = "#000000";
  const SVG_META_COLOR = "#000000";
  const SVG_SUPPORT_COLOR = "#000000";
  const SVG_SCALE_COLOR = "#000000";
  const SVG_SELECTION_COLOR = "#000000";
  const normalStroke = SVG_BRANCH_COLOR;
  const highlightStroke = SVG_BRANCH_COLOR;
  const normalText = SVG_TEXT_COLOR;
  const highlightText = SVG_TEXT_COLOR;

  const safeFooterLines = Array.isArray(footerLines) ? footerLines.filter(Boolean) : [];
  const footerPaddingTop = safeFooterLines.length ? 14 : 0;
  const footerPaddingBottom = safeFooterLines.length ? 14 : 0;
  const footerLineHeight = 14;
  const footerExtraHeight = safeFooterLines.length
    ? footerPaddingTop + safeFooterLines.length * footerLineHeight + footerPaddingBottom
    : 0;

  const totalSvgHeight = Math.ceil(canvasHeight + footerExtraHeight);

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(canvasWidth)}" height="${totalSvgHeight}" viewBox="0 0 ${Math.ceil(canvasWidth)} ${totalSvgHeight}">`
  );

  function walkVerticals(node) {
    if (collapsedTreeNodeIds.has(node._uiId)) return;
    if (!node.children || node.children.length === 0) return;

    const visibleChildren = node.children.filter((child) => !isNodeUnderCollapsedAncestor(root, child._uiId));
    if (!visibleChildren.length) return;

    const first = visibleChildren[0];
    const last = visibleChildren[visibleChildren.length - 1];
    const nodeX = node._xDraw ?? node.x;

    const verticalHighlighted =
      selectedUiIds &&
      visibleChildren.every((child) => selectedUiIds.has(child._uiId));

    parts.push(
      svgLine(
        nodeX,
        first.y,
        nodeX,
        last.y,
        verticalHighlighted ? highlightStroke : normalStroke,
        verticalHighlighted ? 2.2 : 1.1
      )
    );

    visibleChildren.forEach((child) => walkVerticals(child));
  }

  walkVerticals(root);

  edges.forEach((edge) => {
    if (collapsedTreeNodeIds.has(edge.parent._uiId)) return;
    if (isNodeUnderCollapsedAncestor(root, edge.node._uiId)) return;

    const parentX = edge.parent._xDraw ?? edge.parent.x;
    const childX = edge.node._xDraw ?? edge.node.x;
    const branchHighlighted =
      selectedUiIds && selectedUiIds.has(edge.node._uiId);

    parts.push(
      svgLine(
        parentX,
        edge.node.y,
        childX,
        edge.node.y,
        branchHighlighted ? highlightStroke : normalStroke,
        branchHighlighted ? 2.2 : 1.1
      )
    );
  });

  if (rootTrunkPx > 0) {
    const trunkX0 = leftMargin;
    const trunkX1 = leftMargin + rootTrunkPx;
    const trunkY = root.y;

    parts.push(svgLine(trunkX0, trunkY, trunkX1, trunkY, SVG_BRANCH_COLOR, 1.5));
    parts.push(svgText(trunkX0 + 4, trunkY - 10, "0.00"));
  }

  visibleLeaves.forEach((node) => {
    const isCollapsed = collapsedTreeNodeIds.has(node._uiId);
    const label = isCollapsed ? makeCollapsedLabel(node) : String(node.name || "");
    const x = (node._xDraw ?? node.x) + 6;
    const y = node.y;
    const isHighlighted = selectedUiIds && selectedUiIds.has(node._uiId);

    if (treeViewState.showLabels) {
      parts.push(svgText(x, y, label, isHighlighted ? highlightText : normalText));
    }
  });

  allNodes.forEach((node) => {
    const hiddenByCollapsedAncestor = isNodeUnderCollapsedAncestor(root, node._uiId);
    if (
      node.children &&
      node.children.length > 0 &&
      !collapsedTreeNodeIds.has(node._uiId) &&
      !hiddenByCollapsedAncestor &&
      selectedTreeNodeId === node._uiId
    ) {
      const x = node._xDraw ?? node.x;
      const y = node.y;
      parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="${SVG_SELECTION_COLOR}" />`);
    }
  });

  if (treeViewState.showBranchLengths) {
    edges.forEach((edge) => {
      if (collapsedTreeNodeIds.has(edge.parent._uiId)) return;
      if (isNodeUnderCollapsedAncestor(root, edge.node._uiId)) return;

      const len =
        typeof edge.node.length === "number" && !Number.isNaN(edge.node.length)
          ? edge.node.length
          : 0;

      const label = len.toFixed(2);
      const parentX = edge.parent._xDraw ?? edge.parent.x;
      const childX = edge.node._xDraw ?? edge.node.x;
      const midX = (parentX + childX) / 2;
      const midY = edge.node.y - 4;

      parts.push(
        `<text x="${midX}" y="${midY}" fill="${normalText}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace" font-size="12" text-anchor="middle" dominant-baseline="alphabetic">${escapeXml(label)}</text>`
      );
    });
  }

  if (showSupportValues && supportMeta?.present) {
    const minSupport = Number(supportMinDisplay || 0);

    allNodes.forEach((node) => {
      if (!node.children || node.children.length === 0) return;
      if (collapsedTreeNodeIds.has(node._uiId)) return;
      if (isNodeUnderCollapsedAncestor(root, node._uiId)) return;
      if (typeof node.support !== "number" || Number.isNaN(node.support)) return;
      if (node.support < minSupport) return;

      const x = (node._xDraw ?? node.x) + 4;
      const y = node.y - 10;

      parts.push(svgText(x, y, String(node.support), SVG_SUPPORT_COLOR));
    });
  }

  if (showScaleBar && scale && maxDist) {
    const scaleMode = treeViewState.scaleMode;
    const manualScaleVal = Number(treeViewState.manualScaleVal);

    let scaleBarVal;
    if (scaleMode === "math") {
      scaleBarVal = niceScaleStep(maxDist);
    } else if (scaleMode === "visual") {
      scaleBarVal = niceMegaScale(maxDist);
    } else {
      scaleBarVal =
        Number.isFinite(manualScaleVal) && manualScaleVal > 0
          ? manualScaleVal
          : niceScaleStep(maxDist);
    }

    if (scaleBarVal > 0) {
      const scaleBarPx = scaleBarVal * scale;
      const barX = leftMargin + rootTrunkPx + 8;
      const barY = canvasHeight - 18;

      parts.push(svgLine(barX, barY, barX + scaleBarPx, barY, normalStroke, 1.1));
      parts.push(svgLine(barX, barY - 3, barX, barY + 3, normalStroke, 1.1));
      parts.push(svgLine(barX + scaleBarPx, barY - 3, barX + scaleBarPx, barY + 3, normalStroke, 1.1));
      parts.push(svgText(barX + scaleBarPx / 2, barY - 8, String(scaleBarVal), normalText, "middle"));
    }
  }

  if (safeFooterLines.length) {
    const footerStartY = canvasHeight + footerPaddingTop;

    safeFooterLines.forEach((line, index) => {
      const y = footerStartY + index * footerLineHeight;

      parts.push(
        `<text x="${leftMargin}" y="${y}" fill="${SVG_TEXT_COLOR}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace" font-size="11" text-anchor="start" dominant-baseline="hanging">${escapeXml(line)}</text>`
      );
    });
  }

  parts.push(`</svg>`);
  return parts.join("");
}

function annotateTreeSourceNames(node) {
  if (!node) return;

  if (typeof node._sourceName === "undefined") {
    node._sourceName = node.name || "";
  }

  if (Array.isArray(node.children) && node.children.length) {
    node.children.forEach((child) => annotateTreeSourceNames(child));
  }
}

function assignTreeUiIds(node, counter = { value: 0 }) {
  if (!node) return;
  node._uiId = `tree_ui_${counter.value++}`;
  if (Array.isArray(node.children) && node.children.length) {
    node.children.forEach((child) => assignTreeUiIds(child, counter));
  }
}

function normalizeTreeRoot(root) {
  if (
    root &&
    Array.isArray(root.children) &&
    root.children.length === 1 &&
    !root.name
  ) {
    return root.children[0];
  }
  return root;
}

function countLeaves(node) {
  if (!node) return 0;
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0);
}

function assignLeafY(node, rowHeight, yRef) {
  if (!node.children || node.children.length === 0) {
    node.y = yRef.value;
    yRef.value += rowHeight;
    return;
  }

  node.children.forEach((child) => assignLeafY(child, rowHeight, yRef));
  const first = node.children[0];
  const last = node.children[node.children.length - 1];
  node.y = (first.y + last.y) / 2;
}

function maxRootToLeaf(node, acc = 0) {
  if (!node) return acc;

  const len =
    typeof node.length === "number" && !Number.isNaN(node.length)
      ? node.length
      : 0;

  const here = acc + len;

  if (!node.children || node.children.length === 0) {
    return here;
  }

  return Math.max(...node.children.map((child) => maxRootToLeaf(child, here)));
}

function assignScaledX(node, parentX, scale, leftMargin) {
  const len =
    typeof node.length === "number" && !Number.isNaN(node.length)
      ? node.length
      : 0;

  const x = parentX + len * scale;
  node.x = x;

  if (node.children && node.children.length) {
    node.children.forEach((child) => assignScaledX(child, x, scale, leftMargin));
  }
}

function maxDepth(node) {
  if (!node || !node.children || node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map((child) => maxDepth(child)));
}

function assignCladogramX(node, depth, step, leftMargin, leafX) {
  if (!node.children || node.children.length === 0) {
    node.x = leafX;
    return;
  }

  node.x = leftMargin + depth * step;
  node.children.forEach((child) => {
    assignCladogramX(child, depth + 1, step, leftMargin, leafX);
  });
}

function computeLeafCounts(node) {
  if (!node) return 0;
  if (!node.children || node.children.length === 0) {
    node._leafCount = 1;
    return 1;
  }

  let total = 0;
  node.children.forEach((child) => {
    total += computeLeafCounts(child);
  });

  node._leafCount = total;
  return total;
}

function assignLeafYOrdered(node, rowHeight, yRef, optimized = false) {
  if (collapsedTreeNodeIds.has(node._uiId)) {
    node.y = yRef.value;
    yRef.value += rowHeight;
    return;
  }

  if (!node.children || node.children.length === 0) {
    node.y = yRef.value;
    yRef.value += rowHeight;
    return;
  }

  let children = node.children;
  if (optimized) {
    children = node.children.slice().sort((a, b) => {
      const aCount = typeof a._leafCount === "number" ? a._leafCount : 1;
      const bCount = typeof b._leafCount === "number" ? b._leafCount : 1;
      return aCount - bCount;
    });
  }

  children.forEach((child) => assignLeafYOrdered(child, rowHeight, yRef, optimized));

  const first = children[0];
  const last = children[children.length - 1];
  node.y = (first.y + last.y) / 2;
}

function ladderizeTree(node, direction = "right") {
  if (!node || !Array.isArray(node.children) || node.children.length === 0) {
    return;
  }

  node.children.forEach((child) => ladderizeTree(child, direction));

  node.children.sort((a, b) => {
    const aCount = typeof a._leafCount === "number" ? a._leafCount : countLeaves(a);
    const bCount = typeof b._leafCount === "number" ? b._leafCount : countLeaves(b);

    return direction === "left"
      ? bCount - aCount
      : aCount - bCount;
  });
}

function assignGraphIds(node, counter = { value: 0 }) {
  if (!node) return;
  node._graphId = `n${counter.value++}`;
  if (Array.isArray(node.children)) {
    node.children.forEach((child) => assignGraphIds(child, counter));
  }
}

function buildUndirectedGraph(root) {
  const adjacency = new Map();
  const meta = new Map();
  const leafIds = new Set();

  function ensure(id) {
    if (!adjacency.has(id)) adjacency.set(id, []);
  }

  function walk(node, parent = null) {
    if (!node) return;

    const id = node._graphId;
    ensure(id);

    meta.set(id, {
      name: typeof node.name === "string" ? node.name : "",
      _sourceName: typeof node._sourceName === "string" ? node._sourceName : (node.name || "")
    });

    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      leafIds.add(id);
    }

    children.forEach((child) => {
      const childId = child._graphId;
      ensure(childId);

      const len =
        typeof child.length === "number" && !Number.isNaN(child.length)
          ? child.length
          : 0;

      adjacency.get(id).push({ to: childId, length: len });
      adjacency.get(childId).push({ to: id, length: len });

      walk(child, node);
    });
  }

  walk(root);
  return { adjacency, meta, leafIds };
}

function farthestLeafFrom(startId, adjacency, leafIds) {
  let bestId = startId;
  let bestDist = -1;
  const parent = new Map();

  function dfs(curr, prev, dist) {
    if (leafIds.has(curr) && dist > bestDist) {
      bestDist = dist;
      bestId = curr;
    }

    const neighbors = adjacency.get(curr) || [];
    neighbors.forEach(({ to, length }) => {
      if (to === prev) return;
      parent.set(to, curr);
      dfs(to, curr, dist + length);
    });
  }

  dfs(startId, null, 0);
  return { id: bestId, dist: bestDist, parent };
}

function getEdgeLength(adjacency, a, b) {
  const neighbors = adjacency.get(a) || [];
  const edge = neighbors.find((x) => x.to === b);
  return edge ? edge.length : 0;
}

function buildPath(parentMap, startId, endId) {
  const path = [endId];
  let curr = endId;

  while (curr !== startId) {
    curr = parentMap.get(curr);
    if (typeof curr === "undefined") break;
    path.push(curr);
  }

  return path.reverse();
}

function orientFromGraph(nodeId, parentId, edgeLenToParent, adjacency, meta) {
  const nodeMeta = meta.get(nodeId) || { name: "", _sourceName: "" };

  const node = {
    name: nodeMeta.name || "",
    _sourceName: nodeMeta._sourceName || "",
    length: edgeLenToParent,
    children: []
  };

  const neighbors = adjacency.get(nodeId) || [];
  neighbors.forEach(({ to, length }) => {
    if (to === parentId) return;
    node.children.push(
      orientFromGraph(to, nodeId, length, adjacency, meta)
    );
  });

  return node;
}

function midpointRerootTree(root) {
  if (!root) return null;

  const working = cloneTreeNode(root);
  assignGraphIds(working);

  const { adjacency, meta, leafIds } = buildUndirectedGraph(working);
  const leaves = Array.from(leafIds);

  if (leaves.length < 2) {
    return working;
  }

  const first = farthestLeafFrom(leaves[0], adjacency, leafIds);
  const second = farthestLeafFrom(first.id, adjacency, leafIds);

  const total = second.dist;
  const target = total / 2;
  const path = buildPath(second.parent, first.id, second.id);

  const EPS = 1e-9;
  let walked = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const edgeLen = getEdgeLength(adjacency, a, b);
    const nextWalked = walked + edgeLen;

    if (Math.abs(target - walked) <= EPS) {
      const rerooted = orientFromGraph(a, null, 0, adjacency, meta);
      rerooted.length = 0;
      return rerooted;
    }

    if (Math.abs(target - nextWalked) <= EPS) {
      const rerooted = orientFromGraph(b, null, 0, adjacency, meta);
      rerooted.length = 0;
      return rerooted;
    }

    if (target > walked && target < nextWalked) {
      const leftLen = target - walked;
      const rightLen = edgeLen - leftLen;

      return {
        name: "",
        _sourceName: "",
        length: 0,
        children: [
          orientFromGraph(a, b, leftLen, adjacency, meta),
          orientFromGraph(b, a, rightLen, adjacency, meta)
        ]
      };
    }

    walked = nextWalked;
  }

  return working;
}

function niceScaleStep(maxDist) {
  if (!Number.isFinite(maxDist) || maxDist <= 0) return 0;

  const exponent = Math.floor(Math.log10(maxDist));
  const base = Math.pow(10, exponent);
  const candidates = [1, 2, 5].map((m) => m * base);

  let step = candidates[0];
  for (const c of candidates) {
    if (c <= maxDist) step = c;
  }
  return step;
}

function niceMegaScale(maxDist) {
  if (!Number.isFinite(maxDist) || maxDist <= 0) return 0;

  if (maxDist <= 0.05) return 0.02;
  if (maxDist <= 0.10) return 0.05;
  if (maxDist <= 0.20) return 0.10;
  if (maxDist <= 0.40) return 0.20;
  if (maxDist <= 0.80) return 0.50;
  if (maxDist <= 1.60) return 1.00;
  if (maxDist <= 3.20) return 2.00;
  return 5.00;
}

function flattenNodes(node, arr = []) {
  if (!node) return arr;
  arr.push(node);
  if (node.children && node.children.length) {
    node.children.forEach((child) => flattenNodes(child, arr));
  }
  return arr;
}

function treeToNewick(node) {
  function format(n) {
    const len =
      typeof n.length === "number" && !Number.isNaN(n.length)
        ? n.length
        : 0;

    const lenStr = ":" + len;

    if (!n.children || !n.children.length) {
      return `${n.name || ""}${lenStr}`;
    }

    const childrenStr = n.children.map((child) => format(child)).join(",");
    const internalLabel =
      typeof n.support === "number" && !Number.isNaN(n.support)
        ? String(n.support)
        : (n.name || "");

    return `(${childrenStr})${internalLabel}${lenStr}`;
  }

  return format(node) + ";";
}

function cloneTreeNode(node) {
  if (!node) return null;

  return {
    name: typeof node.name === "string" ? node.name : "",
    length:
      typeof node.length === "number" && !Number.isNaN(node.length)
        ? node.length
        : 0,
    support:
      typeof node.support === "number" && !Number.isNaN(node.support)
        ? node.support
        : null,
    _sourceName:
      typeof node._sourceName === "string"
        ? node._sourceName
        : (node.name || ""),
    children: Array.isArray(node.children)
      ? node.children.map((child) => cloneTreeNode(child))
      : []
  };
}

function createTreeHistorySnapshot() {
  if (!currentTreeObj) return null;

  return {
    root: cloneTreeNode(currentTreeObj)
  };
}

function updateTreeHistoryButtons() {
  const btnUndo = treeHistory.ui?.btnUndo;
  const btnRedo = treeHistory.ui?.btnRedo;

  if (btnUndo) {
    btnUndo.disabled = !treeHistory.undoStack.length;
    btnUndo.style.opacity = btnUndo.disabled ? "0.5" : "1";
    btnUndo.style.cursor = btnUndo.disabled ? "not-allowed" : "pointer";
  }

  if (btnRedo) {
    btnRedo.disabled = !treeHistory.redoStack.length;
    btnRedo.style.opacity = btnRedo.disabled ? "0.5" : "1";
    btnRedo.style.cursor = btnRedo.disabled ? "not-allowed" : "pointer";
  }
}

function resetTreeHistory() {
  treeHistory.undoStack = [];
  treeHistory.redoStack = [];
  updateTreeHistoryButtons();
}

function pushTreeUndoSnapshot() {
  const snapshot = createTreeHistorySnapshot();
  if (!snapshot) return;

  treeHistory.undoStack.push(snapshot);

  if (treeHistory.undoStack.length > treeHistory.limit) {
    treeHistory.undoStack.shift();
  }

  treeHistory.redoStack = [];
  updateTreeHistoryButtons();
}

function syncTreeLeafOrderFromCurrentTree() {
  lastTreeLeafOrder = [];

  if (!currentTreeObj) return;

  const leaves = [];
  collectLeaves(currentTreeObj, leaves);

  lastTreeLeafOrder = leaves
    .map((leaf) => String(leaf._sourceName || leaf.name || "").trim())
    .filter(Boolean);
}

function applyTreeHistorySnapshot(snapshot) {
  if (!snapshot?.root) return;

  currentTreeObj = cloneTreeNode(snapshot.root);
  assignTreeUiIds(currentTreeObj);
  lastTreeResultText = treeToNewick(currentTreeObj);

  syncTreeLeafOrderFromCurrentTree();

  if (treeNewickOutput) {
    treeNewickOutput.value = prettyNewick(lastTreeResultText);
  }

  requestTreeOrderSync();
  renderTreeCanvas(currentTreeObj, lastTreeResultText);
  refreshMsaToolbar();
  updateTreeHistoryButtons();
}

function performTreeUndo() {
  if (!treeHistory.undoStack.length || !currentTreeObj) return;

  const currentSnapshot = createTreeHistorySnapshot();
  const prevSnapshot = treeHistory.undoStack.pop();

  if (currentSnapshot) {
    treeHistory.redoStack.push(currentSnapshot);
  }

  applyTreeHistorySnapshot(prevSnapshot);
}

function performTreeRedo() {
  if (!treeHistory.redoStack.length || !currentTreeObj) return;

  const currentSnapshot = createTreeHistorySnapshot();
  const nextSnapshot = treeHistory.redoStack.pop();

  if (currentSnapshot) {
    treeHistory.undoStack.push(currentSnapshot);
  }

  applyTreeHistorySnapshot(nextSnapshot);
}



function renderTreeCanvas(root, newickText) {
  if (!treeContainer) return;

  treeContainer.innerHTML = "";
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar tree-viewer-toolbar";

  const btnTreeUndo = document.createElement("button");
  btnTreeUndo.type = "button";
  btnTreeUndo.className = "btn btn-tonal";
  btnTreeUndo.textContent = "Undo";
  btnTreeUndo.addEventListener("click", () => performTreeUndo());

  const btnTreeRedo = document.createElement("button");
  btnTreeRedo.type = "button";
  btnTreeRedo.className = "btn btn-tonal";
  btnTreeRedo.textContent = "Redo";
  btnTreeRedo.addEventListener("click", () => performTreeRedo());

  const btnMidpointReroot = document.createElement("button");
  btnMidpointReroot.type = "button";
  btnMidpointReroot.className = "btn btn-tonal";
  btnMidpointReroot.textContent = "Midpoint reroot";

  const btnOriginalRoot = document.createElement("button");
  btnOriginalRoot.type = "button";
  btnOriginalRoot.className = "btn btn-tonal";
  btnOriginalRoot.textContent = "Original root";

  const btnClearSelection = document.createElement("button");
  btnClearSelection.type = "button";
  btnClearSelection.className = "btn btn-tonal";
  btnClearSelection.textContent = "Clear selection";

  const btnCollapseClade = document.createElement("button");
  btnCollapseClade.type = "button";
  btnCollapseClade.className = "btn btn-tonal";
  btnCollapseClade.textContent = "Collapse clade";

  const btnExpandClade = document.createElement("button");
  btnExpandClade.type = "button";
  btnExpandClade.className = "btn btn-tonal";
  btnExpandClade.textContent = "Expand clade";

  const btnLadderizeLeft = document.createElement("button");
  btnLadderizeLeft.type = "button";
  btnLadderizeLeft.className = "btn btn-tonal";
  btnLadderizeLeft.textContent = "Ladderize left";

  const btnLadderizeRight = document.createElement("button");
  btnLadderizeRight.type = "button";
  btnLadderizeRight.className = "btn btn-tonal";
  btnLadderizeRight.textContent = "Ladderize right";

  const btnExportSvg = document.createElement("button");
  btnExportSvg.type = "button";
  btnExportSvg.className = "btn btn-tonal";
  btnExportSvg.textContent = "Export SVG";

  toolbar.appendChild(btnTreeUndo);
  toolbar.appendChild(btnTreeRedo);
  toolbar.appendChild(btnMidpointReroot);
  toolbar.appendChild(btnOriginalRoot);
  toolbar.appendChild(btnClearSelection);
  toolbar.appendChild(btnCollapseClade);
  toolbar.appendChild(btnExpandClade);
  toolbar.appendChild(btnLadderizeLeft);
  toolbar.appendChild(btnLadderizeRight);
  toolbar.appendChild(btnExportSvg);
  treeContainer.appendChild(toolbar);

  treeHistory.ui.btnUndo = btnTreeUndo;
  treeHistory.ui.btnRedo = btnTreeRedo;

  const title = document.createElement("div");
  title.className = "tree-viewer-title";

  const currentMethod =
    lastTreeAnalysisResult?.result?.analysis_summary?.method || "";

  title.textContent = currentMethod
    ? `Tree view (${String(currentMethod).toUpperCase()})`
    : "Tree view";

  treeContainer.appendChild(title);

  const controls = document.createElement("div");
  controls.className = "tree-viewer-controls";

  const layoutLabel = document.createElement("label");
  layoutLabel.className = "tree-viewer-control";

  const layoutText = document.createElement("span");
  layoutText.textContent = "Layout";

  const layoutSelect = document.createElement("select");
  layoutSelect.innerHTML = `
    <option value="scaled">Scaled</option>
    <option value="cladogram">Cladogram</option>
  `;
  layoutSelect.value = treeViewState.layout;

  layoutLabel.appendChild(layoutText);
  layoutLabel.appendChild(layoutSelect);

  const zoomLabel = document.createElement("label");
  zoomLabel.className = "tree-viewer-control";

  const zoomText = document.createElement("span");
  zoomText.textContent = "Zoom";

  const zoomInput = document.createElement("input");
  zoomInput.type = "range";
  zoomInput.min = "50";
  zoomInput.max = "250";
  zoomInput.step = "10";
  zoomInput.value = String(treeViewState.zoom);
  zoomInput.className = "tree-viewer-range";

  const zoomValue = document.createElement("span");
  zoomValue.className = "tree-viewer-zoom-value";

  zoomLabel.appendChild(zoomText);
  zoomLabel.appendChild(zoomInput);
  zoomLabel.appendChild(zoomValue);

  const orderLabel = document.createElement("label");
  orderLabel.className = "tree-viewer-control";

  const orderText = document.createElement("span");
  orderText.textContent = "Leaf order";

  const orderSelect = document.createElement("select");
  orderSelect.innerHTML = `
    <option value="original">Original</option>
    <option value="optimized">Optimized</option>
  `;
  orderSelect.value = treeViewState.leafOrder;

  orderLabel.appendChild(orderText);
  orderLabel.appendChild(orderSelect);

  const rootLabel = document.createElement("label");
  rootLabel.className = "tree-viewer-control";

  const rootText = document.createElement("span");
  rootText.textContent = "Root trunk";

  const rootInput = document.createElement("input");
  rootInput.type = "number";
  rootInput.min = "0";
  rootInput.step = "1";
  rootInput.value = String(treeViewState.rootTrunkPx);

  rootLabel.appendChild(rootText);
  rootLabel.appendChild(rootInput);

  const leafMinLabel = document.createElement("label");
  leafMinLabel.className = "tree-viewer-control";

  const leafMinText = document.createElement("span");
  leafMinText.textContent = "Min leaf branch";

  const leafMinInput = document.createElement("input");
  leafMinInput.type = "number";
  leafMinInput.min = "0";
  leafMinInput.step = "1";
  leafMinInput.value = String(treeViewState.minLeafPx);

  leafMinLabel.appendChild(leafMinText);
  leafMinLabel.appendChild(leafMinInput);

  const scaleModeLabel = document.createElement("label");
  scaleModeLabel.className = "tree-viewer-control";

  const scaleModeText = document.createElement("span");
  scaleModeText.textContent = "Scale bar";

  const scaleModeSelect = document.createElement("select");
  scaleModeSelect.innerHTML = `
    <option value="math">Auto (math)</option>
    <option value="visual">Auto (visual)</option>
    <option value="manual">Manual</option>
  `;
  scaleModeSelect.value = treeViewState.scaleMode;

  scaleModeLabel.appendChild(scaleModeText);
  scaleModeLabel.appendChild(scaleModeSelect);

  const scaleManualLabel = document.createElement("label");
  scaleManualLabel.className = "tree-viewer-control";

  const scaleManualText = document.createElement("span");
  scaleManualText.textContent = "Scale value";

  const scaleManualInput = document.createElement("input");
  scaleManualInput.type = "number";
  scaleManualInput.min = "0";
  scaleManualInput.step = "0.01";
  scaleManualInput.value = String(treeViewState.manualScaleVal);

  scaleManualLabel.appendChild(scaleManualText);
  scaleManualLabel.appendChild(scaleManualInput);

  const labelsToggleLabel = document.createElement("label");
  labelsToggleLabel.className = "tree-viewer-control";

  const labelsToggleText = document.createElement("span");
  labelsToggleText.textContent = "Show labels";

  const labelsToggleInput = document.createElement("input");
  labelsToggleInput.type = "checkbox";
  labelsToggleInput.checked = !!treeViewState.showLabels;

  labelsToggleLabel.appendChild(labelsToggleText);
  labelsToggleLabel.appendChild(labelsToggleInput);

  const branchLengthsToggleLabel = document.createElement("label");
  branchLengthsToggleLabel.className = "tree-viewer-control";

  const supportToggleLabel = document.createElement("label");
  supportToggleLabel.className = "tree-viewer-control";

  const supportToggleText = document.createElement("span");
  supportToggleText.textContent = "Show support values";

  const supportToggleInput = document.createElement("input");
  supportToggleInput.type = "checkbox";
  supportToggleInput.checked = !!treeViewState.showSupportValues;

  supportToggleLabel.appendChild(supportToggleText);
  supportToggleLabel.appendChild(supportToggleInput);

  const supportMinLabel = document.createElement("label");
  supportMinLabel.className = "tree-viewer-control";

  const supportMinText = document.createElement("span");
  supportMinText.textContent = "Min support";

  const supportMinInput = document.createElement("input");
  supportMinInput.type = "number";
  supportMinInput.min = "0";
  supportMinInput.max = "100";
  supportMinInput.step = "1";
  supportMinInput.value = String(treeViewState.supportMinDisplay ?? 0);

  supportMinLabel.appendChild(supportMinText);
  supportMinLabel.appendChild(supportMinInput);

  const branchLengthsToggleText = document.createElement("span");
  branchLengthsToggleText.textContent = "Show branch lengths";

  const branchLengthsToggleInput = document.createElement("input");
  branchLengthsToggleInput.type = "checkbox";
  branchLengthsToggleInput.checked = !!treeViewState.showBranchLengths;

  branchLengthsToggleLabel.appendChild(branchLengthsToggleText);
  branchLengthsToggleLabel.appendChild(branchLengthsToggleInput);

  controls.appendChild(layoutLabel);
  controls.appendChild(zoomLabel);
  controls.appendChild(orderLabel);
  controls.appendChild(rootLabel);
  controls.appendChild(leafMinLabel);
  controls.appendChild(scaleModeLabel);
  controls.appendChild(scaleManualLabel);
  controls.appendChild(labelsToggleLabel);
  controls.appendChild(branchLengthsToggleLabel);
  controls.appendChild(supportToggleLabel);
  controls.appendChild(supportMinLabel);

  treeContainer.appendChild(controls);

  const wrapper = document.createElement("div");
  wrapper.className = "tree-viewer-surface";

  const canvas = document.createElement("canvas");
  canvas.className = "tree-viewer-canvas";
  wrapper.appendChild(canvas);
  treeContainer.appendChild(wrapper);

  const ctx = canvas.getContext("2d");

  currentTreeObj = root;

  const validUiIds = new Set();
  collectSubtreeUiIds(currentTreeObj, validUiIds);

  collapsedTreeNodeIds = new Set(
    [...collapsedTreeNodeIds].filter((id) => validUiIds.has(id))
  );

  if (selectedTreeNodeId && !findNodeByUiId(currentTreeObj, selectedTreeNodeId)) {
    selectedTreeNodeId = null;
  }

  function applyLadderize(direction) {
    if (!currentTreeObj) return;

    pushTreeUndoSnapshot();
    computeLeafCounts(currentTreeObj);
    ladderizeTree(currentTreeObj, direction);
    assignTreeUiIds(currentTreeObj);

    lastTreeResultText = treeToNewick(currentTreeObj);

    syncTreeLeafOrderFromCurrentTree();

    if (treeNewickOutput) {
      treeNewickOutput.value = prettyNewick(lastTreeResultText);
    }

    requestTreeOrderSync();
    renderTreeCanvas(currentTreeObj, lastTreeResultText);
  }

  const selectedNodeForToolbar = selectedTreeNodeId
  ? findNodeByUiId(currentTreeObj, selectedTreeNodeId)
  : null;

  const selectedIsInternal =
    !!selectedNodeForToolbar &&
    Array.isArray(selectedNodeForToolbar.children) &&
    selectedNodeForToolbar.children.length > 0;

  const selectedIsCollapsed =
    !!selectedNodeForToolbar &&
    collapsedTreeNodeIds.has(selectedNodeForToolbar._uiId);

  btnCollapseClade.disabled = !selectedIsInternal || selectedIsCollapsed;
  btnCollapseClade.style.opacity = btnCollapseClade.disabled ? "0.5" : "1";
  btnCollapseClade.style.cursor = btnCollapseClade.disabled ? "not-allowed" : "pointer";

  btnExpandClade.disabled = !selectedIsInternal || !selectedIsCollapsed;
  btnExpandClade.style.opacity = btnExpandClade.disabled ? "0.5" : "1";
  btnExpandClade.style.cursor = btnExpandClade.disabled ? "not-allowed" : "pointer";

  btnCollapseClade.addEventListener("click", () => {
    const selectedNode = selectedTreeNodeId
      ? findNodeByUiId(currentTreeObj, selectedTreeNodeId)
      : null;

    if (!selectedNode) return;
    if (!selectedNode.children || selectedNode.children.length === 0) return;

    collapsedTreeNodeIds.add(selectedNode._uiId);
    renderTreeCanvas(currentTreeObj, lastTreeResultText);
  });

  btnExpandClade.addEventListener("click", () => {
    const selectedNode = selectedTreeNodeId
      ? findNodeByUiId(currentTreeObj, selectedTreeNodeId)
      : null;

    if (!selectedNode) return;

    collapsedTreeNodeIds.delete(selectedNode._uiId);
    renderTreeCanvas(currentTreeObj, lastTreeResultText);
  });

  btnMidpointReroot.addEventListener("click", () => {
    if (!currentTreeObj) return;

    pushTreeUndoSnapshot();

    const rerooted = midpointRerootTree(currentTreeObj);
    if (!rerooted) return;

    currentTreeObj = rerooted;
    assignTreeUiIds(currentTreeObj);
    lastTreeResultText = treeToNewick(currentTreeObj);

    syncTreeLeafOrderFromCurrentTree();

    if (treeNewickOutput) {
      treeNewickOutput.value = prettyNewick(lastTreeResultText);
    }

    requestTreeOrderSync();
    renderTreeCanvas(currentTreeObj, lastTreeResultText);
  });

  btnOriginalRoot.addEventListener("click", () => {
    if (!originalTreeObj) return;

    pushTreeUndoSnapshot();

    currentTreeObj = cloneTreeNode(originalTreeObj);
    assignTreeUiIds(currentTreeObj);
    lastTreeResultText = treeToNewick(currentTreeObj);

    syncTreeLeafOrderFromCurrentTree();

    if (treeNewickOutput) {
      treeNewickOutput.value = prettyNewick(lastTreeResultText);
    }

    requestTreeOrderSync();
    renderTreeCanvas(currentTreeObj, lastTreeResultText);
  });

  btnLadderizeLeft.addEventListener("click", () => {
    applyLadderize("left");
  });

  btnLadderizeRight.addEventListener("click", () => {
    applyLadderize("right");
  });

  function updateZoomLabel() {
    zoomValue.textContent = `${treeViewState.zoom}%`;
  }

  function drawTree() {
    if (!root) return;
    treeLabelHitboxes = [];
    treeNodeHitboxes = [];

    const rowHeight = 28;
    const topMargin = 28;
    const leftMargin = 28;
    const rightMargin = 240;
    const bottomMargin = 40;
    const baseInnerWidth = 760;

    const zoomFactor = Math.max(
      0.5,
      Math.min(2.5, (Number(treeViewState.zoom) || 100) / 100)
    );

    const innerWidth = Math.round(baseInnerWidth * zoomFactor);
    const optimized = treeViewState.leafOrder === "optimized";
    const rootTrunkPx = Math.max(0, parseInt(treeViewState.rootTrunkPx, 10) || 0);
    const minLeafPx =
      treeViewState.layout === "scaled"
        ? Math.max(0, parseInt(treeViewState.minLeafPx, 10) || 0)
        : 0;

    computeLeafCounts(root);

    const leafCount = Math.max(countVisibleLeaves(root), 1);
    assignLeafYOrdered(root, rowHeight, { value: topMargin }, optimized);

    if (treeViewState.layout === "scaled") {
      const maxDist = Math.max(maxRootToLeaf(root), 1e-9);
      const scale = innerWidth / maxDist;

      assignScaledX(root, 0, scale, leftMargin);

      const allNodes = flattenNodes(root);
      const minX = Math.min(...allNodes.map((n) => n.x));
      const shift = leftMargin + rootTrunkPx - minX;

      allNodes.forEach((n) => {
        n.x += shift;
      });

      function setDrawX(node, parent) {
        node._xDraw = node.x;

        if (
          parent &&
          minLeafPx > 0 &&
          (!node.children || node.children.length === 0)
        ) {
          const dx = node._xDraw - parent._xDraw;
          if (dx < minLeafPx) {
            node._xDraw = parent._xDraw + minLeafPx;
          }
        }

        if (node.children && node.children.length) {
          node.children.forEach((child) => setDrawX(child, node));
        }
      }

      setDrawX(root, null);

      drawTreeScene({
        allNodes,
        leafCount,
        rowHeight,
        topMargin,
        leftMargin,
        rightMargin,
        bottomMargin,
        canvasWidth: Math.max(
          leftMargin + rootTrunkPx + innerWidth + rightMargin,
          Math.max(...allNodes.map((n) => n._xDraw || n.x)) + rightMargin
        ),
        showScaleBar: true,
        scale,
        maxDist,
        rootTrunkPx
      });
    } else {
      const depth = Math.max(maxDepth(root), 1);
      const axisStartX = leftMargin + rootTrunkPx;
      const step = innerWidth / depth;
      const leafX = axisStartX + depth * step;

      assignCladogramX(root, 0, step, axisStartX, leafX);

      const allNodes = flattenNodes(root);
      allNodes.forEach((n) => {
        n._xDraw = n.x;
      });

      drawTreeScene({
        allNodes,
        leafCount,
        rowHeight,
        topMargin,
        leftMargin,
        rightMargin,
        bottomMargin,
        canvasWidth: Math.max(
          leafX + rightMargin,
          Math.max(...allNodes.map((n) => n._xDraw || n.x)) + rightMargin
        ),
        showScaleBar: false,
        scale: null,
        maxDist: null,
        rootTrunkPx
      });
    }
  }

  function drawTreeScene({
    allNodes,
    leafCount,
    rowHeight,
    topMargin,
    leftMargin,
    rightMargin,
    bottomMargin,
    canvasWidth,
    showScaleBar,
    scale,
    maxDist,
    rootTrunkPx
  }) {
    const canvasHeight = topMargin + leafCount * rowHeight + bottomMargin;

    canvas.width = Math.ceil(canvasWidth);
    canvas.height = canvasHeight;

    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1.1;
    ctx.fillStyle = "#e5e7eb";
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    ctx.textBaseline = "middle";

    const edges = [];
    let selectedUiIds = null;
    if (selectedTreeNodeId) {
      const selectedNode = findNodeByUiId(root, selectedTreeNodeId);
      if (selectedNode) {
        selectedUiIds = new Set();
        collectSubtreeUiIds(selectedNode, selectedUiIds);
      }
    }

    function drawBranches(node, parent = null) {
      if (collapsedTreeNodeIds.has(node._uiId)) return;
      if (!node.children || node.children.length === 0) return;

      const first = node.children[0];
      const last = node.children[node.children.length - 1];
      const nodeX = node._xDraw ?? node.x;

      const verticalHighlighted =
        selectedUiIds &&
        node.children.every((child) => selectedUiIds.has(child._uiId));

      ctx.save();
      ctx.strokeStyle = verticalHighlighted ? "#22c55e" : "#e5e7eb";
      ctx.lineWidth = verticalHighlighted ? 2.2 : 1.1;

      ctx.beginPath();
      ctx.moveTo(nodeX, first.y);
      ctx.lineTo(nodeX, last.y);
      ctx.stroke();
      ctx.restore();

      node.children.forEach((child) => {
        const childX = child._xDraw ?? child.x;

        const branchHighlighted =
          selectedUiIds && selectedUiIds.has(child._uiId);

        ctx.save();
        ctx.strokeStyle = branchHighlighted ? "#22c55e" : "#e5e7eb";
        ctx.lineWidth = branchHighlighted ? 2.2 : 1.1;

        ctx.beginPath();
        ctx.moveTo(nodeX, child.y);
        ctx.lineTo(childX, child.y);
        ctx.stroke();
        ctx.restore();

        edges.push({
          parent: node,
          node: child
        });

        if (!collapsedTreeNodeIds.has(child._uiId)) {
          drawBranches(child, node);
        }
      });
    }

    drawBranches(root);

    if (rootTrunkPx > 0) {
      const trunkX0 = leftMargin;
      const trunkX1 = leftMargin + rootTrunkPx;
      const trunkY = root.y;

      ctx.beginPath();
      ctx.moveTo(trunkX0, trunkY);
      ctx.lineTo(trunkX1, trunkY);
      ctx.stroke();

      ctx.fillText("0.00", trunkX0 + 4, trunkY - 10);
    }

    const visibleLeaves = [];

    allNodes.forEach((node) => {
      const isCollapsed = collapsedTreeNodeIds.has(node._uiId);
      const isLeaf = !node.children || node.children.length === 0;
      const hiddenByCollapsedAncestor = isNodeUnderCollapsedAncestor(root, node._uiId);

      if (hiddenByCollapsedAncestor) {
        return;
      }

      if (isLeaf || isCollapsed) {
        const label = isCollapsed
          ? makeCollapsedLabel(node)
          : String(node.name || "");

        const x = (node._xDraw ?? node.x) + 6;
        const y = node.y;

        if (treeViewState.showLabels) {
          const isHighlighted =
            selectedUiIds && selectedUiIds.has(node._uiId);

          ctx.save();
          ctx.fillStyle = isHighlighted ? "#22c55e" : "#e5e7eb";
          ctx.fillText(label, x, y);
          ctx.restore();

          const width = ctx.measureText(label).width;
          const height = 14;

          treeLabelHitboxes.push({
            node,
            x,
            y: y - height / 2,
            w: width,
            h: height
          });
        }

        visibleLeaves.push(node);
      }
    });

    allNodes.forEach((node) => {
      const hiddenByCollapsedAncestor = isNodeUnderCollapsedAncestor(root, node._uiId);

      if (
        node.children &&
        node.children.length > 0 &&
        !collapsedTreeNodeIds.has(node._uiId) &&
        !hiddenByCollapsedAncestor
      ) {
        const x = node._xDraw ?? node.x;
        const y = node.y;

        treeNodeHitboxes.push({
          node,
          x: x - 6,
          y: y - 6,
          w: 12,
          h: 12
        });

        const isSelected = selectedTreeNodeId && node._uiId === selectedTreeNodeId;
        if (isSelected) {
          ctx.save();
          ctx.fillStyle = "#22c55e";
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    });

    visibleLeaves.sort((a, b) => a.y - b.y);

    const visibleLeafOrder = visibleLeaves
      .map((leaf) => String(leaf._sourceName || leaf.name || "").trim())
      .filter(Boolean);

    applyPendingTreeOrderSync(visibleLeafOrder);

    ctx.textBaseline = "alphabetic";

    if (treeViewState.showBranchLengths) {
      edges.forEach((edge) => {
        if (collapsedTreeNodeIds.has(edge.parent._uiId)) return;

        const len =
          typeof edge.node.length === "number" && !Number.isNaN(edge.node.length)
            ? edge.node.length
            : 0;

        const label = len.toFixed(2);
        const parentX = edge.parent._xDraw ?? edge.parent.x;
        const childX = edge.node._xDraw ?? edge.node.x;

        const midX = (parentX + childX) / 2;
        const midY = edge.node.y;

        const textWidth = ctx.measureText(label).width;
        const textX = midX - textWidth / 2;
        const textY = midY - 4;

        ctx.fillText(label, textX, textY);
      });
    }

    ctx.textBaseline = "middle";

    if (treeViewState.showSupportValues && lastTreeSupportMeta?.present) {
      const minSupport = Number(treeViewState.supportMinDisplay || 0);

      allNodes.forEach((node) => {
        if (!node.children || node.children.length === 0) return;
        if (collapsedTreeNodeIds.has(node._uiId)) return;
        if (isNodeUnderCollapsedAncestor(root, node._uiId)) return;
        if (typeof node.support !== "number" || Number.isNaN(node.support)) return;
        if (node.support < minSupport) return;

        const x = (node._xDraw ?? node.x) + 4;
        const y = node.y - 10;

        ctx.save();
        ctx.fillStyle = "#93c5fd";
        ctx.fillText(String(node.support), x, y);
        ctx.restore();
      });
    }

    if (showScaleBar && scale && maxDist) {
      const scaleMode = treeViewState.scaleMode;
      const manualScaleVal = Number(treeViewState.manualScaleVal);

      let scaleBarVal;
      if (scaleMode === "math") {
        scaleBarVal = niceScaleStep(maxDist);
      } else if (scaleMode === "visual") {
        scaleBarVal = niceMegaScale(maxDist);
      } else {
        scaleBarVal =
          Number.isFinite(manualScaleVal) && manualScaleVal > 0
            ? manualScaleVal
            : niceScaleStep(maxDist);
      }

      if (scaleBarVal > 0) {
        const scaleBarPx = scaleBarVal * scale;
        const barX = leftMargin + rootTrunkPx + 8;
        const barY = canvasHeight - 18;

        ctx.beginPath();
        ctx.moveTo(barX, barY);
        ctx.lineTo(barX + scaleBarPx, barY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(barX, barY - 3);
        ctx.lineTo(barX, barY + 3);
        ctx.moveTo(barX + scaleBarPx, barY - 3);
        ctx.lineTo(barX + scaleBarPx, barY + 3);
        ctx.stroke();

        ctx.fillText(String(scaleBarVal), barX + scaleBarPx / 2 - 10, barY - 8);
      }
    }

    scaleManualInput.disabled = treeViewState.scaleMode !== "manual";
    btnExportSvg.onclick = () => {
      const svgMarkup = buildTreeSvg({
        root,
        allNodes,
        edges,
        canvasWidth,
        canvasHeight,
        leftMargin,
        rootTrunkPx,
        showScaleBar,
        scale,
        maxDist,
        selectedUiIds,
        visibleLeaves,
        showSupportValues: treeViewState.showSupportValues,
        supportMeta: lastTreeSupportMeta,
        supportMinDisplay: treeViewState.supportMinDisplay,
        footerLines: buildTreeExportFooterLines(lastTreeAnalysisResult)
      });

      svgDownload("tree_view.svg", svgMarkup);
    };
  }

  layoutSelect.addEventListener("change", () => {
    treeViewState.layout = layoutSelect.value;
    drawTree();
  });

  zoomInput.addEventListener("input", () => {
    treeViewState.zoom = parseInt(zoomInput.value, 10) || 100;
    updateZoomLabel();
    drawTree();
  });

  orderSelect.addEventListener("change", () => {
    treeViewState.leafOrder = orderSelect.value;
    requestTreeOrderSync();
    drawTree();
  });

  rootInput.addEventListener("change", () => {
    treeViewState.rootTrunkPx = parseInt(rootInput.value, 10) || 0;
    drawTree();
  });

  leafMinInput.addEventListener("change", () => {
    treeViewState.minLeafPx = parseInt(leafMinInput.value, 10) || 0;
    drawTree();
  });

  scaleModeSelect.addEventListener("change", () => {
    treeViewState.scaleMode = scaleModeSelect.value;
    drawTree();
  });

  scaleManualInput.addEventListener("change", () => {
    treeViewState.manualScaleVal = parseFloat(scaleManualInput.value) || 0.2;
    drawTree();
  });

    labelsToggleInput.addEventListener("change", () => {
    treeViewState.showLabels = labelsToggleInput.checked;
    drawTree();
  });

  branchLengthsToggleInput.addEventListener("change", () => {
    treeViewState.showBranchLengths = branchLengthsToggleInput.checked;
    drawTree();
  });

  supportToggleInput.addEventListener("change", () => {
    treeViewState.showSupportValues = supportToggleInput.checked;
    supportMinInput.disabled = !lastTreeSupportMeta?.present || !treeViewState.showSupportValues;
    supportMinInput.style.opacity = supportMinInput.disabled ? "0.5" : "1";
    drawTree();
  });

  supportMinInput.addEventListener("change", () => {
    const parsed = parseInt(supportMinInput.value, 10);
    treeViewState.supportMinDisplay = Number.isFinite(parsed)
      ? Math.max(0, Math.min(100, parsed))
      : 0;
    supportMinInput.value = String(treeViewState.supportMinDisplay);
    drawTree();
  });

  btnClearSelection.addEventListener("click", () => {
    selectedTreeNodeId = null;
    renderTreeCanvas(currentTreeObj, lastTreeResultText);
  });

  const supportAvailable = !!lastTreeSupportMeta?.present;

  supportToggleInput.disabled = !supportAvailable;
  supportToggleInput.style.opacity = supportToggleInput.disabled ? "0.5" : "1";

  supportMinInput.disabled = !supportAvailable || !treeViewState.showSupportValues;
  supportMinInput.style.opacity = supportMinInput.disabled ? "0.5" : "1";

  updateZoomLabel();
  drawTree();

  canvas.onclick = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;

    const nodeHit = treeNodeHitboxes.find((box) => {
      return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
    });

    if (nodeHit) {
      selectedTreeNodeId =
        selectedTreeNodeId === nodeHit.node._uiId ? null : nodeHit.node._uiId;
      renderTreeCanvas(currentTreeObj, lastTreeResultText);
      activeHistoryTarget = "tree";
      return;
    }

    const labelHit = treeLabelHitboxes.find((box) => {
      return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
    });

    if (labelHit) {
      selectedTreeNodeId =
        selectedTreeNodeId === labelHit.node._uiId ? null : labelHit.node._uiId;
      renderTreeCanvas(currentTreeObj, lastTreeResultText);
      activeHistoryTarget = "tree";
    }
  };

  canvas.ondblclick = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;

    const hit = treeLabelHitboxes.find((box) => {
      return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
    });

    if (!hit) return;

    const oldName = String(hit.node.name || "");

    const input = document.createElement("input");
    input.type = "text";
    input.value = oldName;
    input.className = "tree-viewer-rename-input";
    input.style.left = `${hit.x}px`;
    input.style.top = `${hit.y - 2}px`;

    const charWidth = 8;
    const contentWidth = Math.max(120, Math.min(320, (oldName.length + 2) * charWidth));
    input.style.width = `${contentWidth}px`;
    wrapper.appendChild(input);
    input.focus();
    input.select();

    let finished = false;

    function finish(commit) {
      if (finished) return;
      finished = true;

      if (commit) {
        const trimmed = input.value.trim();

        if (trimmed && trimmed !== oldName) {
          pushTreeUndoSnapshot();

          hit.node.name = trimmed;
          lastTreeResultText = treeToNewick(currentTreeObj);

          syncTreeLeafOrderFromCurrentTree();

          if (treeNewickOutput && currentTreeObj) {
            treeNewickOutput.value = prettyNewick(lastTreeResultText);
          }

          requestTreeOrderSync();
          renderTreeCanvas(currentTreeObj, lastTreeResultText);
        }
      }

      input.remove();
    }

    input.addEventListener("blur", () => finish(true));

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
  };

  updateTreeHistoryButtons();
}

function ensureTreeOrderButtons() {
  if (!msaDownloadArea) return;

  let btnUseFileOrder = document.getElementById("btn-use-file-order");
  let btnUseTreeOrder = document.getElementById("btn-use-tree-order");

  if (!btnUseFileOrder) {
    btnUseFileOrder = document.createElement("button");
    btnUseFileOrder.type = "button";
    btnUseFileOrder.id = "btn-use-file-order";
    btnUseFileOrder.className = "btn btn-tonal";
    btnUseFileOrder.textContent = "Use file order";
    btnUseFileOrder.style.display = "none";
    btnUseFileOrder.addEventListener("click", () => {
      if (!msaViewer) return;
      msaViewer.setOrderMode("file");
      activeHistoryTarget = "msa";
    });
    msaDownloadArea.appendChild(btnUseFileOrder);
  }

  if (!btnUseTreeOrder) {
    btnUseTreeOrder = document.createElement("button");
    btnUseTreeOrder.type = "button";
    btnUseTreeOrder.id = "btn-use-tree-order";
    btnUseTreeOrder.className = "btn btn-tonal";
    btnUseTreeOrder.textContent = "Use tree order";
    btnUseTreeOrder.style.display = "none";
    btnUseTreeOrder.addEventListener("click", () => {
      if (!msaViewer) return;
      if (!lastTreeLeafOrder.length) return;
      msaViewer.setTreeLeafOrder(lastTreeLeafOrder);
      msaViewer.setOrderMode("tree");
      activeHistoryTarget = "msa";
    });
    msaDownloadArea.appendChild(btnUseTreeOrder);
  }

  treeOrderButtonsMounted = true;
}

function renderTreeResult(resultPayloadOrText) {
  const normalizedResult = normalizeTreeResultPayload(resultPayloadOrText);
  lastTreeAnalysisResult = normalizedResult;
  lastTreeSupportMeta = normalizedResult?.result?.tree?.support || null;

  const rawNewick = normalizedResult?.result?.tree?.raw_newick || "";
  lastTreeResultText = rawNewick || "";

  if (!lastTreeSupportMeta?.present) {
    treeViewState.showSupportValues = false;
    treeViewState.supportMinDisplay = 0;
  }

  renderTreeAnalysisSummary(normalizedResult);

  if (treeNewickOutput) {
    treeNewickOutput.value = prettyNewick(lastTreeResultText);
  }

  lastTreeLeafOrder = [];

  if (!lastTreeResultText) {
    clearTreeResultOverview();
    if (treeContainer) treeContainer.innerHTML = "";
    if (treeDownloadArea) treeDownloadArea.style.display = "none";
    refreshMsaToolbar();
    return;
  }

  try {
    let root = parseNewickTree(lastTreeResultText);
    root = normalizeTreeRoot(root);
    annotateTreeSourceNames(root);
    assignTreeUiIds(root);

    const leaves = [];
    collectLeaves(root, leaves);
    lastTreeLeafOrder = leaves
      .map((leaf) => String(leaf._sourceName || leaf.name || "").trim())
      .filter(Boolean);

    originalTreeObj = cloneTreeNode(root);

    resetTreeHistory();
    requestTreeOrderSync({ forceTreeMode: true });
    renderTreeCanvas(root, lastTreeResultText);

  } catch (err) {
    console.error("Tree parse/render error:", err);

    if (treeContainer) {
      treeContainer.innerHTML = "";
      const pre = document.createElement("pre");
      pre.textContent = "Tree parse/render error: " + err.message;
      treeContainer.appendChild(pre);
    }
  }

  ensureTreeOrderButtons();

  if (treeDownloadArea) {
    treeDownloadArea.style.display = "flex";
  }

  refreshMsaToolbar();
  activeHistoryTarget = "tree";
}

btnMsaDownload?.addEventListener("click", () => {
  if (window.MsaViewer && msaViewer) {
    msaViewer.download();
    return;
  }

  if (!lastMsaResultText) return;
  const blob = new Blob([lastMsaResultText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "msa_result.fasta";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

btnTreeDownload?.addEventListener("click", () => {
  const textToDownload = currentTreeObj
    ? treeToNewick(currentTreeObj)
    : lastTreeResultText;

  if (!textToDownload) return;

  const blob = new Blob([textToDownload], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tree_result.nwk";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});


function setJobStatus(message, type = "info", position = "") {
  if (!statusCard || !statusText || !positionText) return;
  statusCard.style.display = "block";
  statusText.className = `status ${type}`;
  statusText.textContent = message;
  positionText.textContent = position || "";
}

function setCancelJobButtonVisible(visible, jobId = "") {
  if (!jobCancelArea || !btnCancelJob) return;

  jobCancelArea.style.display = visible ? "flex" : "none";
  btnCancelJob.dataset.jobId = jobId || "";
  btnCancelJob.disabled = !visible;
  btnCancelJob.textContent = "Cancel job";
  btnCancelJob.style.opacity = visible ? "1" : "0.6";
  btnCancelJob.style.cursor = visible ? "pointer" : "not-allowed";
}

async function cancelQueuedJob(jobId) {
  const resp = await fetch(`/api/jobs/${jobId}/cancel`, {
    method: "POST",
    cache: "no-store"
  });

  if (!resp.ok) {
    let message = `Cancel failed. HTTP ${resp.status}`;

    try {
      const payload = await resp.json();
      if (payload?.detail) {
        message = payload.detail;
      }
    } catch (_err) {
      // Keep fallback message.
    }

    throw new Error(message);
  }

  return await resp.json();
}

btnCancelJob?.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();

  const jobId = btnCancelJob.dataset.jobId || taskRunState.jobId;
  if (!jobId) return;

  btnCancelJob.disabled = true;
  btnCancelJob.textContent = "Cancelling...";
  btnCancelJob.style.opacity = "0.6";
  btnCancelJob.style.cursor = "not-allowed";

  try {
    await cancelQueuedJob(jobId);

    setJobStatus("Task was cancelled.", "info");
    setMsaLoader(false);
    setTreeLoader(false);
    setCancelJobButtonVisible(false);
  } catch (err) {
    console.error("Cancel job failed:", err);

    setJobStatus(err.message || "Cancel failed.", "error");
    setCancelJobButtonVisible(true, jobId);
  }
});

function refreshMsaToolbar() {
  const btnUseFileOrder = document.getElementById("btn-use-file-order");
  const btnUseTreeOrder = document.getElementById("btn-use-tree-order");

  const hasMsa = !!lastMsaResultText;
  const hasTree = !!lastTreeResultText;
  const hasTreeOrder = Array.isArray(lastTreeLeafOrder) && lastTreeLeafOrder.length > 0;

  if (btnMsaDownload) {
    btnMsaDownload.style.display = hasMsa ? "inline-flex" : "none";
  }

  if (btnUseFileOrder) {
    btnUseFileOrder.style.display = hasMsa && hasTree ? "inline-flex" : "none";
  }

  if (btnUseTreeOrder) {
    btnUseTreeOrder.style.display = hasMsa && hasTree && hasTreeOrder ? "inline-flex" : "none";
  }

  if (msaDownloadArea) {
    msaDownloadArea.style.display = (hasMsa || (hasTree && hasTreeOrder)) ? "flex" : "none";
  }
}

function collectOptions() {
  const quality_threshold = document.getElementById("quality-threshold")?.value || "20";
  const position_expr = document.getElementById("position-expr")?.value || "";
  const mode = form.querySelector('input[name="mode"]:checked')?.value || "gap";
  const engine = form.querySelector('input[name="engine"]:checked')?.value || "muscle";

  const tree_method = treeMethodSelect?.value || "ml";
  const tree_preset = treePresetSelect?.value || "balanced";
  const tree_distance_model = treeDistanceModelSelect?.value || "identity";
  const tree_substitution_model = treeSubstitutionModelSelect?.value || "AUTO";
  const tree_support_type = treeSupportTypeSelect?.value || "none";
  const tree_support_replicates = treeSupportReplicatesInput?.value || "0";

  return {
    quality_threshold,
    position_expr,
    mode,
    engine,
    tree_method,
    tree_preset,
    tree_distance_model,
    tree_substitution_model,
    tree_support_type,
    tree_support_replicates
  };
}

function refreshTreeAnalysisControls() {
  const method = treeMethodSelect?.value || "ml";
  const supportType = treeSupportTypeSelect?.value || "none";
  const isDistanceMethod = method === "nj" || method === "upgma";

  if (treeDistanceModelSelect) {
    treeDistanceModelSelect.disabled = !isDistanceMethod;
  }

  if (treeSubstitutionModelSelect) {
    treeSubstitutionModelSelect.disabled = isDistanceMethod;
  }

  if (treeSupportTypeSelect) {
    if (isDistanceMethod) {
      treeSupportTypeSelect.value = "none";
      treeSupportTypeSelect.disabled = true;
    } else {
      treeSupportTypeSelect.disabled = false;
    }
  }

  if (treeSupportReplicatesInput) {
    const nextSupportType = treeSupportTypeSelect?.value || "none";
    treeSupportReplicatesInput.disabled = isDistanceMethod || nextSupportType === "none";
  }
}

function buildTreeJobPayload(options) {
  const supportType = options.tree_support_type || "none";
  const supportEnabled = supportType !== "none";
  const supportReplicates = Number(options.tree_support_replicates || 0);

  return {
    task_type: "tree",
    input: {
      fasta_text: browserPreprocessedState.fasta_text,
      source_type: "ab1_preprocessed_fasta"
    },
    alignment: {
      engine: options.engine
    },
    analysis: {
      method: options.tree_method || "ml",
      preset: options.tree_preset || "balanced",
      distance_model: options.tree_distance_model || "identity",
      substitution_model: options.tree_substitution_model || "AUTO",
      support: {
        enabled: supportEnabled,
        type: supportType,
        replicates: supportReplicates
      }
    },
    view_defaults: {
      preferred_layout: treeViewState.layout,
      show_support: treeViewState.showSupportValues,
      show_branch_lengths: treeViewState.showBranchLengths
    },
    client_context: {
      app_module: "tree",
      schema_expectation: "1.0"
    }
  };
}

async function readJobResult(jobId, taskType) {
  const resp = await fetch(`/api/jobs/${jobId}/result`, {
    cache: "no-store"
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch result. HTTP ${resp.status}`);
  }

  const contentType = resp.headers.get("content-type") || "";

  if (taskType === "tree" || contentType.includes("application/json")) {
    return await resp.json();
  }

  return await resp.text();
}

function normalizeTreeResultPayload(resultPayloadOrText) {
  if (typeof resultPayloadOrText === "string") {
    return {
      job_id: null,
      status: "completed",
      schema_version: "legacy-text",
      result: {
        analysis_id: null,
        analysis_summary: null,
        tree: {
          raw_newick: resultPayloadOrText,
          format: "newick",
          rooting: {
            analysis_rooting: "unknown",
            viewer_rooting: null
          },
          support: {
            present: false,
            type: "none",
            label_mode: null,
            range: null
          }
        },
        artifacts: {},
        warnings: [],
        provenance: {}
      },
      error: ""
    };
  }

  return resultPayloadOrText || {
    job_id: null,
    status: "completed",
    schema_version: "empty",
    result: {
      analysis_id: null,
      analysis_summary: null,
      tree: {
        raw_newick: "",
        format: "newick",
        rooting: {
          analysis_rooting: "unknown",
          viewer_rooting: null
        },
        support: {
          present: false,
          type: "none",
          label_mode: null,
          range: null
        }
      },
      artifacts: {},
      warnings: [],
      provenance: {}
    },
    error: ""
  };
}

function renderTreeAnalysisSummary(resultPayload) {
  const analysis = resultPayload?.result?.analysis_summary || null;
  const support = resultPayload?.result?.tree?.support || null;
  const provenance = resultPayload?.result?.provenance || {};
  const inputSummary = resultPayload?.result?.input_summary || {};
  const warnings = Array.isArray(resultPayload?.result?.warnings)
    ? resultPayload.result.warnings
    : [];

  if (!analysis) {
    clearTreeResultOverview();
    return;
  }

  if (treeResultOverview) {
    treeResultOverview.hidden = false;
  }

  if (treeResultBadges) {
    treeResultBadges.innerHTML = "";
  }
  if (treeAnalysisMetrics) {
    treeAnalysisMetrics.innerHTML = "";
  }
  if (treeAnalysisWarningsList) {
    treeAnalysisWarningsList.innerHTML = "";
  }
  if (treeAnalysisWarnings) {
    treeAnalysisWarnings.hidden = true;
  }

  const method = String(analysis.method || "-").toUpperCase();
  const runtime =
    typeof provenance.runtime_seconds === "number"
      ? `${provenance.runtime_seconds}s`
      : null;

  const supportText = support?.present
    ? `${support.type || "support"} (${analysis.support_replicates || 0})`
    : "none";

  const modelText =
    method === "ML"
      ? (analysis.substitution_model || null)
      : (analysis.distance_model || null);

  const modelLabel =
    method === "ML"
      ? "Model"
      : "Distance";

  if (treeResultBadges) {
    const completionBadge = warnings.length
      ? createTreeResultBadge("Completed with warnings", true)
      : createTreeResultBadge("Completed", false);

    completionBadge.classList.add(warnings.length ? "is-warning" : "is-success");

    treeResultBadges.appendChild(completionBadge);
    treeResultBadges.appendChild(createTreeResultBadge(`Method: ${method}`));
    treeResultBadges.appendChild(createTreeResultBadge(`Support: ${supportText}`));
    treeResultBadges.appendChild(createTreeResultBadge(`Engine: ${analysis.alignment_engine || "-"}`));

    if (warnings.length) {
      const highestSeverity = warnings
        .map(classifyTreeWarning)
        .includes("high")
        ? "high"
        : warnings.map(classifyTreeWarning).includes("medium")
          ? "medium"
          : "low";

      const severityBadge = createTreeResultBadge(
        `${warnings.length} warning(s)`,
        true
      );

      if (highestSeverity === "high") {
        severityBadge.classList.add("is-danger");
      } else if (highestSeverity === "medium") {
        severityBadge.classList.add("is-warning");
      } else {
        severityBadge.classList.add("is-info");
      }

      treeResultBadges.appendChild(severityBadge);
    }
  }

  if (treeAnalysisSummary) {
    const summaryParts = [
      `Preset: ${analysis.preset || "-"}`,
      provenance.engine_name ? `Tree engine: ${provenance.engine_name}` : null,
      modelText ? `${modelLabel}: ${modelText}` : null,
      runtime ? `Runtime: ${runtime}` : null
    ].filter(Boolean);

    treeAnalysisSummary.textContent = summaryParts.join("  •  ");
  }

  appendTreeMetric("Sequences", inputSummary.sequence_count);
  appendTreeMetric("Aligned length", inputSummary.aligned_length);
  appendTreeMetric("Unique sequences", inputSummary.unique_sequence_count);
  appendTreeMetric("Variable sites", inputSummary.variable_site_count);
  appendTreeMetric("Gap fraction", formatGapFraction(inputSummary.gap_fraction));

  if (warnings.length && treeAnalysisWarnings && treeAnalysisWarningsList) {
    treeAnalysisWarnings.hidden = false;

    warnings.forEach((warningText) => {
      const severity = classifyTreeWarning(warningText);

      const li = document.createElement("li");
      li.className = `tree-result-warning-item is-${severity}`;

      const prefix = document.createElement("span");
      prefix.className = "tree-result-warning-prefix";
      prefix.textContent = `[${formatWarningSeverityLabel(severity)}]`;

      const text = document.createElement("span");
      text.textContent = ` ${warningText}`;

      li.appendChild(prefix);
      li.appendChild(text);
      treeAnalysisWarningsList.appendChild(li);
    });
  }

   renderTreeArtifacts(resultPayload);
}

function clearTreeResultOverview() {
  if (treeResultOverview) {
    treeResultOverview.hidden = true;
  }

  if (treeResultBadges) {
    treeResultBadges.innerHTML = "";
  }

  if (treeAnalysisSummary) {
    treeAnalysisSummary.textContent = "";
  }

  if (treeAnalysisMetrics) {
    treeAnalysisMetrics.innerHTML = "";
  }

  if (treeAnalysisWarnings) {
    treeAnalysisWarnings.hidden = true;
  }

  if (treeAnalysisWarningsList) {
    treeAnalysisWarningsList.innerHTML = "";
  }

  if (treeAnalysisArtifacts) {
    treeAnalysisArtifacts.hidden = true;
    treeAnalysisArtifacts.innerHTML = "";
  }
}

function createTreeResultBadge(text, isWarning = false) {
  const badge = document.createElement("span");
  badge.className = isWarning
    ? "tree-result-badge is-warning"
    : "tree-result-badge";
  badge.textContent = text;
  return badge;
}

function appendTreeMetric(label, value) {
  if (!treeAnalysisMetrics) return;
  if (value === null || typeof value === "undefined" || value === "") return;

  const item = document.createElement("div");
  item.className = "tree-result-metric";

  const labelEl = document.createElement("span");
  labelEl.className = "tree-result-metric-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "tree-result-metric-value";
  valueEl.textContent = String(value);

  item.appendChild(labelEl);
  item.appendChild(valueEl);
  treeAnalysisMetrics.appendChild(item);
}

function formatGapFraction(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return `${(value * 100).toFixed(1)}%`;
}

function downloadTextFile(filename, text, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([String(text || "")], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function downloadJsonFile(filename, data) {
  const text = JSON.stringify(data || {}, null, 2);
  downloadTextFile(filename, text, "application/json;charset=utf-8");
}

function normalizeArtifactText(value) {
  if (value === null || typeof value === "undefined") return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function classifyTreeWarning(warningText) {
  const text = String(warningText || "").toLowerCase();

  if (
    text.includes("high gap") ||
    text.includes("very low sequence divergence") ||
    text.includes("short alignment") ||
    text.includes("tanımsız") ||
    text.includes("undefined")
  ) {
    return "high";
  }

  if (
    text.includes("low sequence count") ||
    text.includes("identical sequences") ||
    text.includes("redundant") ||
    text.includes("ultrametric")
  ) {
    return "medium";
  }

  return "low";
}

function formatWarningSeverityLabel(severity) {
  if (severity === "high") return "High";
  if (severity === "medium") return "Medium";
  return "Low";
}

function createArtifactButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tree-result-artifact-btn";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function buildTreeAnalysisReport(resultPayload) {
  const result = resultPayload?.result || {};
  const analysis = result.analysis_summary || {};
  const input = result.input_summary || {};
  const support = result.tree?.support || {};
  const provenance = result.provenance || {};
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const artifacts = result.artifacts || {};

  const method = analysis.method
    ? String(analysis.method).toUpperCase()
    : "-";

  const lines = [];

  lines.push("Nucleomic Tree Analysis Report");
  lines.push("================================");
  lines.push("");

  lines.push("Analysis");
  lines.push("--------");
  lines.push(`Method: ${method}`);
  lines.push(`Preset: ${analysis.preset || "-"}`);
  lines.push(`Alignment engine: ${analysis.alignment_engine || "-"}`);
  lines.push(`Tree engine: ${provenance.engine_name || "-"}`);

  if (method === "ML") {
    lines.push(`Substitution model: ${analysis.substitution_model || "-"}`);
  }

  if (method === "NJ" || method === "UPGMA") {
    lines.push(`Distance model: ${analysis.distance_model || "-"}`);
  }

  lines.push(
    support.present
      ? `Support: ${support.type || "support"} (${analysis.support_replicates || 0})`
      : "Support: none"
  );

  if (typeof provenance.runtime_seconds === "number") {
    lines.push(`Runtime: ${provenance.runtime_seconds}s`);
  }

  lines.push("");

  lines.push("Input summary");
  lines.push("-------------");
  lines.push(`Sequence count: ${input.sequence_count ?? "-"}`);
  lines.push(`Aligned length: ${input.aligned_length ?? "-"}`);
  lines.push(`Unique sequence count: ${input.unique_sequence_count ?? "-"}`);
  lines.push(`Variable sites: ${input.variable_site_count ?? "-"}`);
  lines.push(`Constant sites: ${input.constant_site_count ?? "-"}`);

  if (typeof input.gap_fraction === "number") {
    lines.push(`Gap fraction: ${(input.gap_fraction * 100).toFixed(1)}%`);
  } else {
    lines.push("Gap fraction: -");
  }

  if (Array.isArray(input.identical_sequence_groups) && input.identical_sequence_groups.length) {
    lines.push("");
    lines.push("Identical sequence groups:");
    input.identical_sequence_groups.forEach((group, index) => {
      lines.push(`  ${index + 1}. ${group.join(", ")}`);
    });
  }

  lines.push("");

  lines.push("Warnings");
  lines.push("--------");
  if (warnings.length) {
    warnings.forEach((warning, index) => {
      const severity = classifyTreeWarning(warning);
      lines.push(`${index + 1}. [${formatWarningSeverityLabel(severity)}] ${warning}`);
    });
  } else {
    lines.push("None");
  }

  lines.push("");

  lines.push("Artifacts");
  lines.push("---------");
  lines.push(`Newick present: ${result.tree?.raw_newick ? "yes" : "no"}`);
  lines.push(`IQ-TREE report available: ${artifacts.iqtree_report_available ? "yes" : "no"}`);
  lines.push(`IQ-TREE log redacted: ${artifacts.iqtree_log_redacted ? "yes" : "no"}`);

  if (Array.isArray(artifacts.safe_command) && artifacts.safe_command.length) {
    lines.push("");
    lines.push("Safe command summary:");
    lines.push(artifacts.safe_command.join(" "));
  }

  lines.push("");

  lines.push("Newick");
  lines.push("------");
  lines.push(result.tree?.raw_newick || "");

  lines.push("");

  return lines.join("\n");
}

function renderTreeArtifacts(resultPayload) {
  if (!treeAnalysisArtifacts) return;

  treeAnalysisArtifacts.innerHTML = "";

  const result = resultPayload?.result || {};
  const artifacts = result.artifacts || {};
  const rawNewick = result.tree?.raw_newick || "";

  const hasAnyArtifact =
    !!resultPayload ||
    !!rawNewick ||
    !!artifacts.iqtree_report ||
    !!artifacts.iqtree_log;

  if (!hasAnyArtifact) {
    treeAnalysisArtifacts.hidden = true;
    return;
  }

  treeAnalysisArtifacts.hidden = false;

  treeAnalysisArtifacts.appendChild(
    createArtifactButton("Download analysis JSON", () => {
      downloadJsonFile("tree_analysis_result.json", resultPayload);
    })
  );

  treeAnalysisArtifacts.appendChild(
    createArtifactButton("Download analysis report", () => {
      const report = buildTreeAnalysisReport(resultPayload);
      downloadTextFile("tree_analysis_report.txt", report);
    })
  );

  if (rawNewick) {
    treeAnalysisArtifacts.appendChild(
      createArtifactButton("Download Newick", () => {
        downloadTextFile("tree_result.nwk", rawNewick);
      })
    );
  }

}

function buildTreeExportFooterLines(resultPayload) {
  const analysis = resultPayload?.result?.analysis_summary || null;
  const support = resultPayload?.result?.tree?.support || null;

  if (!analysis) return [];

  const method = analysis.method
    ? String(analysis.method).toUpperCase()
    : "-";

  const alignmentEngine = analysis.alignment_engine || "-";
  const distanceModel = analysis.distance_model || null;
  const substitutionModel = analysis.substitution_model || null;

  let supportText = "Support: none";
  if (support?.present) {
    const supportType = support.type || "support";
    const reps = analysis.support_replicates || 0;
    supportText = `Support: ${supportType} (${reps})`;
  }

  const parts = [
    `Method: ${method}`,
    supportText
  ];

  if ((method === "NJ" || method === "UPGMA") && distanceModel) {
    parts.push(`Distance: ${distanceModel}`);
  }

  if (method === "ML" && substitutionModel) {
    parts.push(`Model: ${substitutionModel}`);
  }

  parts.push(`Alignment: ${alignmentEngine}`);

  return [parts.join(" • ")];
}

function updateSelectedFilesUI(files) {
  const list = Array.from(files || []);
  if (!list.length) {
    if (fileListDiv) fileListDiv.textContent = "No files selected.";
    if (filePickerHint) filePickerHint.textContent = "No files selected.";
    if (fileListWrapper) fileListWrapper.classList.remove("is-open");
    if (btnToggleFiles) btnToggleFiles.style.display = "none";
    if (btnToggleUpload) btnToggleUpload.style.display = "none";
    if (uploadCard) uploadCard.classList.remove("collapsed");
    isFileListOpen = false;
    isUploadCollapsed = false;
    lastFileOrder = [];
    return;
  }

  if (fileListDiv) {
    fileListDiv.textContent = list.map(f => `- ${f.name}`).join("\n");
  }

  if (filePickerHint) {
    filePickerHint.textContent = list.length === 1
      ? "1 file selected"
      : `${list.length} files selected`;
  }

  lastFileOrder = list.map(f => f.name);

  if (btnToggleFiles) {
    btnToggleFiles.style.display = "inline-flex";
    btnToggleFiles.textContent = "Show file list";
  }

  if (btnToggleUpload) {
    btnToggleUpload.style.display = "inline-flex";
    btnToggleUpload.textContent = "Hide panel";
  }

  if (fileListWrapper) fileListWrapper.classList.remove("is-open");
  if (uploadCard) uploadCard.classList.remove("collapsed");

  isFileListOpen = false;
  isUploadCollapsed = false;
}

function applyFilesToInput(files) {
  const dt = new DataTransfer();
  files.forEach(f => dt.items.add(f));
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event("change"));
}

function bindUploadUI() {
  if (fileInput) {
  fileInput.addEventListener("change", () => {
    console.log("file change fired:", fileInput.files.length, fileInput.files);
    updateSelectedFilesUI(fileInput.files);
    browserPreprocessedState = { results: [], fasta_text: "" };
  });
  }


  if (btnToggleFiles && fileListWrapper) {
    btnToggleFiles.addEventListener("click", () => {
      isFileListOpen = !isFileListOpen;
      fileListWrapper.classList.toggle("is-open", isFileListOpen);
      btnToggleFiles.textContent = isFileListOpen ? "Hide file list" : "Show file list";
    });
  }

  if (btnToggleUpload && uploadCard) {
    btnToggleUpload.addEventListener("click", () => {
      isUploadCollapsed = !isUploadCollapsed;
      uploadCard.classList.toggle("collapsed", isUploadCollapsed);
      btnToggleUpload.textContent = isUploadCollapsed ? "Show panel" : "Hide panel";
    });
  }

  if (dropZone) {
    const setActive = (on) => {
      dropZone.classList.toggle("is-dragover", on);
    };

    ["dragenter", "dragover"].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        setActive(true);
      });
    });

    ["dragleave", "dragend"].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        setActive(false);
      });
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setActive(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      applyFilesToInput(files);
    });

    dropZone.addEventListener("click", () => {
      if (fileInput) fileInput.click();
    });
  }
}

async function buildFastaOnServer() {
  const files = Array.from(fileInput.files || []);
  if (!files.length) {
    throw new Error("Please select at least one .ab1 file first.");
  }

  const options = collectOptions();
  const fd = new FormData();

  for (const f of files) {
    fd.append("files", f);
  }
  fd.append("quality_threshold", options.quality_threshold);
  fd.append("mode", options.mode);
  fd.append("position_expr", options.position_expr);

  const resp = await fetch("/api/process_ab1_fasta", {
    method: "POST",
    body: fd
  });

  if (!resp.ok) {
    throw new Error(`Failed to generate FASTA. HTTP ${resp.status}`);
  }

  const fastaText = await resp.text();
  return {
    results: [],
    fasta_text: fastaText
  };
}

async function streamJob(jobId, onUpdate, onDisconnect) {
  let finished = false;

  while (!finished) {
    try {
      const resp = await fetch(`/api/jobs/${jobId}`, {
        cache: "no-store"
      });

      if (!resp.ok) {
        throw new Error(`Status HTTP ${resp.status}`);
      }

      const payload = await resp.json();
      await onUpdate(payload);

      if (payload.status === "completed" || payload.status === "failed" || payload.status === "cancelled") {
        finished = true;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (err) {
      console.error("streamJob/poll error:", err);
      if (onDisconnect) onDisconnect(err);
      break;
    }
  }
}

async function runQueuedTask(taskType) {
  if (taskRunState.active) {
    const activeLabel = taskRunState.type === "tree" ? "Tree" : "MSA";
    setJobStatus(
      `A new task cannot be started before the ${activeLabel} task finishes.`,
      "info"
    );
    return;
  }

  const lockResult = acquireTaskLock(taskType);

  if (!lockResult.ok) {
    const activeType = lockResult.lock?.taskType === "tree" ? "Tree" : "MSA";
    setJobStatus(
      `Another ${activeType} task is already active in another tab. Please wait until it finishes.`,
      "info"
    );
    return;
  }

  taskRunState.active = true;
  taskRunState.type = taskType;
  taskRunState.jobId = null;
  setCancelJobButtonVisible(false);
  setTaskButtonsDisabled(true);

  try {
    const options = collectOptions();

    if (!browserPreprocessedState.fasta_text) {
      setJobStatus("AB1 preprocessing is running on the server...", "info");
      browserPreprocessedState = await buildFastaOnServer();
      setJobStatus("Server preprocessing completed.", "success");
    }

    if (taskType === "tree") {
      setTreeLoader(true, "Preparing files for the server queue...");
    } else {
      setMsaLoader(true, "Preparing files for the server queue...");
    }
    setJobStatus("Sending to the server queue...", "info");

    const jobPayload = taskType === "tree"
      ? buildTreeJobPayload(options)
      : {
          task_type: taskType,
          engine: options.engine,
          fasta_text: browserPreprocessedState.fasta_text
        };

    const job = await createServerJob(jobPayload);

    const currentJobId = job.job_id;
    taskRunState.jobId = currentJobId;
    refreshTaskLock(currentJobId);
    console.log("create job response:", job);

    setCancelJobButtonVisible(true, currentJobId);
    setJobStatus("Task has been queued.", "info", `Queue position: ${job.position ?? "-"}`);

    await streamJob(
      currentJobId,
      async (payload) => {
        refreshTaskLock(currentJobId);
        console.log("poll payload:", payload);

        if (payload.status === "queued") {
          setCancelJobButtonVisible(true, currentJobId);
          setJobStatus("Task is waiting in queue.", "info", `Queue position: ${payload.position ?? "-"}`);

          if (taskType === "tree") {
            setTreeLoader(true, "Waiting in queue...");
          } else {
            setMsaLoader(true, "Waiting in queue...");
          }
        } else if (payload.status === "running") {
          setCancelJobButtonVisible(false);
          setJobStatus("Analysis in progress.", "info");

          if (taskType === "tree") {
            setTreeLoader(true, "Running tree analysis...");
          } else {
            setMsaLoader(true, "Running MSA...");
          }
        } else if (payload.status === "completed") {
          setCancelJobButtonVisible(false);
          setJobStatus("Result is ready.", "success");
          setMsaLoader(false);
          setTreeLoader(false);

          const resultPayload = await readJobResult(currentJobId, taskType);

          if (taskType === "tree") {
            renderTreeResult(resultPayload);
          } else {
            renderMsaResult(resultPayload);
          }
        } else if (payload.status === "failed") {
          setCancelJobButtonVisible(false);
          setJobStatus(`Error: ${payload.error || "Unknown error. Please contact us."}`, "error");
          setMsaLoader(false);
          setTreeLoader(false);
        } else if (payload.status === "cancelled") {
          setCancelJobButtonVisible(false);
          setJobStatus("Task was cancelled.", "info");
          setMsaLoader(false);
          setTreeLoader(false);
        }
      },
      () => {
        setCancelJobButtonVisible(false);
        setJobStatus("Live status connection was lost.", "error");
        setMsaLoader(false);
        setTreeLoader(false);
      }
    );
  } finally {
    releaseTaskLock();
    taskRunState.active = false;
    taskRunState.type = null;
    taskRunState.jobId = null;
    setCancelJobButtonVisible(false);
    setTaskButtonsDisabled(false);
  }
}

btnMsaShow?.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  try {
    await runQueuedTask("msa");
  } catch (err) {
    setJobStatus(err.message, "error");
    console.error(err);
  }
});

btnTreeShow?.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  try {
    await runQueuedTask("tree");
  } catch (err) {
    setJobStatus(err.message, "error");
    console.error(err);
  }
});

bindUploadUI();
form?.addEventListener("submit", (e) => {
  e.preventDefault();
});
treeMethodSelect?.addEventListener("change", refreshTreeAnalysisControls);
treeSupportTypeSelect?.addEventListener("change", refreshTreeAnalysisControls);
refreshTreeAnalysisControls();
updateSelectedFilesUI(fileInput?.files || []);
refreshMsaToolbar();

document.addEventListener("keydown", (ev) => {
  const tag = (ev.target?.tagName || "").toLowerCase();
  const isTypingTarget =
    tag === "input" ||
    tag === "textarea" ||
    ev.target?.isContentEditable;

  if (isTypingTarget) return;

  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const metaKey = isMac ? ev.metaKey : ev.ctrlKey;

  if (!metaKey) return;

  const key = ev.key.toLowerCase();
  const wantsUndo = key === "z" && !ev.shiftKey;
  const wantsRedo = (key === "z" && ev.shiftKey) || key === "y";

  if (!wantsUndo && !wantsRedo) return;

  if (activeHistoryTarget === "tree") {
    ev.preventDefault();

    if (wantsUndo) {
      performTreeUndo();
    } else {
      performTreeRedo();
    }
    return;
  }

  if (activeHistoryTarget === "msa") {
    ev.preventDefault();

    if (wantsUndo) {
      msaViewer?.undo?.();
    } else {
      msaViewer?.redo?.();
    }
  }
});

/* ===== How to use modal + step hint guide ===== */

(function () {
  const STORAGE_KEY = 'nucleomic-howto-dismissed';

  function initHowToModal() {
    const modal = document.getElementById('howto-modal');
    const closeBtn = document.getElementById('howto-close');
    const skipBtn = document.getElementById('howto-skip');
    const guideBtn = document.getElementById('howto-start-guide');
    const dontShowCheckbox = document.getElementById('howto-dont-show');
    const topbarGuideBtn = document.getElementById('howto-open-guide');

    const guidePopover = document.getElementById('guide-popover');
    const guideStepLabel = document.getElementById('guide-step-label');
    const guideTitle = document.getElementById('guide-title');
    const guideText = document.getElementById('guide-text');
    const guideNextBtn = document.getElementById('guide-next');
    const guideSkipBtn = document.getElementById('guide-skip');

    if (!modal) return;

    const backdrop = modal.querySelector('[data-howto-close="true"]');

    const guideSteps = [
      {
        targetId: 'drop-zone',
        title: 'Upload your AB1 files',
        text: 'Drag files here or click to choose them from your device.'
      },
      {
        targetId: 'guide-controls',
        title: 'Adjust quality and position',
        text: 'Set your quality threshold, mode, and optional positional filtering.'
      },
      {
        targetId: 'btn-msa-show',
        title: 'Run MSA',
        text: 'Start the alignment here and review the output after processing.'
      }
    ];

    let currentGuideIndex = 0;
    let activeGuideTarget = null;

    function savePreferenceIfNeeded() {
      if (dontShowCheckbox?.checked) {
        localStorage.setItem(STORAGE_KEY, 'true');
      }
    }

    function openModal() {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('howto-modal-open');
    }

    function closeModal() {
      savePreferenceIfNeeded();
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('howto-modal-open');
    }

    function clearGuideHighlight() {
      if (activeGuideTarget) {
        activeGuideTarget.classList.remove('guide-highlight');
        activeGuideTarget = null;
      }
    }

    function closeGuide() {
      clearGuideHighlight();

      if (guidePopover) {
        guidePopover.classList.add('hidden');
        guidePopover.setAttribute('aria-hidden', 'true');
        guidePopover.removeAttribute('data-side');
      }

      document.body.classList.remove('guide-open');
      currentGuideIndex = 0;
    }

    function positionGuidePopover(target) {
      if (!guidePopover || !target) return;

      const isMobile = window.innerWidth <= 560;
      if (isMobile) {
        guidePopover.removeAttribute('data-side');
        guidePopover.style.top = '';
        guidePopover.style.left = '';
        guidePopover.style.right = '';
        guidePopover.style.bottom = '';
        return;
      }

      const pad = 12;
      const gap = 14;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = target.getBoundingClientRect();

      guidePopover.classList.remove('hidden');
      guidePopover.style.visibility = 'hidden';
      guidePopover.style.left = '0px';
      guidePopover.style.top = '0px';

      const popW = guidePopover.offsetWidth || 320;
      const popH = guidePopover.offsetHeight || 180;

      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }

      const candidates = [
        {
          side: 'right',
          left: rect.right + gap,
          top: clamp(rect.top + (rect.height - popH) / 2, pad, vh - popH - pad)
        },
        {
          side: 'left',
          left: rect.left - popW - gap,
          top: clamp(rect.top + (rect.height - popH) / 2, pad, vh - popH - pad)
        },
        {
          side: 'bottom',
          left: clamp(rect.left + (rect.width - popW) / 2, pad, vw - popW - pad),
          top: rect.bottom + gap
        },
        {
          side: 'top',
          left: clamp(rect.left + (rect.width - popW) / 2, pad, vw - popW - pad),
          top: rect.top - popH - gap
        }
      ];

      const fit = candidates.find((c) => {
        return (
          c.left >= pad &&
          c.top >= pad &&
          c.left + popW <= vw - pad &&
          c.top + popH <= vh - pad
        );
      }) || {
        side: 'bottom',
        left: clamp(rect.left + (rect.width - popW) / 2, pad, vw - popW - pad),
        top: clamp(rect.bottom + gap, pad, vh - popH - pad)
      };

      guidePopover.dataset.side = fit.side;
      guidePopover.style.left = `${fit.left}px`;
      guidePopover.style.top = `${fit.top}px`;
      guidePopover.style.right = 'auto';
      guidePopover.style.bottom = 'auto';
      guidePopover.style.visibility = 'visible';
    }

    function showGuideStep(index) {
      const step = guideSteps[index];
      if (!step || !guidePopover) return;

      const target = document.getElementById(step.targetId);
      if (!target) return;

      clearGuideHighlight();
      activeGuideTarget = target;
      activeGuideTarget.classList.add('guide-highlight');

      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({
          behavior: 'smooth',
          block: window.innerWidth <= 560 ? 'center' : 'nearest'
        });
      }

      guideStepLabel.textContent = `Step ${index + 1} of ${guideSteps.length}`;
      guideTitle.textContent = step.title;
      guideText.textContent = step.text;
      guideNextBtn.textContent = index === guideSteps.length - 1 ? 'Done' : 'Next';

      guidePopover.classList.remove('hidden');
      guidePopover.setAttribute('aria-hidden', 'false');
      document.body.classList.add('guide-open');

      window.setTimeout(function () {
        positionGuidePopover(target);
      }, 220);
    }

    function startNucleomicGuide() {
      closeModal();
      closeGuide();
      currentGuideIndex = 0;
      showGuideStep(currentGuideIndex);
    }

    closeBtn?.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
    });

    skipBtn?.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
    });

    backdrop?.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
    });

    guideBtn?.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      startNucleomicGuide();
    });

    topbarGuideBtn?.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openModal();
    });

    guideNextBtn?.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();

      if (currentGuideIndex >= guideSteps.length - 1) {
        closeGuide();
        return;
      }

      currentGuideIndex += 1;
      showGuideStep(currentGuideIndex);
    });

    guideSkipBtn?.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      closeGuide();
    });

    window.addEventListener('resize', function () {
      if (activeGuideTarget && guidePopover && !guidePopover.classList.contains('hidden')) {
        positionGuidePopover(activeGuideTarget);
      }
    });

    window.addEventListener('scroll', function () {
      if (activeGuideTarget && guidePopover && !guidePopover.classList.contains('hidden')) {
        positionGuidePopover(activeGuideTarget);
      }
    }, { passive: true });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (!modal.classList.contains('hidden')) {
          closeModal();
          return;
        }

        if (guidePopover && !guidePopover.classList.contains('hidden')) {
          closeGuide();
        }
      }
    });

    if (localStorage.getItem(STORAGE_KEY) !== 'true') {
      window.setTimeout(openModal, 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHowToModal);
  } else {
    initHowToModal();
  }
})();