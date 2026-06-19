const STORAGE_KEY = "local-video-tiler-layout-v1";
const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

const app = document.querySelector("#app");
const layoutRoot = document.querySelector("#layoutRoot");
const editModeToggle = document.querySelector("#editModeToggle");
const gridToggle = document.querySelector("#gridToggle");
const snapToggle = document.querySelector("#snapToggle");
const gridSizeInput = document.querySelector("#gridSize");
const gridSizeValue = document.querySelector("#gridSizeValue");
const spanDisplaysToggle = document.querySelector("#spanDisplaysToggle");
const resetLayoutButton = document.querySelector("#resetLayout");

const state = {
  root: createTile(),
  editMode: false,
  showGrid: false,
  snap: false,
  gridSize: 4,
  activeTileId: null,
  shellTimer: null,
  isSpanningDisplays: false
};

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createTile(overrides = {}) {
  return {
    id: createId(),
    type: "tile",
    folderPath: "",
    files: [],
    currentIndex: 0,
    ...overrides
  };
}

function sanitizeLayout(node) {
  if (!node || typeof node !== "object") {
    return createTile();
  }

  if (node.type === "split") {
    return {
      id: typeof node.id === "string" ? node.id : createId(),
      type: "split",
      direction: node.direction === "horizontal" ? "horizontal" : "vertical",
      ratio: clampRatio(Number(node.ratio) || 0.5),
      first: sanitizeLayout(node.first),
      second: sanitizeLayout(node.second)
    };
  }

  return createTile({
    id: typeof node.id === "string" ? node.id : createId(),
    folderPath: typeof node.folderPath === "string" ? node.folderPath : "",
    currentIndex: Number.isInteger(node.currentIndex) ? Math.max(0, node.currentIndex) : 0
  });
}

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) {
      return;
    }

    state.root = sanitizeLayout(saved.root);
    state.showGrid = Boolean(saved.showGrid);
    state.snap = Boolean(saved.snap);
    state.gridSize = Number.isInteger(saved.gridSize) ? Math.min(12, Math.max(2, saved.gridSize)) : 4;
  } catch (error) {
    console.warn("Could not restore saved layout.", error);
  }
}

function saveState() {
  const serialize = (node) => {
    if (node.type === "split") {
      return {
        id: node.id,
        type: "split",
        direction: node.direction,
        ratio: node.ratio,
        first: serialize(node.first),
        second: serialize(node.second)
      };
    }

    return {
      id: node.id,
      type: "tile",
      folderPath: node.folderPath,
      currentIndex: node.currentIndex
    };
  };

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      root: serialize(state.root),
      showGrid: state.showGrid,
      snap: state.snap,
      gridSize: state.gridSize
    })
  );
}

