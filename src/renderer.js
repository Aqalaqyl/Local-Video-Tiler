'use strict';

/* ============================================================================
 * Local Video Tiler — renderer
 *
 * The screen is modelled as a binary space-partition (BSP) tree:
 *   - leaf  : a single tile that can be assigned a media folder.
 *   - split : two children laid out as a row (vertical split / left|right) or
 *             a column (horizontal split / top/bottom), separated by a draggable
 *             divider. `ratio` is the fraction of space given to the first child.
 *
 * Edit mode lets the user carve the surface up by clicking; a live preview
 * follows the cursor so the upcoming split is always visible. Snap + grid make
 * neat, symmetric layouts effortless.
 * ========================================================================== */

const VIDEO_EXTS_HINT = 'mp4, webm, mov, mkv, avi, …';
const LS_KEY = 'lvt.state.v1';

// ---------------------------------------------------------------- DOM handles
const stage = document.getElementById('stage');
const preview = document.getElementById('split-preview');
const gridOverlay = document.getElementById('grid-overlay');
const editHint = document.getElementById('edit-hint');
const editLegend = document.getElementById('edit-legend');
const toast = document.getElementById('toast');
const displayPill = document.getElementById('display-pill');

const btnEdit = document.getElementById('btn-edit');
const btnGrid = document.getElementById('btn-grid');
const btnSnap = document.getElementById('btn-snap');
const btnReset = document.getElementById('btn-reset');
const btnFs = document.getElementById('btn-fs');
const btnFsAll = document.getElementById('btn-fs-all');
const btnMin = document.getElementById('btn-min');
const btnX = document.getElementById('btn-x');
const gridSizeInput = document.getElementById('grid-size');
const gridSizeVal = document.getElementById('grid-size-val');

// ----------------------------------------------------------------- App state
const settings = {
  editMode: false,
  gridOn: false,
  snapOn: false,
  cellSize: 80
};

let uidCounter = 1;
function uid() { return 'n' + (uidCounter++); }

let root = makeLeaf();
let focusedLeaf = null;

// --------------------------------------------------------------- Node helpers
function makeLeaf() {
  return {
    id: uid(),
    kind: 'leaf',
    folder: null,
    files: [],
    index: 0,
    savedIndex: 0,
    el: null,
    refs: null,
    video: null
  };
}

