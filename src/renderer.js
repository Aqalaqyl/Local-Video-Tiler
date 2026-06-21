import {
  createLeaf,
  splitLeaf,
  removeLeaf,
  updateRatio,
  assignFolder,
  setVideoIndex,
  collectLeaves,
  snapRatio,
  serializeTree,
  deserializeTree,
} from './tile-tree.js';

const STORAGE_KEY = 'video-tiler-layout-v1';

const state = {
  root: createLeaf(),
  gridEnabled: false,
  gridDivisions: 3,
  activeLeafId: null,
  contextLeafId: null,
  uiVisible: false,
  uiHideTimer: null,
  isFullscreen: false,
  displayMode: 'window',
  pendingDisplayAction: null,
  dragSplit: null,
};

const els = {
  tileRoot: document.getElementById('tile-root'),
  toolbar: document.getElementById('toolbar'),
  hintBar: document.getElementById('hint-bar'),
  gridCanvas: document.getElementById('grid-canvas'),
  splitIndicator: document.getElementById('split-indicator'),
  contextMenu: document.getElementById('context-menu'),
  statusText: document.getElementById('status-text'),
  btnReset: document.getElementById('btn-reset'),
  btnGrid: document.getElementById('btn-grid'),
  gridDivisions: document.getElementById('grid-divisions'),
  displaySelect: document.getElementById('display-select'),
  btnAllDisplays: document.getElementById('btn-all-displays'),
  btnFullscreen: document.getElementById('btn-fullscreen'),
  displayPreview: document.getElementById('display-preview'),
  previewTitle: document.getElementById('preview-title'),
  previewDesc: document.getElementById('preview-desc'),
  previewTiles: document.getElementById('preview-tiles'),
  previewGrid: document.getElementById('preview-grid'),
  previewCancel: document.getElementById('preview-cancel'),
  previewConfirm: document.getElementById('preview-confirm'),
};

const videoElements = new Map();

function saveLayout() {
  localStorage.setItem(STORAGE_KEY, serializeTree(state.root));
}

function loadLayout() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    state.root = deserializeTree(saved);
  }
}

function showUI() {
  state.uiVisible = true;
  document.body.classList.add('ui-visible');
  els.toolbar.classList.remove('hidden');
  els.toolbar.classList.add('visible');
  els.hintBar.classList.remove('hidden');
  els.hintBar.classList.add('visible');
  clearTimeout(state.uiHideTimer);
  state.uiHideTimer = setTimeout(hideUI, 3500);
}

