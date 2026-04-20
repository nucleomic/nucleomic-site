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

let isFileListOpen = false;
let isUploadCollapsed = false;
let lastFileOrder = [];
let lastMsaResultText = "";
let lastTreeResultText = "";
let lastTreeLeafOrder = [];
let treeOrderButtonsMounted = false;
let currentTreeObj = null;
let treeLabelHitboxes = [];
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
  manualScaleVal: 0.2
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
  type: null
};

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

function parseNewickTree(newick) {
  const s = String(newick || "").trim().replace(/;\s*$/, "");
  const ancestors = [];
  let tree = { children: [] };
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
        }
        break;

      case ",":
        {
          const sibling = { children: [] };
          const parent = ancestors[ancestors.length - 1];
          parent.children.push(sibling);
          tree = sibling;
        }
        break;

      case ")":
        tree = ancestors.pop();
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
        } else {
          tree.name = token;
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


function annotateTreeSourceNames(node) {
  if (!node) return;

  if (typeof node._sourceName === "undefined") {
    node._sourceName = node.name || "";
  }

  if (Array.isArray(node.children) && node.children.length) {
    node.children.forEach((child) => annotateTreeSourceNames(child));
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
    return `(${childrenStr})${n.name || ""}${lenStr}`;
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
  lastTreeResultText = treeToNewick(currentTreeObj);

  syncTreeLeafOrderFromCurrentTree();

  if (treeNewickOutput) {
    treeNewickOutput.value = prettyNewick(lastTreeResultText);
  }

  requestTreeOrderSync();
  renderTreeCanvas(currentTreeObj, lastTreeResultText);
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

  toolbar.appendChild(btnTreeUndo);
  toolbar.appendChild(btnTreeRedo);
  treeContainer.appendChild(toolbar);

  treeHistory.ui.btnUndo = btnTreeUndo;
  treeHistory.ui.btnRedo = btnTreeRedo;

  const title = document.createElement("div");
  title.className = "tree-viewer-title";
  title.textContent = "IQ-TREE view:";
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

  controls.appendChild(layoutLabel);
  controls.appendChild(zoomLabel);
  controls.appendChild(orderLabel);
  controls.appendChild(rootLabel);
  controls.appendChild(leafMinLabel);
  controls.appendChild(scaleModeLabel);
  controls.appendChild(scaleManualLabel);

  treeContainer.appendChild(controls);

  const wrapper = document.createElement("div");
  wrapper.className = "tree-viewer-surface";

  const canvas = document.createElement("canvas");
  canvas.className = "tree-viewer-canvas";
  wrapper.appendChild(canvas);
  treeContainer.appendChild(wrapper);

  const ctx = canvas.getContext("2d");

  currentTreeObj = root;

  function updateZoomLabel() {
    zoomValue.textContent = `${treeViewState.zoom}%`;
  }

  function drawTree() {
    treeLabelHitboxes = [];

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

    const leafCount = Math.max(countLeaves(root), 1);
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

    function drawBranches(node, parent = null) {
      if (!node.children || node.children.length === 0) return;

      const first = node.children[0];
      const last = node.children[node.children.length - 1];
      const nodeX = node._xDraw ?? node.x;

      ctx.beginPath();
      ctx.moveTo(nodeX, first.y);
      ctx.lineTo(nodeX, last.y);
      ctx.stroke();

      node.children.forEach((child) => {
        const childX = child._xDraw ?? child.x;

        ctx.beginPath();
        ctx.moveTo(nodeX, child.y);
        ctx.lineTo(childX, child.y);
        ctx.stroke();

        edges.push({
          parent: node,
          node: child
        });

        drawBranches(child, node);
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
      if (!node.children || node.children.length === 0) {
        const label = String(node.name || "");
        const x = (node._xDraw ?? node.x) + 6;
        const y = node.y;

        ctx.fillText(label, x, y);

        const width = ctx.measureText(label).width;
        const height = 14;

        treeLabelHitboxes.push({
          node,
          x,
          y: y - height / 2,
          w: width,
          h: height
        });

        visibleLeaves.push(node);
      }
    });

    visibleLeaves.sort((a, b) => a.y - b.y);

    const visibleLeafOrder = visibleLeaves
      .map((leaf) => String(leaf._sourceName || leaf.name || "").trim())
      .filter(Boolean);

    applyPendingTreeOrderSync(visibleLeafOrder);

    ctx.textBaseline = "alphabetic";

    edges.forEach((edge) => {
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

    ctx.textBaseline = "middle";

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

  updateZoomLabel();
  drawTree();

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
  if (treeOrderButtonsMounted || !msaDownloadArea) return;

  const btnUseFileOrder = document.createElement("button");
  btnUseFileOrder.type = "button";
  btnUseFileOrder.id = "btn-use-file-order";
  btnUseFileOrder.className = "btn btn-tonal";
  btnUseFileOrder.textContent = "Use file order";
  btnUseFileOrder.style.display = "none";
  btnUseFileOrder.addEventListener("click", () => {
    if (!msaViewer) return;
    msaViewer.setOrderMode("file");
  });

  const btnUseTreeOrder = document.createElement("button");
  btnUseTreeOrder.type = "button";
  btnUseFileOrder.id = "btn-use-file-order";
  btnUseTreeOrder.className = "btn btn-tonal";
  btnUseTreeOrder.textContent = "Use tree order";
  btnUseFileOrder.style.display = "none";
  btnUseTreeOrder.addEventListener("click", () => {
    if (!msaViewer) return;
    if (!lastTreeLeafOrder.length) return;
    msaViewer.setTreeLeafOrder(lastTreeLeafOrder);
    msaViewer.setOrderMode("tree");
  });

  msaDownloadArea.appendChild(btnUseFileOrder);
  msaDownloadArea.appendChild(btnUseTreeOrder);
  treeOrderButtonsMounted = true;
}

function renderTreeResult(text) {
  lastTreeResultText = text || "";

  if (treeNewickOutput) {
    treeNewickOutput.value = prettyNewick(lastTreeResultText);
  }

  lastTreeLeafOrder = [];

  if (!lastTreeResultText) {
    if (treeContainer) treeContainer.innerHTML = "";
    if (treeDownloadArea) treeDownloadArea.style.display = "none";
    refreshMsaToolbar();
    return;
  }

  try {
    let root = parseNewickTree(lastTreeResultText);
    root = normalizeTreeRoot(root);
    annotateTreeSourceNames(root);

    const leaves = [];
    collectLeaves(root, leaves);
    lastTreeLeafOrder = leaves
      .map((leaf) => String(leaf._sourceName || leaf.name || "").trim())
      .filter(Boolean);

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
  refreshMsaToolbar();

  if (treeDownloadArea) {
    treeDownloadArea.style.display = "flex";
  }

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

function refreshMsaToolbar() {
  const btnUseFileOrder = document.getElementById("btn-use-file-order");
  const btnUseTreeOrder = document.getElementById("btn-use-tree-order");

  const hasMsa = !!lastMsaResultText;
  const hasTree = !!lastTreeResultText;

  if (btnMsaDownload) {
    btnMsaDownload.style.display = hasMsa ? "inline-flex" : "none";
  }

  if (btnUseFileOrder) {
    btnUseFileOrder.style.display = hasTree ? "inline-flex" : "none";
  }

  if (btnUseTreeOrder) {
    btnUseTreeOrder.style.display = hasTree ? "inline-flex" : "none";
  }

  if (msaDownloadArea) {
    msaDownloadArea.style.display = (hasMsa || hasTree) ? "flex" : "none";
  }
}

function collectOptions() {
  const quality_threshold = document.getElementById("quality-threshold")?.value || "20";
  const position_expr = document.getElementById("position-expr")?.value || "";
  const mode = form.querySelector('input[name="mode"]:checked')?.value || "gap";
  const engine = form.querySelector('input[name="engine"]:checked')?.value || "muscle";

  return {
    quality_threshold,
    position_expr,
    mode,
    engine
  };
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

      if (payload.status === "completed" || payload.status === "failed") {
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

  taskRunState.active = true;
  taskRunState.type = taskType;
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

    const job = await createServerJob({
      task_type: taskType,
      engine: options.engine,
      fasta_text: browserPreprocessedState.fasta_text
    });

    const currentJobId = job.job_id;
    console.log("create job response:", job);

    setJobStatus("Task has been queued.", "info", `Queue position: ${job.position ?? "-"}`);

    await streamJob(
      currentJobId,
      async (payload) => {
        console.log("poll payload:", payload);

        if (payload.status === "queued") {
          setJobStatus("Task is waiting in queue.", "info", `Queue position: ${payload.position ?? "-"}`);
          if (taskType === "tree") {
            setTreeLoader(true, "Waiting in queue...");
          } else {
            setMsaLoader(true, "Waiting in queue...");
          }
        } else if (payload.status === "running") {
          setJobStatus("Analysis in progress.", "info");
          if (taskType === "tree") {
            setTreeLoader(true, "Running tree analysis...");
          } else {
            setMsaLoader(true, "Running MSA...");
          }
        } else if (payload.status === "completed") {
          setJobStatus("Result is ready.", "success");
          setMsaLoader(false);
          setTreeLoader(false);

          const resp = await fetch(`/api/jobs/${currentJobId}/result`, {
            cache: "no-store"
          });

          if (!resp.ok) {
            throw new Error(`Failed to fetch result. HTTP ${resp.status}`);
          }

          const text = await resp.text();

          if (taskType === "tree") {
            renderTreeResult(text);
          } else {
            renderMsaResult(text);
          }
        } else if (payload.status === "failed") {
          setJobStatus(`Hata: ${payload.error || "Unknown error. Please contact us."}`, "error");
          setMsaLoader(false);
          setTreeLoader(false);
        }
      },
      () => {
        setJobStatus("Live status connection was lost.", "error");
        setMsaLoader(false);
        setTreeLoader(false);
      }
    );
  } finally {
    taskRunState.active = false;
    taskRunState.type = null;
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