function makeSplit(direction, a, b, ratio) {
  return {
    id: uid(),
    kind: 'split',
    direction: direction === 'row' ? 'row' : 'col',
    ratio: clamp(ratio == null ? 0.5 : ratio, 0.05, 0.95),
    children: [a, b]
  };
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function findParent(node, target, parent = null) {
  if (node === target) return parent;
  if (node.kind !== 'split') return undefined;
  for (const child of node.children) {
    const found = findParent(child, target, node);
    if (found !== undefined) return found;
  }
  return undefined;
}

function forEachLeaf(node, fn) {
  if (node.kind === 'leaf') { fn(node); return; }
  node.children.forEach((c) => forEachLeaf(c, fn));
}

// ============================================================================
// Rendering
// ============================================================================
function render() {
  // Detach leaf elements (they're cached) before clearing containers so their
  // <video> playback survives a re-layout.
  forEachLeaf(root, (leaf) => { if (leaf.el && leaf.el.parentNode) leaf.el.parentNode.removeChild(leaf.el); });
  stage.textContent = '';
  stage.appendChild(renderNode(root));
  applyFocus();
  saveState();
}

function renderNode(node) {
  if (node.kind === 'leaf') return ensureLeafEl(node);

  const container = document.createElement('div');
  container.className = 'node-split ' + node.direction;
  container.dataset.id = node.id;

  const a = renderNode(node.children[0]);
  const b = renderNode(node.children[1]);

  const pct = clamp(node.ratio, 0.05, 0.95) * 100;
  a.style.flex = `0 0 ${pct}%`;
  b.style.flex = '1 1 0';

  const divider = document.createElement('div');
  divider.className = 'divider';
  divider.addEventListener('mousedown', (e) => startDividerDrag(e, node, container));

  container.appendChild(a);
  container.appendChild(divider);
  container.appendChild(b);
  return container;
}

function ensureLeafEl(leaf) {
  if (leaf.el) return leaf.el;

  const el = document.createElement('div');
  el.className = 'node-leaf';
  el.dataset.id = leaf.id;

  const video = document.createElement('video');
  video.className = 'tile-video';
  video.playsInline = true;
  video.preload = 'metadata';

  const empty = document.createElement('div');
  empty.className = 'tile-empty';
  empty.innerHTML = `
    <div class="big">＋</div>
    <div class="empty-title">No folder assigned</div>
    <div class="empty-sub">Drag a folder here · double-click · or use the button</div>
    <button class="assign" type="button">📁 Choose media folder…</button>
    <div class="empty-formats">Plays random videos on loop · Supports ${VIDEO_EXTS_HINT}</div>`;

  const toolbar = document.createElement('div');
  toolbar.className = 'tile-toolbar';
  toolbar.innerHTML = `
    <button class="folder" title="Assign / change folder">📁</button>
    <button class="prev" title="Previous">⏮</button>
    <button class="play" title="Play / Pause">▶</button>
    <button class="next" title="Next">⏭</button>
    <input class="seek" type="range" min="0" max="1000" value="0" title="Seek" />
    <span class="time">0:00 / 0:00</span>
    <button class="mute" title="Mute">🔊</button>
    <input class="vol" type="range" min="0" max="1" step="0.05" value="1" title="Volume" />
    <span class="title"></span>
    <button class="close" title="Close tile">✕</button>`;

  el.appendChild(video);
  el.appendChild(empty);
  el.appendChild(toolbar);

  const refs = {
    empty,
    assign: empty.querySelector('.assign'),
    toolbar,
    folder: toolbar.querySelector('.folder'),
    prev: toolbar.querySelector('.prev'),
    play: toolbar.querySelector('.play'),
    next: toolbar.querySelector('.next'),
    seek: toolbar.querySelector('.seek'),
    time: toolbar.querySelector('.time'),
    mute: toolbar.querySelector('.mute'),
    vol: toolbar.querySelector('.vol'),
    title: toolbar.querySelector('.title'),
    close: toolbar.querySelector('.close')
  };

  leaf.el = el;
  leaf.video = video;
  leaf.refs = refs;

  wireLeafEvents(leaf);
  updateLeaf(leaf);
  return el;
}

function updateLeaf(leaf) {
  if (!leaf.refs) return;
  const { refs, video } = leaf;
  const hasFiles = leaf.files.length > 0;
  refs.empty.style.display = leaf.folder ? 'none' : 'flex';
  video.style.display = hasFiles ? 'block' : 'none';

  if (leaf.folder && !hasFiles) {
    refs.empty.style.display = 'flex';
    refs.empty.querySelector('div:nth-child(2)').textContent = 'No playable media in folder';
  }

  refs.close.style.display = settings.editMode ? 'inline-block' : 'none';

  const current = hasFiles ? leaf.files[leaf.index] : null;
  refs.title.textContent = current ? `${leaf.index + 1}/${leaf.files.length} · ${current.name}` : '';
}

// ============================================================================
// Leaf event wiring (media + split/focus interactions)
// ============================================================================
function wireLeafEvents(leaf) {
  const { refs, video, el } = leaf;

  refs.assign.addEventListener('click', (e) => { e.stopPropagation(); assignFolder(leaf); });
  refs.folder.addEventListener('click', (e) => { e.stopPropagation(); assignFolder(leaf); });

  refs.play.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(leaf); });
  refs.prev.addEventListener('click', (e) => { e.stopPropagation(); step(leaf, -1); });
  refs.next.addEventListener('click', (e) => { e.stopPropagation(); step(leaf, 1); });
  refs.close.addEventListener('click', (e) => { e.stopPropagation(); closeLeaf(leaf); });

  refs.seek.addEventListener('input', (e) => {
    e.stopPropagation();
    if (video.duration) video.currentTime = (refs.seek.value / 1000) * video.duration;
  });
  refs.vol.addEventListener('input', (e) => {
    e.stopPropagation();
    video.volume = parseFloat(refs.vol.value);
    video.muted = video.volume === 0;
    refs.mute.textContent = video.muted ? '🔇' : '🔊';
  });
  refs.mute.addEventListener('click', (e) => {
    e.stopPropagation();
    video.muted = !video.muted;
    refs.mute.textContent = video.muted ? '🔇' : '🔊';
  });

  // Prevent toolbar interactions from triggering a split.
  refs.toolbar.addEventListener('mousedown', (e) => e.stopPropagation());

  video.addEventListener('play', () => { refs.play.textContent = '⏸'; });
  video.addEventListener('pause', () => { refs.play.textContent = '▶'; });
  video.addEventListener('playing', () => { leaf.errCount = 0; });
  video.addEventListener('timeupdate', () => {
    if (video.duration) {
      refs.seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
      refs.time.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
    }
  });
  // Loop the folder forever in random order; skip past unplayable files.
  video.addEventListener('ended', () => playRandom(leaf));
  video.addEventListener('error', () => recoverLeaf(leaf));

  // Click on the tile body: split (edit mode) or focus (view mode).
  el.addEventListener('click', (e) => {
    if (e.target.closest('.tile-toolbar') || e.target.closest('.tile-empty')) return;
    if (settings.editMode) {
      const s = computeSplit(leaf, e.clientX, e.clientY, e.shiftKey);
      splitLeaf(leaf, s.orientation, s.ratio);
    } else {
      setFocus(leaf);
    }
  });

  // Double-click anywhere on the tile is a fast way to (re)assign a folder.
  el.addEventListener('dblclick', (e) => {
    if (e.target.closest('.tile-toolbar')) return;
    if (settings.editMode) return; // editing uses clicks to split
    assignFolder(leaf);
  });

  // Drag a folder of videos from the OS straight onto a tile to assign it.
  el.addEventListener('dragenter', (e) => { e.preventDefault(); el.classList.add('drop-target'); });
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', (e) => {
    if (e.target === el) el.classList.remove('drop-target');
  });
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drop-target');
    const folder = await resolveDroppedFolder(e);
    if (folder) await loadFolder(leaf, folder, -1, true);
    else showToast('<strong>Drop a folder of videos</strong><span>Drag a folder onto a tile to play it</span>');
  });
}