function hideUI() {
  if (state.dragSplit || !els.displayPreview.classList.contains('hidden')) return;
  state.uiVisible = false;
  document.body.classList.remove('ui-visible');
  els.toolbar.classList.remove('visible');
  els.toolbar.classList.add('hidden');
  els.hintBar.classList.remove('visible');
  els.hintBar.classList.add('hidden');
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function render() {
  videoElements.clear();
  els.tileRoot.innerHTML = '';
  const dom = buildNodeDOM(state.root);
  if (dom) els.tileRoot.appendChild(dom);
  drawGridOverlay();
  saveLayout();
}

function buildNodeDOM(node) {
  if (!node) return null;

  if (node.type === 'leaf') {
    return buildLeafDOM(node);
  }

  const container = document.createElement('div');
  container.className = `tile-split ${node.direction}`;
  container.dataset.splitId = node.id;

  const firstPane = document.createElement('div');
  firstPane.className = 'tile-pane';
  firstPane.style.flex = `${node.ratio} 1 0%`;

  const handle = document.createElement('div');
  handle.className = 'split-handle';
  handle.dataset.splitId = node.id;
  handle.dataset.direction = node.direction;

  const secondPane = document.createElement('div');
  secondPane.className = 'tile-pane';
  secondPane.style.flex = `${1 - node.ratio} 1 0%`;

  const firstDOM = buildNodeDOM(node.first);
  const secondDOM = buildNodeDOM(node.second);
  if (firstDOM) firstPane.appendChild(firstDOM);
  if (secondDOM) secondPane.appendChild(secondDOM);

  container.append(firstPane, handle, secondPane);
  bindSplitHandle(handle, node);
  return container;
}

function buildLeafDOM(leaf) {
  const container = document.createElement('div');
  container.className = 'tile-leaf';
  container.dataset.leafId = leaf.id;
  if (!leaf.folderPath) container.classList.add('empty');
  if (leaf.id === state.activeLeafId) container.classList.add('active');

  const video = document.createElement('video');
  video.autoplay = true;
  video.loop = true;
  video.muted = false;
  video.playsInline = true;
  videoElements.set(leaf.id, video);

  if (leaf.videos.length > 0) {
    const src = leaf.videos[leaf.videoIndex];
    video.src = window.tilerAPI.toFileURL(src);
    video.onerror = () => {
      container.classList.add('empty');
    };
  }

  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay';

  if (!leaf.folderPath) {
    overlay.innerHTML = `
      <div class="tile-hint">Click to split vertically</div>
      <div class="tile-hint">Shift+click for horizontal split</div>
      <div class="tile-hint">Right-click to assign folder</div>
    `;
  } else if (leaf.videos.length === 0) {
    overlay.innerHTML = `<div class="tile-hint">No video files found in folder</div>`;
  }

  const meta = document.createElement('div');
  meta.className = 'tile-meta';
  const folderName = leaf.folderPath ? leaf.folderPath.split(/[/\\]/).pop() : 'Empty tile';
  const videoName =
    leaf.videos.length > 0
      ? leaf.videos[leaf.videoIndex].split(/[/\\]/).pop()
      : '—';
  meta.innerHTML = `
    <span class="tile-badge">${escapeHtml(folderName)}</span>
    <span class="tile-badge">${leaf.videoIndex + 1}/${leaf.videos.length || 0} · ${escapeHtml(videoName)}</span>
  `;

  container.append(video, overlay, meta);
  bindLeafEvents(container, leaf.id);
  return container;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bindLeafEvents(el, leafId) {
  el.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    state.activeLeafId = leafId;
    hideContextMenu();

    const direction = e.shiftKey ? 'horizontal' : 'vertical';
    flashSplitIndicator(el, direction);
    state.root = splitLeaf(state.root, leafId, direction);
    setStatus(`Split ${direction === 'vertical' ? 'vertically' : 'horizontally'}`);
    render();
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    state.activeLeafId = leafId;
    state.contextLeafId = leafId;
    showContextMenu(e.clientX, e.clientY);
    render();
  });

  el.addEventListener('dblclick', async (e) => {
    e.stopPropagation();
    await assignFolderToLeaf(leafId);
  });
}

function flashSplitIndicator(leafEl, direction) {
  const rect = leafEl.getBoundingClientRect();
  const workspaceRect = document.getElementById('workspace').getBoundingClientRect();

  els.splitIndicator.innerHTML = '';
  els.splitIndicator.classList.remove('hidden');

  const line = document.createElement('div');
  line.className = `indicator-line ${direction}`;

  if (direction === 'vertical') {
    line.style.left = `${rect.left + rect.width / 2 - workspaceRect.left}px`;
  } else {
    line.style.top = `${rect.top + rect.height / 2 - workspaceRect.top}px`;
  }

  els.splitIndicator.appendChild(line);
  setTimeout(() => els.splitIndicator.classList.add('hidden'), 350);
}