function clampRatio(ratio) {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

function snapRatio(ratio) {
  if (!state.snap) {
    return clampRatio(ratio);
  }

  const step = 1 / state.gridSize;
  const snapped = Math.round(ratio / step) * step;
  return clampRatio(snapped);
}

function findNode(node, id) {
  if (node.id === id) {
    return node;
  }

  if (node.type === "split") {
    return findNode(node.first, id) || findNode(node.second, id);
  }

  return null;
}

function splitTile(tileId, direction, ratio) {
  const tile = findNode(state.root, tileId);

  if (!tile || tile.type !== "tile") {
    return;
  }

  const existingTile = {
    ...tile,
    id: createId()
  };

  Object.assign(tile, {
    id: tileId,
    type: "split",
    direction,
    ratio: snapRatio(ratio),
    first: existingTile,
    second: createTile()
  });

  state.activeTileId = existingTile.id;
  saveState();
  render();
}

function resetLayout() {
  if (!confirm("Reset the current layout? Assigned folders will be removed from this layout.")) {
    return;
  }

  state.root = createTile();
  state.activeTileId = state.root.id;
  saveState();
  render();
}

async function assignFolder(tileId) {
  const tile = findNode(state.root, tileId);
  if (!tile || tile.type !== "tile") {
    return;
  }

  const result = await window.mediaTiler.chooseFolder();
  if (!result) {
    return;
  }

  tile.folderPath = result.folderPath;
  tile.files = result.files;
  tile.currentIndex = 0;
  state.activeTileId = tile.id;
  saveState();
  render();
}

function setCurrentFile(tileId, offset) {
  const tile = findNode(state.root, tileId);
  if (!tile || tile.type !== "tile" || tile.files.length === 0) {
    return;
  }

  tile.currentIndex = (tile.currentIndex + offset + tile.files.length) % tile.files.length;
  state.activeTileId = tile.id;
  saveState();
  render();
}

async function refreshFolders(node = state.root) {
  if (node.type === "split") {
    await Promise.all([refreshFolders(node.first), refreshFolders(node.second)]);
    return;
  }

  if (!node.folderPath) {
    return;
  }

  try {
    node.files = await window.mediaTiler.readFolder(node.folderPath);
    if (node.currentIndex >= node.files.length) {
      node.currentIndex = Math.max(0, node.files.length - 1);
    }
  } catch (error) {
    console.warn(`Could not read media folder: ${node.folderPath}`, error);
    node.files = [];
  }
}

function render() {
  layoutRoot.replaceChildren(renderNode(state.root));
  updateControls();
}

function renderNode(node) {
  if (node.type === "split") {
    return renderSplit(node);
  }

  return renderTile(node);
}

function renderSplit(node) {
  const split = document.createElement("section");
  split.className = `layout-node split ${node.direction}`;
  split.style.setProperty("--first-size", `${node.ratio}fr`);
  split.style.setProperty("--second-size", `${1 - node.ratio}fr`);
  split.style.setProperty("--gutter-size", "6px");

  split.append(renderNode(node.first));

  const gutter = document.createElement("div");
  gutter.className = "gutter";
  gutter.setAttribute("role", "separator");
  gutter.setAttribute("aria-orientation", node.direction === "vertical" ? "vertical" : "horizontal");
  gutter.addEventListener("pointerdown", (event) => startResize(event, node, split));
  split.append(gutter, renderNode(node.second));

  return split;
}

function renderTile(tile) {
  const tileElement = document.createElement("article");
  tileElement.className = `layout-node tile${state.activeTileId === tile.id ? " active" : ""}`;
  tileElement.dataset.tileId = tile.id;

  const currentFile = tile.files[tile.currentIndex];
  if (currentFile) {
    tileElement.append(renderMedia(currentFile));
  } else {
    tileElement.append(renderEmptyTile(tile));
  }

  const preview = document.createElement("div");
  preview.className = "split-preview vertical";
  preview.style.setProperty("--preview-ratio", "50%");
  tileElement.append(preview, renderTileBar(tile, currentFile));

  tileElement.addEventListener("mouseenter", () => {
    if (state.editMode) {
      tileElement.classList.add("hovering");
    }
  });

  tileElement.addEventListener("mouseleave", () => {
    tileElement.classList.remove("hovering");
  });

  tileElement.addEventListener("mousemove", (event) => {
    if (!state.editMode) {
      return;
    }

    updateSplitPreview(tileElement, preview, event);
  });

  tileElement.addEventListener("click", (event) => {
    state.activeTileId = tile.id;

    if (!state.editMode) {
      updateControls();
      return;
    }

    if (event.target.closest("button, input, select, video, audio")) {
      return;
    }

    const ratio = getPointerRatio(tileElement, event, event.shiftKey ? "horizontal" : "vertical");
    splitTile(tile.id, event.shiftKey ? "horizontal" : "vertical", ratio);
  });

  return tileElement;
}

function renderMedia(file) {
  if (file.kind === "audio") {
    const wrapper = document.createElement("div");
    wrapper.className = "audio-backdrop";
    wrapper.innerHTML = `<div><strong>${escapeHtml(file.name)}</strong><br>Audio file</div>`;

    const audio = document.createElement("audio");
    audio.className = "tile-media audio";
    audio.controls = true;
    audio.src = file.url;
    wrapper.append(audio);
    return wrapper;
  }

  const video = document.createElement("video");
  video.className = "tile-media";
  video.controls = true;
  video.src = file.url;
  video.playsInline = true;
  return video;
}

function renderEmptyTile(tile) {
  const empty = document.createElement("div");
  empty.className = "tile-empty";

  const title = tile.folderPath ? "No playable media found" : "Assign a folder";
  const description = tile.folderPath
    ? `This tile is reading ${tile.folderPath}, but no supported media files were found.`
    : "Each tile can point at its own local folder of downloaded video files.";

  empty.innerHTML = `
    <div class="tile-empty-card">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(description)}</span>
      <button class="tile-button" type="button" data-action="assign">Choose folder</button>
    </div>
  `;

  empty.querySelector("[data-action='assign']").addEventListener("click", (event) => {
    event.stopPropagation();
    assignFolder(tile.id);
  });

  return empty;
}

function renderTileBar(tile, currentFile) {
  const bar = document.createElement("div");
  bar.className = "tile-bar";

  const title = document.createElement("div");
  title.className = "tile-title";
  title.textContent = currentFile ? currentFile.name : tile.folderPath || "Unassigned tile";

  const meta = document.createElement("div");
  meta.className = "tile-meta";
  meta.textContent = tile.files.length > 0 ? `${tile.currentIndex + 1} / ${tile.files.length}` : "No media";

  const previous = makeTileButton("Prev", () => setCurrentFile(tile.id, -1));
  const next = makeTileButton("Next", () => setCurrentFile(tile.id, 1));
  const assign = makeTileButton("Folder", () => assignFolder(tile.id));

  previous.disabled = tile.files.length < 2;
  next.disabled = tile.files.length < 2;

  bar.append(title, meta, previous, next, assign);
  return bar;
}

function makeTileButton(label, onClick) {
  const button = document.createElement("button");
  button.className = "tile-button";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });

  return button;
}