/** Turn a drop event into the folder path that should feed the tile. */
async function resolveDroppedFolder(e) {
  const dt = e.dataTransfer;
  if (!dt || !dt.files || !dt.files.length) return null;
  const p = window.api.pathForFile(dt.files[0]);
  if (!p) return null;
  return window.api.resolveDir(p);
}

// ============================================================================
// Media
// ============================================================================
async function assignFolder(leaf) {
  const folder = await window.api.pickFolder();
  if (!folder) return;
  // -1 → start on a random video in the folder.
  await loadFolder(leaf, folder, -1, true);
}

async function loadFolder(leaf, folder, index = -1, autoplay = true) {
  const res = await window.api.readFolder(folder);
  leaf.folder = res.folder;
  leaf.files = res.files || [];
  leaf.errCount = 0;
  leaf.userPaused = false;
  if (leaf.files.length === 0) {
    leaf.index = 0;
    loadCurrent(leaf, false);
    updateLeaf(leaf);
    saveState();
    return;
  }
  leaf.index = (index == null || index < 0)
    ? pickRandomIndex(leaf)
    : clamp(index, 0, leaf.files.length - 1);
  loadCurrent(leaf, autoplay);
  updateLeaf(leaf);
  saveState();
}

/** Pick a random file index, avoiding an immediate repeat when possible. */
function pickRandomIndex(leaf) {
  const n = leaf.files.length;
  if (n <= 1) return 0;
  let i;
  do { i = Math.floor(Math.random() * n); } while (i === leaf.index);
  return i;
}

/** Jump to a random video in this tile's folder and keep it playing. */
function playRandom(leaf) {
  if (!leaf.files.length) return;
  leaf.index = pickRandomIndex(leaf);
  leaf.userPaused = false;
  loadCurrent(leaf, true);
  saveState();
}

