const STORAGE_KEY = "local-video-tiler-state-v1";
const SNAP_STEPS = 16;
const INACTIVITY_MS = 2400;

const workspaceEl = document.getElementById("workspace");
const editModeBtn = document.getElementById("editModeBtn");
const gridBtn = document.getElementById("gridBtn");
const snapBtn = document.getElementById("snapBtn");
const spanDisplaysBtn = document.getElementById("spanDisplaysBtn");
const resetLayoutBtn = document.getElementById("resetLayoutBtn");
const displayStatusEl = document.getElementById("displayStatus");

let sequence = 0;
let idleTimer = null;

const createId = (prefix) => `${prefix}-${Date.now()}-${++sequence}`;

const createLeaf = () => ({
  kind: "leaf",
  id: createId("leaf"),
  folderPath: "",
  mediaFiles: [],
  selectedUrl: "",
});

const state = {
  layout: createLeaf(),
  editMode: false,
  showGrid: false,
  snapSplits: true,
  spanAllDisplays: false,
  shiftPressed: false,
  displayInfo: null,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const snapRatio = (ratio) => {
  if (!state.snapSplits) {
    return ratio;
  }
  return Math.round(ratio * SNAP_STEPS) / SNAP_STEPS;
};

const folderLabel = (folderPath) => {
  if (!folderPath) {
    return "No folder selected";
  }
  const parts = folderPath.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || folderPath;
};

const saveState = () => {
  const payload = {
    layout: state.layout,
    showGrid: state.showGrid,
    snapSplits: state.snapSplits,
    spanAllDisplays: state.spanAllDisplays,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

const validateLayout = (node) => {
  if (!node || typeof node !== "object" || typeof node.id !== "string") {
    return null;
  }
  if (node.kind === "leaf") {
    return {
      kind: "leaf",
      id: node.id,
      folderPath: typeof node.folderPath === "string" ? node.folderPath : "",
      mediaFiles: Array.isArray(node.mediaFiles) ? node.mediaFiles : [],
      selectedUrl: typeof node.selectedUrl === "string" ? node.selectedUrl : "",
    };
  }
  if (node.kind === "split") {
    const first = validateLayout(node.first);
    const second = validateLayout(node.second);
    if (!first || !second) {
      return null;
    }
    return {
      kind: "split",
      id: node.id,
      direction: node.direction === "horizontal" ? "horizontal" : "vertical",
      ratio: clamp(Number(node.ratio) || 0.5, 0.1, 0.9),
      first,
      second,
    };
  }
  return null;
};

const loadState = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const loadedLayout = validateLayout(parsed.layout);
    if (loadedLayout) {
      state.layout = loadedLayout;
    }
    state.showGrid = Boolean(parsed.showGrid);
    state.snapSplits = parsed.snapSplits !== false;
    state.spanAllDisplays = Boolean(parsed.spanAllDisplays);
  } catch {
    // Leave defaults if local storage is malformed.
  }
};

const updateNode = (node, targetId, updater) => {
  if (node.id === targetId) {
    return updater(node);
  }
  if (node.kind !== "split") {
    return node;
  }

  const first = updateNode(node.first, targetId, updater);
  const second = updateNode(node.second, targetId, updater);
  if (first === node.first && second === node.second) {
    return node;
  }
  return { ...node, first, second };
};

const splitLeaf = (leafId, direction) => {
  state.layout = updateNode(state.layout, leafId, (node) => {
    if (node.kind !== "leaf") {
      return node;
    }
    return {
      kind: "split",
      id: createId("split"),
      direction,
      ratio: 0.5,
      first: node,
      second: createLeaf(),
    };
  });
};

const setLeafMedia = (leafId, values) => {
  state.layout = updateNode(state.layout, leafId, (node) => {
    if (node.kind !== "leaf") {
      return node;
    }
    return { ...node, ...values };
  });
};

const setSplitRatio = (splitId, ratio) => {
  const next = clamp(snapRatio(ratio), 0.1, 0.9);
  state.layout = updateNode(state.layout, splitId, (node) => {
    if (node.kind !== "split") {
      return node;
    }
    return { ...node, ratio: next };
  });
};

const refreshLeafFromFolder = async (leaf) => {
  if (!leaf.folderPath) {
    return;
  }

  const mediaFiles = await window.videoTiler.listMediaFiles(leaf.folderPath);
  const selectedUrl =
    mediaFiles.some((file) => file.url === leaf.selectedUrl) && leaf.selectedUrl
      ? leaf.selectedUrl
      : mediaFiles[0]?.url || "";
  setLeafMedia(leaf.id, { mediaFiles, selectedUrl });
  saveState();
  render();
};

const createMediaSelect = (leaf) => {
  const select = document.createElement("select");
  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = leaf.mediaFiles.length
    ? "Select media..."
    : "No media files found";
  select.append(emptyOption);

  leaf.mediaFiles.forEach((file) => {
    const option = document.createElement("option");
    option.value = file.url;
    option.textContent = file.name;
    select.append(option);
  });

  select.value = leaf.selectedUrl || "";
  select.addEventListener("click", (event) => event.stopPropagation());
  select.addEventListener("change", (event) => {
    setLeafMedia(leaf.id, { selectedUrl: event.target.value });
    saveState();
    render();
  });
  return select;
};

const renderLeaf = (leaf) => {
  const tile = document.createElement("div");
  tile.className = `tile ${state.editMode ? "editable" : ""}`;

  const header = document.createElement("div");
  header.className = "tile-header ui-layer";

  const controls = document.createElement("div");
  controls.className = "tile-controls";

  const pickFolderButton = document.createElement("button");
  pickFolderButton.textContent = "Choose Folder";
  pickFolderButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    const folderPath = await window.videoTiler.selectFolder();
    if (!folderPath) {
      return;
    }
    const mediaFiles = await window.videoTiler.listMediaFiles(folderPath);
    setLeafMedia(leaf.id, {
      folderPath,
      mediaFiles,
      selectedUrl: mediaFiles[0]?.url || "",
    });
    saveState();
    render();
  });

  const refreshButton = document.createElement("button");
  refreshButton.textContent = "Refresh";
  refreshButton.disabled = !leaf.folderPath;
  refreshButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await refreshLeafFromFolder(leaf);
  });

  controls.append(pickFolderButton, refreshButton, createMediaSelect(leaf));

  const label = document.createElement("span");
  label.className = "folder-label";
  label.textContent = folderLabel(leaf.folderPath);
  label.title = leaf.folderPath || "";

  header.append(controls, label);

  const content = document.createElement("div");
  content.className = "tile-content";

  if (leaf.selectedUrl) {
    const video = document.createElement("video");
    video.controls = true;
    video.src = leaf.selectedUrl;
    content.append(video);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "tile-placeholder";
    placeholder.textContent =
      "Choose a folder for this tile to load local video files and start playback.";
    content.append(placeholder);
  }

  const splitPreview = document.createElement("div");
  splitPreview.className = `split-preview ${state.shiftPressed ? "horizontal" : "vertical"}`;
  content.append(splitPreview);

  tile.append(header, content);
  tile.addEventListener("click", (event) => {
    if (!state.editMode) {
      return;
    }
    if (event.target.closest(".tile-controls")) {
      return;
    }
    splitLeaf(leaf.id, state.shiftPressed ? "horizontal" : "vertical");
    saveState();
    render();
  });

  return tile;
};