function updateSplitPreview(tileElement, preview, event) {
  const direction = event.shiftKey ? "horizontal" : "vertical";
  const ratio = snapRatio(getPointerRatio(tileElement, event, direction));

  preview.className = `split-preview ${direction}`;
  preview.style.setProperty("--preview-ratio", `${ratio * 100}%`);
}

function getPointerRatio(element, event, direction) {
  const rect = element.getBoundingClientRect();

  if (direction === "horizontal") {
    return clampRatio((event.clientY - rect.top) / rect.height);
  }

  return clampRatio((event.clientX - rect.left) / rect.width);
}

function startResize(event, node, splitElement) {
  if (!state.editMode) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const captureTarget = event.currentTarget;
  captureTarget.setPointerCapture(event.pointerId);

  const updateRatio = (moveEvent) => {
    const rect = splitElement.getBoundingClientRect();
    const rawRatio =
      node.direction === "horizontal"
        ? (moveEvent.clientY - rect.top) / rect.height
        : (moveEvent.clientX - rect.left) / rect.width;

    node.ratio = snapRatio(rawRatio);
    splitElement.style.setProperty("--first-size", `${node.ratio}fr`);
    splitElement.style.setProperty("--second-size", `${1 - node.ratio}fr`);
  };

  const finishResize = (upEvent) => {
    updateRatio(upEvent);
    saveState();
    if (captureTarget.hasPointerCapture(event.pointerId)) {
      captureTarget.releasePointerCapture(event.pointerId);
    }
    window.removeEventListener("pointermove", updateRatio);
    window.removeEventListener("pointerup", finishResize);
  };

  window.addEventListener("pointermove", updateRatio);
  window.addEventListener("pointerup", finishResize);
}

function updateControls() {
  app.classList.toggle("edit-mode", state.editMode);
  app.classList.toggle("show-grid", state.showGrid);
  app.style.setProperty("--grid-size", state.gridSize);

  editModeToggle.setAttribute("aria-pressed", String(state.editMode));
  editModeToggle.textContent = state.editMode ? "Done editing" : "Edit layout";
  gridToggle.setAttribute("aria-pressed", String(state.showGrid));
  snapToggle.setAttribute("aria-pressed", String(state.snap));
  gridSizeInput.value = String(state.gridSize);
  gridSizeValue.textContent = String(state.gridSize);
  spanDisplaysToggle.setAttribute("aria-pressed", String(state.isSpanningDisplays));
}

function revealShell() {
  app.classList.add("shell-visible");
  clearTimeout(state.shellTimer);

  if (!state.editMode) {
    state.shellTimer = setTimeout(() => {
      app.classList.remove("shell-visible");
    }, 2200);
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

editModeToggle.addEventListener("click", () => {
  state.editMode = !state.editMode;
  revealShell();
  updateControls();
});

gridToggle.addEventListener("click", () => {
  state.showGrid = !state.showGrid;
  saveState();
  updateControls();
});

snapToggle.addEventListener("click", () => {
  state.snap = !state.snap;
  saveState();
  updateControls();
});

gridSizeInput.addEventListener("input", () => {
  state.gridSize = Number(gridSizeInput.value);
  saveState();
  updateControls();
});

spanDisplaysToggle.addEventListener("click", async () => {
  const nextValue = !state.isSpanningDisplays;
  state.isSpanningDisplays = await window.mediaTiler.setSpanAllDisplays(nextValue);
  updateControls();
});

resetLayoutButton.addEventListener("click", resetLayout);

window.addEventListener("mousemove", revealShell);
window.addEventListener("keydown", (event) => {
  revealShell();

  if (event.key === "Escape" && state.editMode) {
    state.editMode = false;
    updateControls();
  }
});

loadSavedState();
refreshFolders()
  .then(async () => {
    const displayState = await window.mediaTiler.getDisplayState();
    state.isSpanningDisplays = displayState.isSpanningDisplays;
  })
  .catch((error) => {
    console.warn("Startup refresh failed.", error);
  })
  .finally(() => {
    render();
    revealShell();
  });