/** A media error: try another random clip a bounded number of times. */
function recoverLeaf(leaf) {
  if (!leaf.files.length) return;
  leaf.errCount = (leaf.errCount || 0) + 1;
  // Stop retrying if essentially everything in the folder is unplayable.
  if (leaf.errCount > leaf.files.length + 2) return;
  playRandom(leaf);
}

function loadCurrent(leaf, autoplay) {
  const { video } = leaf;
  const current = leaf.files[leaf.index];
  if (!current) { video.removeAttribute('src'); video.load(); return; }
  video.src = current.url;
  video.load();
  if (autoplay) { leaf.userPaused = false; video.play().catch(() => {}); }
  updateLeaf(leaf);
}

function togglePlay(leaf) {
  if (!leaf.files.length) { assignFolder(leaf); return; }
  if (leaf.video.paused) { leaf.userPaused = false; leaf.video.play().catch(() => {}); }
  else { leaf.userPaused = true; leaf.video.pause(); }
}

function step(leaf, dir, autoplay = false) {
  if (!leaf.files.length) return;
  leaf.index = (leaf.index + dir + leaf.files.length) % leaf.files.length;
  loadCurrent(leaf, autoplay || !leaf.video.paused);
  saveState();
}

// Keep every assigned tile playing forever: recover from unexpected pauses,
// errors, or a missed "ended" event so a video is always on screen.
function playbackWatchdog() {
  forEachLeaf(root, (leaf) => {
    const v = leaf.video;
    if (!v || !leaf.files.length || leaf.userPaused) return;
    if (v.error) { recoverLeaf(leaf); return; }
    if (v.ended) { playRandom(leaf); return; }
    if (v.paused && v.readyState >= 2) { v.play().catch(() => {}); }
  });
}
setInterval(playbackWatchdog, 1500);

function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return (h > 0 ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
}

// ============================================================================
// Splitting / closing tiles
// ============================================================================
function computeSplit(leaf, clientX, clientY, shift) {
  const rect = leaf.el.getBoundingClientRect();
  const orientation = shift ? 'horizontal' : 'vertical';
  if (orientation === 'vertical') {
    const localX = snapAxis(clientX, rect.left, rect.width);
    return { orientation, ratio: clamp(localX / rect.width, 0.05, 0.95) };
  }
  const localY = snapAxis(clientY, rect.top, rect.height);
  return { orientation, ratio: clamp(localY / rect.height, 0.05, 0.95) };
}

/** Snap an absolute screen coordinate to the visible grid, return a tile-local offset. */
function snapAxis(client, originEdge, size) {
  let local = client - originEdge;
  if (settings.snapOn && settings.cellSize > 0) {
    const absolute = client;
    const snapped = Math.round(absolute / settings.cellSize) * settings.cellSize;
    local = snapped - originEdge;
  }
  return clamp(local, 0, size);
}

function splitLeaf(leaf, orientation, ratio) {
  const direction = orientation === 'vertical' ? 'row' : 'col';
  const parent = findParent(root, leaf);
  const newLeaf = makeLeaf();
  const split = makeSplit(direction, leaf, newLeaf, ratio);
  if (parent === null) {
    root = split;
  } else if (parent && parent.kind === 'split') {
    const i = parent.children.indexOf(leaf);
    parent.children[i] = split;
  }
  hidePreview();
  render();
}

function closeLeaf(leaf) {
  disposeLeaf(leaf);
  const parent = findParent(root, leaf);
  if (parent === null) {
    // Root tile: just reset it to an empty leaf.
    root = makeLeaf();
  } else if (parent && parent.kind === 'split') {
    const sibling = parent.children[0] === leaf ? parent.children[1] : parent.children[0];
    const grand = findParent(root, parent);
    if (grand === null) root = sibling;
    else if (grand && grand.kind === 'split') {
      const i = grand.children.indexOf(parent);
      grand.children[i] = sibling;
    }
  }
  if (focusedLeaf === leaf) focusedLeaf = null;
  render();
}