const attachDividerDrag = (divider, splitNode, paneA) => {
  divider.addEventListener("mousedown", (mouseDownEvent) => {
    mouseDownEvent.preventDefault();
    const parentRect = divider.parentElement.getBoundingClientRect();
    const direction = splitNode.direction;
    divider.classList.add("dragging");

    const onMouseMove = (moveEvent) => {
      let ratio = splitNode.ratio;
      if (direction === "vertical") {
        ratio = (moveEvent.clientX - parentRect.left) / parentRect.width;
      } else {
        ratio = (moveEvent.clientY - parentRect.top) / parentRect.height;
      }

      const clamped = clamp(snapRatio(ratio), 0.1, 0.9);
      paneA.style.flexBasis = `${clamped * 100}%`;
      setSplitRatio(splitNode.id, clamped);
    };

    const onMouseUp = () => {
      divider.classList.remove("dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      saveState();
      render();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
};

const renderSplit = (splitNode) => {
  const container = document.createElement("div");
  container.className = `split-node ${splitNode.direction}`;

  const paneA = document.createElement("div");
  paneA.className = "split-pane";
  paneA.style.flex = `0 0 ${splitNode.ratio * 100}%`;
  paneA.append(renderNode(splitNode.first));

  const paneB = document.createElement("div");
  paneB.className = "split-pane";
  paneB.style.flex = "1 1 0";
  paneB.append(renderNode(splitNode.second));

  const divider = document.createElement("div");
  divider.className = "divider";
  attachDividerDrag(divider, splitNode, paneA);

  container.append(paneA, divider, paneB);
  return container;
};

const renderNode = (node) => {
  if (node.kind === "leaf") {
    return renderLeaf(node);
  }
  return renderSplit(node);
};

const applyBodyClasses = () => {
  document.body.classList.toggle("grid-on", state.showGrid);
};

const renderToolbar = () => {
  editModeBtn.textContent = `Edit Mode: ${state.editMode ? "On" : "Off"}`;
  editModeBtn.classList.toggle("toggle-active", state.editMode);
  gridBtn.textContent = `Grid: ${state.showGrid ? "On" : "Off"}`;
  gridBtn.classList.toggle("toggle-active", state.showGrid);
  snapBtn.textContent = `Snap: ${state.snapSplits ? "On" : "Off"}`;
  snapBtn.classList.toggle("toggle-active", state.snapSplits);
  spanDisplaysBtn.textContent = `Span All Displays: ${state.spanAllDisplays ? "On" : "Off"}`;
  spanDisplaysBtn.classList.toggle("toggle-active", state.spanAllDisplays);

  if (state.displayInfo) {
    displayStatusEl.textContent = `Displays: ${state.displayInfo.count}`;
  } else {
    displayStatusEl.textContent = "Displays: ...";
  }
};

const render = () => {
  applyBodyClasses();
  renderToolbar();
  workspaceEl.replaceChildren(renderNode(state.layout));
};

const setActivityState = (idle) => {
  document.body.classList.toggle("activity-idle", idle);
  document.body.classList.toggle("activity-active", !idle);
};

const markActivity = () => {
  setActivityState(false);
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  if (state.editMode) {
    return;
  }
  idleTimer = setTimeout(() => setActivityState(true), INACTIVITY_MS);
};

const wireToolbar = () => {
  editModeBtn.addEventListener("click", () => {
    state.editMode = !state.editMode;
    markActivity();
    render();
  });

  gridBtn.addEventListener("click", () => {
    state.showGrid = !state.showGrid;
    saveState();
    render();
  });

  snapBtn.addEventListener("click", () => {
    state.snapSplits = !state.snapSplits;
    saveState();
    render();
  });

  spanDisplaysBtn.addEventListener("click", async () => {
    state.spanAllDisplays = !state.spanAllDisplays;
    const info = await window.videoTiler.setSpanAllDisplays(state.spanAllDisplays);
    state.spanAllDisplays = info.spanAllDisplays;
    state.displayInfo = info;
    saveState();
    render();
  });

  resetLayoutBtn.addEventListener("click", () => {
    state.layout = createLeaf();
    saveState();
    render();
  });
};

const wireGlobalEvents = () => {
  window.addEventListener("mousemove", markActivity);
  window.addEventListener("mousedown", markActivity);
  window.addEventListener("keydown", (event) => {
    markActivity();
    if (event.key === "Shift" && !state.shiftPressed) {
      state.shiftPressed = true;
      render();
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "Shift" && state.shiftPressed) {
      state.shiftPressed = false;
      render();
    }
  });
};

const refreshDisplayInfo = async () => {
  state.displayInfo = await window.videoTiler.getDisplayInfo();
  renderToolbar();
};

const bootstrap = async () => {
  loadState();
  wireToolbar();
  wireGlobalEvents();
  window.videoTiler.onDisplaysChanged((info) => {
    state.displayInfo = info;
    state.spanAllDisplays = info.spanAllDisplays;
    renderToolbar();
  });
  await refreshDisplayInfo();
  if (state.spanAllDisplays) {
    const info = await window.videoTiler.setSpanAllDisplays(true);
    state.displayInfo = info;
    state.spanAllDisplays = info.spanAllDisplays;
  }
  markActivity();
  render();
};

bootstrap();