function bindSplitHandle(handle, splitNode) {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showUI();

    const splitEl = handle.closest('.tile-split');
    const rect = splitEl.getBoundingClientRect();
    state.dragSplit = {
      splitId: splitNode.id,
      direction: splitNode.direction,
      startPos: splitNode.direction === 'vertical' ? e.clientX : e.clientY,
      startRatio: splitNode.ratio,
      size: splitNode.direction === 'vertical' ? rect.width : rect.height,
    };
    handle.classList.add('dragging');

    const onMove = (ev) => {
      if (!state.dragSplit) return;
      const pos = state.dragSplit.direction === 'vertical' ? ev.clientX : ev.clientY;
      const delta = pos - state.dragSplit.startPos;
      let ratio = state.dragSplit.startRatio + delta / state.dragSplit.size;
      ratio = snapRatio(ratio, state.gridDivisions, state.gridEnabled);
      state.root = updateRatio(state.root, state.dragSplit.splitId, ratio);
      render();
      const newHandle = document.querySelector(
        `.split-handle[data-split-id="${state.dragSplit.splitId}"]`
      );
      newHandle?.classList.add('dragging');
    };

    const onUp = () => {
      state.dragSplit = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      hideUI();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function drawGridOverlay() {
  const canvas = els.gridCanvas;
  const workspace = document.getElementById('workspace');
  const rect = workspace.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!state.gridEnabled) {
    canvas.classList.add('hidden');
    return;
  }

  canvas.classList.remove('hidden');
  const divisions = state.gridDivisions;

  ctx.strokeStyle = 'rgba(77, 163, 255, 0.18)';
  ctx.lineWidth = 1;

  for (let i = 1; i < divisions; i++) {
    const x = (canvas.width / divisions) * i;
    const y = (canvas.height / divisions) * i;

    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(77, 163, 255, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);

  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();

  ctx.setLineDash([]);
}

function showContextMenu(x, y) {
  els.contextMenu.classList.remove('hidden');
  els.contextMenu.style.left = `${x}px`;
  els.contextMenu.style.top = `${y}px`;

  requestAnimationFrame(() => {
    const rect = els.contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      els.contextMenu.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      els.contextMenu.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  });
}

function hideContextMenu() {
  els.contextMenu.classList.add('hidden');
  state.contextLeafId = null;
}

async function assignFolderToLeaf(leafId) {
  const result = await window.tilerAPI.selectFolder();
  if (!result) return;

  state.root = assignFolder(state.root, leafId, result.folderPath, result.videos);
  setStatus(`Assigned ${result.videos.length} video(s) to tile`);
  render();
}

function getLeafCount() {
  return collectLeaves(state.root).length;
}

function computeTileRects(node, bounds, rects = []) {
  if (!node) return rects;

  if (node.type === 'leaf') {
    rects.push({ id: node.id, ...bounds });
    return rects;
  }

  if (node.direction === 'vertical') {
    const splitX = bounds.x + bounds.width * node.ratio;
    computeTileRects(node.first, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width * node.ratio,
      height: bounds.height,
    }, rects);
    computeTileRects(node.second, {
      x: splitX,
      y: bounds.y,
      width: bounds.width * (1 - node.ratio),
      height: bounds.height,
    }, rects);
  } else {
    const splitY = bounds.y + bounds.height * node.ratio;
    computeTileRects(node.first, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height * node.ratio,
    }, rects);
    computeTileRects(node.second, {
      x: bounds.x,
      y: splitY,
      width: bounds.width,
      height: bounds.height * (1 - node.ratio),
    }, rects);
  }

  return rects;
}

function computeSplitLines(node, bounds, lines = []) {
  if (!node || node.type !== 'split') return lines;

  if (node.direction === 'vertical') {
    const x = bounds.x + bounds.width * node.ratio;
    lines.push({ direction: 'vertical', x, y: bounds.y, length: bounds.height });
    computeSplitLines(node.first, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width * node.ratio,
      height: bounds.height,
    }, lines);
    computeSplitLines(node.second, {
      x,
      y: bounds.y,
      width: bounds.width * (1 - node.ratio),
      height: bounds.height,
    }, lines);
  } else {
    const y = bounds.y + bounds.height * node.ratio;
    lines.push({ direction: 'horizontal', x: bounds.x, y, length: bounds.width });
    computeSplitLines(node.first, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height * node.ratio,
    }, lines);
    computeSplitLines(node.second, {
      x: bounds.x,
      y,
      width: bounds.width,
      height: bounds.height * (1 - node.ratio),
    }, lines);
  }

  return lines;
}