function disposeLeaf(leaf) {
  if (leaf.video) {
    try { leaf.video.pause(); leaf.video.removeAttribute('src'); leaf.video.load(); } catch (_) {}
  }
}

// ============================================================================
// Divider resizing
// ============================================================================
function startDividerDrag(e, node, container) {
  e.preventDefault();
  e.stopPropagation();
  const divider = e.currentTarget;
  divider.classList.add('dragging');
  const horizontal = node.direction === 'row';
  const firstChild = container.children[0];

  function onMove(ev) {
    const rect = container.getBoundingClientRect();
    let ratio;
    if (horizontal) {
      const localX = snapAxis(ev.clientX, rect.left, rect.width);
      ratio = clamp(localX / rect.width, 0.05, 0.95);
    } else {
      const localY = snapAxis(ev.clientY, rect.top, rect.height);
      ratio = clamp(localY / rect.height, 0.05, 0.95);
    }
    node.ratio = ratio;
    firstChild.style.flex = `0 0 ${ratio * 100}%`;
  }
  function onUp() {
    divider.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    saveState();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ============================================================================
// Edit-mode hover preview
// ============================================================================
let lastMouse = { x: 0, y: 0 };

function onGlobalMouseMove(e) {
  lastMouse = { x: e.clientX, y: e.clientY };
  wake();
  if (!settings.editMode) { hidePreview(); return; }
  updatePreview(e.clientX, e.clientY, e.shiftKey);
}

function updatePreview(x, y, shift) {
  const leafEl = document.elementFromPoint(x, y);
  const tile = leafEl && leafEl.closest && leafEl.closest('.node-leaf');
  if (!tile || (leafEl.closest && (leafEl.closest('.tile-toolbar') || leafEl.closest('.divider')))) {
    hidePreview();
    return;
  }
  const leaf = leafById(tile.dataset.id);
  if (!leaf) { hidePreview(); return; }

  const rect = tile.getBoundingClientRect();
  preview.style.left = rect.left + 'px';
  preview.style.top = rect.top + 'px';
  preview.style.width = rect.width + 'px';
  preview.style.height = rect.height + 'px';
  preview.classList.add('visible');

  const line = preview.querySelector('.split-line');
  const badge = preview.querySelector('.split-badge');
  const regionA = preview.querySelector('.region-a');
  const regionB = preview.querySelector('.region-b');
  const labelA = regionA.querySelector('.region-label');
  const labelB = regionB.querySelector('.region-label');

  if (shift) {
    preview.classList.add('horizontal');
    preview.classList.remove('vertical');
    const localY = snapAxis(y, rect.top, rect.height);
    const pct = clamp(localY / rect.height, 0.05, 0.95);
    const aPct = Math.round(pct * 100);

    line.style.top = localY + 'px';
    line.style.left = '';

    setRegion(regionA, { left: '0', right: '0', top: '0', bottom: 'auto', width: 'auto', height: localY + 'px' });
    setRegion(regionB, { left: '0', right: '0', top: localY + 'px', bottom: '0', width: 'auto', height: 'auto' });
    labelA.textContent = 'Keeps this tile · ' + aPct + '%';
    labelB.textContent = 'New empty tile · ' + (100 - aPct) + '%';

    badge.textContent = '▬ Horizontal split → top / bottom';
    badge.style.left = (rect.width / 2) + 'px';
    badge.style.top = localY + 'px';
  } else {
    preview.classList.add('vertical');
    preview.classList.remove('horizontal');
    const localX = snapAxis(x, rect.left, rect.width);
    const pct = clamp(localX / rect.width, 0.05, 0.95);
    const aPct = Math.round(pct * 100);

    line.style.left = localX + 'px';
    line.style.top = '';

    setRegion(regionA, { left: '0', top: '0', bottom: '0', right: 'auto', width: localX + 'px', height: 'auto' });
    setRegion(regionB, { left: localX + 'px', top: '0', bottom: '0', right: '0', width: 'auto', height: 'auto' });
    labelA.textContent = 'Keeps this tile · ' + aPct + '%';
    labelB.textContent = 'New empty tile · ' + (100 - aPct) + '%';

    badge.textContent = '▮ Vertical split → left | right · hold ⇧Shift for horizontal';
    badge.style.left = localX + 'px';
    badge.style.top = '24px';
  }
}

function setRegion(el, props) {
  for (const k in props) el.style[k] = props[k];
}

function hidePreview() {
  preview.classList.remove('visible', 'vertical', 'horizontal');
}

function leafById(id) {
  let found = null;
  forEachLeaf(root, (l) => { if (l.id === id) found = l; });
  return found;
}

// ============================================================================
// Focus
// ============================================================================
function setFocus(leaf) {
  focusedLeaf = leaf;
  applyFocus();
}
function applyFocus() {
  forEachLeaf(root, (l) => {
    if (l.el) l.el.classList.toggle('focused', l === focusedLeaf);
  });
}

// ============================================================================
// Settings toggles
// ============================================================================
function setEditMode(on) {
  settings.editMode = on;
  document.body.classList.toggle('editing', on);
  btnEdit.classList.toggle('active', on);
  if (!on) hidePreview();
  forEachLeaf(root, updateLeaf);
  if (editLegend) editLegend.classList.toggle('show', on);
  if (on) {
    editHint.classList.add('show');
    clearTimeout(setEditMode._t);
    setEditMode._t = setTimeout(() => editHint.classList.remove('show'), 4000);
  } else {
    editHint.classList.remove('show');
  }
  saveState();
}

function setGrid(on) {
  settings.gridOn = on;
  document.body.classList.toggle('grid-on', on);
  btnGrid.classList.toggle('active', on);
  saveState();
}

function setSnap(on) {
  settings.snapOn = on;
  btnSnap.classList.toggle('active', on);
  saveState();
}

function setCellSize(px) {
  settings.cellSize = px;
  document.documentElement.style.setProperty('--cell', px + 'px');
  gridOverlay.style.setProperty('--cell', px + 'px');
  gridSizeInput.value = String(px);
  gridSizeVal.textContent = String(px);
  saveState();
}

// ============================================================================
// Persistence
// ============================================================================
function serialize(node) {
  if (node.kind === 'leaf') return { kind: 'leaf', folder: node.folder, index: node.index };
  return {
    kind: 'split',
    direction: node.direction,
    ratio: node.ratio,
    children: [serialize(node.children[0]), serialize(node.children[1])]
  };
}

function deserialize(obj) {
  if (!obj) return makeLeaf();
  if (obj.kind === 'leaf') {
    const l = makeLeaf();
    l.folder = obj.folder || null;
    l.savedIndex = obj.index || 0;
    return l;
  }
  return makeSplit(obj.direction, deserialize(obj.children[0]), deserialize(obj.children[1]), obj.ratio);
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ settings, tree: serialize(root) }));
    } catch (_) {}
  }, 200);
}

