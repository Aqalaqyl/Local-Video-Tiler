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
    <div>No folder assigned</div>
    <div style="font-size:11px;opacity:0.7">Supported: ${VIDEO_EXTS_HINT}</div>
    <button class="assign" type="button">Choose media folder…</button>`;

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
  video.addEventListener('timeupdate', () => {
    if (video.duration) {
      refs.seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
      refs.time.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
    }
  });
  video.addEventListener('ended', () => step(leaf, 1, true));

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
}

// ============================================================================
// Media
// ============================================================================
async function assignFolder(leaf) {
  const folder = await window.api.pickFolder();
  if (!folder) return;
  await loadFolder(leaf, folder, 0, true);
}

async function loadFolder(leaf, folder, index = 0, autoplay = false) {
  const res = await window.api.readFolder(folder);
  leaf.folder = res.folder;
  leaf.files = res.files || [];
  leaf.index = clamp(index, 0, Math.max(0, leaf.files.length - 1));
  loadCurrent(leaf, autoplay);
  updateLeaf(leaf);
  saveState();
}

function loadCurrent(leaf, autoplay) {
  const { video } = leaf;
  const current = leaf.files[leaf.index];
  if (!current) { video.removeAttribute('src'); video.load(); return; }
  video.src = current.url;
  video.load();
  if (autoplay) video.play().catch(() => {});
  updateLeaf(leaf);
}

function togglePlay(leaf) {
  if (!leaf.files.length) { assignFolder(leaf); return; }
  if (leaf.video.paused) leaf.video.play().catch(() => {});
  else leaf.video.pause();
}

function step(leaf, dir, autoplay = false) {
  if (!leaf.files.length) return;
  leaf.index = (leaf.index + dir + leaf.files.length) % leaf.files.length;
  loadCurrent(leaf, autoplay || !leaf.video.paused);
  saveState();
}

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
  if (shift) {
    preview.classList.add('horizontal');
    preview.classList.remove('vertical');
    const localY = snapAxis(y, rect.top, rect.height);
    line.style.top = localY + 'px';
    line.style.left = '';
  } else {
    preview.classList.add('vertical');
    preview.classList.remove('horizontal');
    const localX = snapAxis(x, rect.left, rect.width);
    line.style.left = localX + 'px';
    line.style.top = '';
  }
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

  // Repopulate media for any leaf that had a folder assigned.
  forEachLeaf(root, (leaf) => {
    if (leaf.folder) loadFolder(leaf, leaf.folder, leaf.savedIndex || 0, false);
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

window.api.onWindowState((state) => {
  btnFs.classList.toggle('active', state.fullScreen);
  btnFsAll.classList.toggle('active', state.spanningAllDisplays);
});
window.api.onDisplayChanged(() => refreshDisplays());

window.addEventListener('resize', () => { if (settings.editMode) hidePreview(); });

// ----------------------------------------------------------------- Boot
loadState();
refreshDisplays();
window.api.requestWindowState();
wake();