function showDisplayPreview(action) {
  state.pendingDisplayAction = action;

  const { mode, displayId, title, desc } = action;
  els.previewTitle.textContent = title;
  els.previewDesc.textContent = desc;

  const frameRect = { x: 0, y: 0, width: 100, height: 100 };

  els.previewTiles.innerHTML = '';
  els.previewGrid.innerHTML = '';

  const tileRects = computeTileRects(state.root, frameRect);
  tileRects.forEach((rect, i) => {
    const tile = document.createElement('div');
    tile.className = 'preview-tile';
    tile.style.left = `${rect.x}%`;
    tile.style.top = `${rect.y}%`;
    tile.style.width = `${rect.width}%`;
    tile.style.height = `${rect.height}%`;
    tile.innerHTML = `<span class="preview-tile-label">Tile ${i + 1}</span>`;
    els.previewTiles.appendChild(tile);
  });

  const splitLines = computeSplitLines(state.root, frameRect);
  splitLines.forEach((line) => {
    const el = document.createElement('div');
    el.className = `preview-split-line ${line.direction}`;
    if (line.direction === 'vertical') {
      el.style.left = `${line.x}%`;
    } else {
      el.style.top = `${line.y}%`;
    }
    els.previewTiles.appendChild(el);
  });

  if (state.gridEnabled) {
    els.previewGrid.classList.remove('hidden');
    for (let i = 1; i < state.gridDivisions; i++) {
      const pct = (100 / state.gridDivisions) * i;

      const vLine = document.createElement('div');
      vLine.className = 'preview-grid-line vertical';
      vLine.style.left = `${pct}%`;
      els.previewGrid.appendChild(vLine);

      const hLine = document.createElement('div');
      hLine.className = 'preview-grid-line horizontal';
      hLine.style.top = `${pct}%`;
      els.previewGrid.appendChild(hLine);
    }
  } else {
    els.previewGrid.classList.add('hidden');
  }

  els.displayPreview.classList.remove('hidden');
  showUI();
}

function hideDisplayPreview() {
  els.displayPreview.classList.add('hidden');
  state.pendingDisplayAction = null;
}

async function applyDisplayPreview() {
  const action = state.pendingDisplayAction;
  if (!action) return;

  hideDisplayPreview();

  if (action.mode === 'window') {
    await window.tilerAPI.exitFullscreen();
    state.isFullscreen = false;
    state.displayMode = 'window';
    document.body.classList.remove('fullscreen-mode', 'all-displays-mode');
    setStatus('Windowed mode');
    return;
  }

  await window.tilerAPI.setDisplayMode(action.mode, action.displayId);
  state.isFullscreen = true;
  state.displayMode = action.mode;

  document.body.classList.remove('fullscreen-mode', 'all-displays-mode');
  if (action.mode === 'all') {
    document.body.classList.add('all-displays-mode');
    setStatus(`Spanning all displays · ${getLeafCount()} tiles`);
  } else {
    document.body.classList.add('fullscreen-mode');
    setStatus(`Fullscreen on ${action.label} · ${getLeafCount()} tiles`);
  }

  render();
}

async function populateDisplays() {
  const displays = await window.tilerAPI.getDisplays();
  els.displaySelect.innerHTML = '<option value="window">Windowed</option>';

  displays.forEach((display) => {
    const option = document.createElement('option');
    option.value = display.id;
    option.textContent = `${display.label}${display.isPrimary ? ' (Primary)' : ''} — ${display.bounds.width}×${display.bounds.height}`;
    els.displaySelect.appendChild(option);
  });
}

function toggleGrid() {
  state.gridEnabled = !state.gridEnabled;
  els.btnGrid.classList.toggle('active', state.gridEnabled);
  drawGridOverlay();
  setStatus(state.gridEnabled ? 'Grid snap enabled' : 'Grid snap disabled');
}