function loadState() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) {}
  if (data && data.settings) {
    Object.assign(settings, data.settings);
  }
  if (data && data.tree) {
    root = deserialize(data.tree);
  }
  // Apply settings to UI.
  setCellSize(settings.cellSize || 80);
  setGrid(!!settings.gridOn);
  setSnap(!!settings.snapOn);
  setEditMode(!!settings.editMode);

  render();

  // Repopulate media for any leaf that had a folder assigned, resuming on a
  // random clip so playback is always running after a restart.
  forEachLeaf(root, (leaf) => {
    if (leaf.folder) loadFolder(leaf, leaf.folder, -1, true);
  });
}

// ============================================================================
// Idle / minimal-UI auto hide
// ============================================================================
let idleTimer = null;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!settings.editMode) document.body.classList.add('idle');
  }, 2800);
}

// ============================================================================
// Displays / window state
// ============================================================================
async function refreshDisplays() {
  try {
    const info = await window.api.getDisplayInfo();
    displayPill.textContent = info.count + (info.count === 1 ? ' display' : ' displays');
    displayPill.title = info.displays
      .map((d) => `${d.isPrimary ? '★ ' : ''}${d.bounds.width}×${d.bounds.height}`)
      .join('  ·  ');
  } catch (_) {}
}

// ============================================================================
// Global event wiring
// ============================================================================
function isTypingTarget(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

document.addEventListener('mousemove', onGlobalMouseMove);
document.addEventListener('mousedown', wake);

// Prevent the window from navigating to a file when a drop misses a tile.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  wake();
  if (e.key === 'Shift' && settings.editMode) updatePreview(lastMouse.x, lastMouse.y, true);
  if (isTypingTarget(e.target)) return;

  switch (e.key.toLowerCase()) {
    case 'e': setEditMode(!settings.editMode); break;
    case 'g': setGrid(!settings.gridOn); break;
    case 's': setSnap(!settings.snapOn); break;
    case 'f': window.api.toggleFullscreen(); break;
    case 'a': window.api.toggleSpanAll(); break;
    case ' ':
      if (focusedLeaf) { e.preventDefault(); togglePlay(focusedLeaf); }
      break;
    case 'escape':
      if (settings.editMode) setEditMode(false);
      break;
    default: break;
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'Shift' && settings.editMode) updatePreview(lastMouse.x, lastMouse.y, false);
});

btnEdit.addEventListener('click', () => setEditMode(!settings.editMode));
btnGrid.addEventListener('click', () => setGrid(!settings.gridOn));
btnSnap.addEventListener('click', () => setSnap(!settings.snapOn));
btnReset.addEventListener('click', () => {
  forEachLeaf(root, disposeLeaf);
  root = makeLeaf();
  focusedLeaf = null;
  render();
});
btnFs.addEventListener('click', () => window.api.toggleFullscreen());
btnFsAll.addEventListener('click', () => window.api.toggleSpanAll());
btnMin.addEventListener('click', () => window.api.minimize());
btnX.addEventListener('click', () => window.api.close());
gridSizeInput.addEventListener('input', () => setCellSize(parseInt(gridSizeInput.value, 10)));

function applyWindowState(state) {
  btnFs.classList.toggle('active', state.fullScreen);
  btnFsAll.classList.toggle('active', state.spanningAllDisplays);
  document.body.classList.toggle('span-all', !!state.spanningAllDisplays);

  const rootStyle = document.documentElement.style;
  const wasSpanning = document.body.dataset.spanning === '1';
  if (state.spanningAllDisplays && state.windowBounds && state.primaryBounds) {
    // Offset of the primary display inside the (multi-monitor) window so the
    // chrome is always drawn on a real, fully-visible screen.
    const left = state.primaryBounds.x - state.windowBounds.x;
    const top = state.primaryBounds.y - state.windowBounds.y;
    rootStyle.setProperty('--ui-left', left + 'px');
    rootStyle.setProperty('--ui-top', Math.max(0, top) + 'px');
    rootStyle.setProperty('--ui-width', state.primaryBounds.width + 'px');
    document.body.dataset.spanning = '1';
    // Surface the chrome immediately so the user can see where controls went.
    wake();
    if (!wasSpanning) spanToast(state.displayCount);
  } else {
    rootStyle.removeProperty('--ui-left');
    rootStyle.removeProperty('--ui-top');
    rootStyle.removeProperty('--ui-width');
    document.body.dataset.spanning = '0';
  }
}

let spanToastTimer = null;
function showToast(html, ms = 3000) {
  toast.innerHTML = html;
  toast.classList.add('show');
  clearTimeout(spanToastTimer);
  spanToastTimer = setTimeout(() => toast.classList.remove('show'), ms);
}
function spanToast(count) {
  showToast(
    '<strong>Spanning ' + (count || 'all') + ' displays</strong>' +
    '<span>Controls &amp; edit tools are on your primary display · <kbd>A</kbd> to exit · <kbd>E</kbd> to edit tiles</span>',
    5000
  );
}

window.api.onWindowState(applyWindowState);
window.api.onDisplayChanged(() => refreshDisplays());

window.addEventListener('resize', () => { if (settings.editMode) hidePreview(); });

// ----------------------------------------------------------------- Boot
loadState();
refreshDisplays();
window.api.requestWindowState();
wake();