function setupToolbar() {
  els.btnReset.addEventListener('click', () => {
    state.root = createLeaf();
    state.activeLeafId = null;
    render();
    setStatus('Layout reset');
  });

  els.btnGrid.addEventListener('click', toggleGrid);

  els.gridDivisions.addEventListener('change', () => {
    state.gridDivisions = Number(els.gridDivisions.value);
    drawGridOverlay();
  });

  els.displaySelect.addEventListener('change', async () => {
    const value = els.displaySelect.value;
    if (value === 'window') {
      await window.tilerAPI.exitFullscreen();
      state.isFullscreen = false;
      state.displayMode = 'window';
      document.body.classList.remove('fullscreen-mode', 'all-displays-mode');
      setStatus('Windowed mode');
      return;
    }

    const displays = await window.tilerAPI.getDisplays();
    const display = displays.find((d) => String(d.id) === value);
    showDisplayPreview({
      mode: 'single',
      displayId: display?.id,
      label: display?.label ?? 'Display',
      title: 'Fullscreen Preview',
      desc: `Your ${getLeafCount()} tile(s) will fill ${display?.label ?? 'the selected display'}. Split lines show how videos are arranged.`,
    });
  });

  els.btnAllDisplays.addEventListener('click', () => {
    showDisplayPreview({
      mode: 'all',
      title: 'All Displays Preview',
      desc: `Your layout will span every connected display as one continuous canvas. ${getLeafCount()} tile(s) shown below.`,
    });
  });

  els.btnFullscreen.addEventListener('click', async () => {
    const displayId = els.displaySelect.value;
    const displays = await window.tilerAPI.getDisplays();

    if (displayId === 'window') {
      const primary = displays.find((d) => d.isPrimary) ?? displays[0];
      showDisplayPreview({
        mode: 'single',
        displayId: primary?.id ?? null,
        label: primary?.label ?? 'Primary Display',
        title: 'Fullscreen Preview',
        desc: `Your ${getLeafCount()} tile(s) will fill the primary display.`,
      });
      return;
    }

    const display = displays.find((d) => String(d.id) === displayId);
    showDisplayPreview({
      mode: 'single',
      displayId: display?.id,
      label: display?.label ?? 'Display',
      title: 'Fullscreen Preview',
      desc: `Your ${getLeafCount()} tile(s) will fill ${display?.label ?? 'the selected display'}.`,
    });
  });

  els.previewCancel.addEventListener('click', hideDisplayPreview);
  els.previewConfirm.addEventListener('click', applyDisplayPreview);
}

function setupContextMenu() {
  els.contextMenu.addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    if (!action || !state.contextLeafId) return;

    const leafId = state.contextLeafId;
    hideContextMenu();

    switch (action) {
      case 'assign-folder':
        await assignFolderToLeaf(leafId);
        break;
      case 'next-video':
        state.root = setVideoIndex(state.root, leafId, findLeaf(leafId).videoIndex + 1);
        render();
        break;
      case 'prev-video':
        state.root = setVideoIndex(state.root, leafId, findLeaf(leafId).videoIndex - 1);
        render();
        break;
      case 'split-v':
        state.root = splitLeaf(state.root, leafId, 'vertical');
        render();
        break;
      case 'split-h':
        state.root = splitLeaf(state.root, leafId, 'horizontal');
        render();
        break;
      case 'close-tile':
        if (getLeafCount() > 1) {
          state.root = removeLeaf(state.root, leafId);
          render();
        } else {
          setStatus('Cannot close the last tile');
        }
        break;
      default:
        break;
    }
  });
}

function findLeaf(id) {
  return collectLeaves(state.root).find((l) => l.id === id) ?? { videoIndex: 0 };
}

function setupGlobalEvents() {
  document.addEventListener('mousemove', (e) => {
    if (e.clientY < 56 || e.clientY > window.innerHeight - 40) {
      showUI();
    }
  });

  document.addEventListener('click', (e) => {
    if (!els.contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  window.addEventListener('resize', () => {
    drawGridOverlay();
  });

  document.addEventListener('keydown', async (e) => {
    if (e.key === 'g' || e.key === 'G') {
      if (!e.ctrlKey && !e.metaKey) toggleGrid();
    }

    if (e.key === 'F11') {
      e.preventDefault();
      els.btnFullscreen.click();
    }

    if (e.key === 'Escape') {
      if (!els.displayPreview.classList.contains('hidden')) {
        hideDisplayPreview();
        return;
      }
      if (state.isFullscreen) {
        await window.tilerAPI.exitFullscreen();
        state.isFullscreen = false;
        state.displayMode = 'window';
        document.body.classList.remove('fullscreen-mode', 'all-displays-mode');
        els.displaySelect.value = 'window';
        setStatus('Exited fullscreen');
      }
      hideContextMenu();
    }
  });
}

async function init() {
  loadLayout();
  setupToolbar();
  setupContextMenu();
  setupGlobalEvents();
  await populateDisplays();
  render();
  showUI();
  setStatus('Click a tile to split · Shift+click for horizontal');
}

init();
