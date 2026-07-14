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
const PRESETS_KEY = 'lvt.presets.v1';

// ---------------------------------------------------------------- DOM handles
const stage = document.getElementById('stage');
const topbar = document.getElementById('topbar');
const preview = document.getElementById('split-preview');
const gridOverlay = document.getElementById('grid-overlay');
const displayGuide = document.getElementById('display-guide');
const editHint = document.getElementById('edit-hint');
const toast = document.getElementById('toast');
const displayPill = document.getElementById('display-pill');

const btnEdit = document.getElementById('btn-edit');
const btnGrid = document.getElementById('btn-grid');
const btnSnap = document.getElementById('btn-snap');
const btnReset = document.getElementById('btn-reset');
const btnFs = document.getElementById('btn-fs');
const btnFsAll = document.getElementById('btn-fs-all');
const btnGuide = document.getElementById('btn-guide');
const btnTileDisplays = document.getElementById('btn-tile-displays');
const btnAssign = document.getElementById('btn-assign');
const btnPresets = document.getElementById('btn-presets');
const presetsPanel = document.getElementById('presets-panel');
const presetsList = document.getElementById('presets-list');
const btnPresetSave = document.getElementById('btn-preset-save');
const presetNameInput = document.getElementById('preset-name');
const btnMin = document.getElementById('btn-min');
const btnX = document.getElementById('btn-x');
const gridSizeInput = document.getElementById('grid-size');
const gridSizeVal = document.getElementById('grid-size-val');

// ----------------------------------------------------------------- App state
const settings = {
  editMode: false,
  gridOn: false,
  snapOn: false,
  cellSize: 80,
  guideOn: false
};

// Latest window/display geometry pushed from the main process. Used to draw the
// screen-split guide and to build a layout that matches the physical displays.
let winState = {
  fullScreen: false,
  spanningAllDisplays: false,
  windowBounds: null,
  displays: []
};

// ---------------------------------------------------------- Projection / wall
// When spanning all displays, each monitor is covered by its own fullscreen
// window. EVERY window is a full peer editor: it renders its display's slice of
// the shared canvas, shows the grid + split preview, and lets you split / resize
// / delete tiles right on that screen. Edits are broadcast so every display (and
// the persisted layout on the controller) stays in sync. The whole canvas is
// sized to the union of all displays and each window is shifted to show its slice.
const projection = {
  active: false,
  role: 'controller',
  viewport: null,
  union: null
};

const IS_MIRROR = new URLSearchParams(location.search).get('role') === 'mirror';

// Guards against echo loops when applying a layout pushed from another window.
let applyingRemote = false;
let lastSyncJSON = '';

function readProjectionQuery() {
  const p = new URLSearchParams(location.search);
  if (p.get('role') !== 'mirror') return;
  projection.active = true;
  projection.role = 'mirror';
  projection.viewport = { x: +p.get('vx'), y: +p.get('vy'), width: +p.get('vw'), height: +p.get('vh') };
  projection.union = { x: +p.get('ux'), y: +p.get('uy'), width: +p.get('uw'), height: +p.get('uh') };
}

// Offset of this window's slice within the global canvas, per axis. Used to keep
// the grid + snapping aligned to the SAME global grid across every display.
function projOffX() {
  return (projection.active && projection.viewport && projection.union) ? projection.viewport.x - projection.union.x : 0;
}
function projOffY() {
  return (projection.active && projection.viewport && projection.union) ? projection.viewport.y - projection.union.y : 0;
}

/** Position the stage AND the grid so this window shows only its slice of the canvas. */
function applyProjection() {
  const on = projection.active && projection.viewport && projection.union;
  document.body.classList.toggle('projection', !!on);
  document.body.classList.toggle('mirror', !!on && projection.role === 'mirror');
  document.body.classList.toggle('controller', !!on && projection.role === 'controller');
  // The grid overlay moves with the stage so its lines stay continuous across
  // every display instead of restarting at each window's edge.
  const layers = [stage, gridOverlay];
  if (on) {
    const offX = projOffX();
    const offY = projOffY();
    const vw = projection.viewport.width;
    const vh = projection.viewport.height;
    const clip = `inset(${offY}px ${projection.union.width - offX - vw}px ${projection.union.height - offY - vh}px ${offX}px)`;
    for (const el of layers) {
      el.style.left = (-offX) + 'px';
      el.style.top = (-offY) + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.width = projection.union.width + 'px';
      el.style.height = projection.union.height + 'px';
      el.style.clipPath = clip;
    }
  } else {
    for (const el of layers) {
      el.style.left = '';
      el.style.top = '';
      el.style.right = '';
      el.style.bottom = '';
      el.style.width = '';
      el.style.height = '';
      el.style.clipPath = '';
    }
  }
  scheduleProjectionPlayback();
}

let projectionPlaybackRaf = 0;
/** Defer playback reconciliation until after projection layout has settled. */
function scheduleProjectionPlayback() {
  cancelAnimationFrame(projectionPlaybackRaf);
  projectionPlaybackRaf = requestAnimationFrame(() => {
    projectionPlaybackRaf = requestAnimationFrame(reconcileProjectionPlayback);
  });
}

function isLeafVisible(leaf) {
  if (!leaf.el) return false;
  const r = leaf.el.getBoundingClientRect();
  return r.right > 1 && r.bottom > 1 && r.left < window.innerWidth - 1 && r.top < window.innerHeight - 1;
}

function videoSourceUrl(video) {
  if (!video) return '';
  return video.currentSrc || video.getAttribute('src') || '';
}

function sourcesMatch(video, url) {
  if (!url) return !videoSourceUrl(video);
  const loaded = videoSourceUrl(video);
  if (!loaded) return false;
  try { return loaded === new URL(url, window.location.href).href; } catch (_) { return loaded === url; }
}

/**
 * While projecting across displays, each window only decodes/plays tiles that
 * fall on its own slice. Mirrors are always muted; the controller keeps audio
 * only for tiles visible on the primary display.
 */
function reconcileProjectionPlayback() {
  if (!projection.active) return;
  forEachLeaf(root, (leaf) => {
    if (leaf.spacer || !leaf.video) return;
    if (!leaf.files.length) return;

    const visible = isLeafVisible(leaf);
    const cur = leaf.files[leaf.index];
    const wasPlaying = !leaf.video.paused && !leaf.video.ended;

    if (visible) {
      if (cur && !sourcesMatch(leaf.video, cur.url)) {
        loadCurrent(leaf, wasPlaying);
      } else {
        applyTileAudio(leaf);
        leaf.video.loop = !!leaf.loop;
        if (wasPlaying) leaf.video.play().catch(() => {});
        else leaf.video.pause();
      }
    } else {
      pauseVideoElement(leaf.video);
    }
  });
}

function pauseVideoElement(video) {
  if (!video) return;
  try { video.pause(); } catch (_) { /* ignore */ }
}

function stopVideoElement(video) {
  if (!video) return;
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch (_) { /* ignore */ }
}

/** Apply per-tile volume/mute to the live <video>, respecting projection mirrors. */
function applyTileAudio(leaf) {
  if (!leaf.video) return;
  const vol = clamp(leaf.volume == null ? 1 : leaf.volume, 0, 1);
  leaf.volume = vol;
  if (projection.active && projection.role === 'mirror') {
    leaf.video.muted = true;
    return;
  }
  leaf.video.volume = vol;
  leaf.video.muted = !!leaf.muted || vol === 0;
  if (leaf.refs) {
    leaf.refs.vol.value = String(vol);
    leaf.refs.mute.textContent = leaf.video.muted ? '🔇' : '🔊';
  }
}

function setTileVolume(leaf, volume, opts = {}) {
  if (!leaf) return;
  leaf.volume = clamp(volume, 0, 1);
  if (leaf.volume > 0 && !opts.keepMuted) leaf.muted = false;
  applyTileAudio(leaf);
  if (!opts.skipSave) saveState();
}

function adjustTileVolume(leaf, delta) {
  setTileVolume(leaf, (leaf.volume == null ? 1 : leaf.volume) + delta);
}

function snapshotSettings() {
  return { editMode: settings.editMode, gridOn: settings.gridOn, snapOn: settings.snapOn, cellSize: settings.cellSize };
}

function applySettingsFromPayload(s) {
  if (!s) return;
  if (s.cellSize != null && s.cellSize !== settings.cellSize) setCellSize(s.cellSize);
  if (!!s.gridOn !== settings.gridOn) setGrid(!!s.gridOn);
  if (!!s.snapOn !== settings.snapOn) setSnap(!!s.snapOn);
  if (!!s.editMode !== settings.editMode) setEditMode(!!s.editMode);
}

// Push the current layout + settings to peer windows (deduped to avoid echoes).
function broadcastLayout() {
  if (!projection.active) return;
  const payload = { tree: serializeForSync(root), settings: snapshotSettings() };
  const json = JSON.stringify(payload);
  if (json === lastSyncJSON) return;
  lastSyncJSON = json;
  try { window.api.pushLayout(payload); } catch (_) { /* ignore */ }
}

// Apply a layout pushed from another window onto this display's slice.
// Reconciles against the existing tree, REUSING leaves (and their live <video>
// playback) that still have the same folder, so an edit on another display
// (split / delete / resize) doesn't restart the videos already playing here.
function applyIncomingLayout(payload) {
  if (!payload) return;
  const json = JSON.stringify({ tree: payload.tree, settings: payload.settings });
  if (json === lastSyncJSON) return;
  lastSyncJSON = json;
  applyingRemote = true;
  try {
    applySettingsFromPayload(payload.settings);

    const pool = [];
    forEachLeaf(root, (l) => pool.push(l));
    const used = new Set();
    const takeLeaf = (folder, spacer) => {
      const want = folder || null;
      for (const l of pool) {
        if (!used.has(l) && !!l.spacer === !!spacer && (l.folder || null) === want) {
          used.add(l); return l;
        }
      }
      if (spacer) return makeSpacerLeaf();
      return null;
    };
    const build = (node) => {
      if (!node || node.kind === 'leaf') {
        const folder = node ? (node.folder || null) : null;
        const spacer = node ? !!node.spacer : false;
        const leaf = takeLeaf(folder, spacer) || makeLeaf();
        leaf.folder = folder;
        leaf.loop = node ? !!node.loop : false;
        leaf.spacer = spacer;
        if (node) {
          if (typeof node.volume === 'number') leaf.volume = clamp(node.volume, 0, 1);
          if (node.muted != null) leaf.muted = !!node.muted;
        }
        if (leaf.el) leaf.el.classList.toggle('pad-spacer', spacer);
        applyTileAudio(leaf);
        return leaf;
      }
      return makeSplit(node.direction, build(node.children[0]), build(node.children[1]), node.ratio);
    };

    const newRoot = build(payload.tree);
    // Tiles that no longer exist get torn down; reused ones keep playing.
    for (const l of pool) { if (!used.has(l)) disposeLeaf(l); }
    root = newRoot;
    focusedLeaf = null;
    selectedLeaves.clear();
    render();
    // Start media only for brand-new tiles; reused tiles are already playing.
    forEachLeaf(root, (leaf) => {
      if (leaf.folder && leaf.files.length === 0) {
        loadFolder(leaf, leaf.folder, 0, false).then(() => advanceRandom(leaf));
      }
    });
    applyProjection();
  } finally {
    applyingRemote = false;
  }
}

// Receive projection config from the main process (controller window).
function projectionViewportKey(config) {
  if (!config || !config.active) return '';
  const v = config.viewport || {};
  const u = config.union || {};
  return [
    config.role || '',
    v.x, v.y, v.width, v.height,
    u.x, u.y, u.width, u.height
  ].join('|');
}

function setProjection(config) {
  if (!config || !config.active) {
    projection.active = false;
    projection.role = 'controller';
    projection.viewport = null;
    projection.union = null;
    applyProjection();
    forEachLeaf(root, (leaf) => { if (!leaf.spacer) applyTileAudio(leaf); });
    renderDisplayGuide();
    return;
  }
  const prevKey = projectionViewportKey({
    active: true,
    role: projection.role,
    viewport: projection.viewport,
    union: projection.union
  });
  projection.active = true;
  projection.role = config.role || 'controller';
  projection.viewport = config.viewport;
  projection.union = config.union;
  applyProjection();
  renderDisplayGuide();
  if (projectionViewportKey(config) !== prevKey) {
    lastSyncJSON = '';
    broadcastLayout();
  }
}

function bootMirror() {
  readProjectionQuery();
  document.body.classList.add('mirror');
  applyProjection();
  window.api.onLayout(applyIncomingLayout);
  // The controller may re-broadcast this window's viewport (e.g. display change).
  window.api.onProjection((config) => {
    if (config && config.active && config.role === 'mirror') {
      projection.viewport = config.viewport;
      projection.union = config.union;
      applyProjection();
    }
  });
  window.api.requestLayout();
}

let uidCounter = 1;
function uid() { return 'n' + (uidCounter++); }

let root = makeLeaf();
let focusedLeaf = null;
/** @type {Set<object>} Tiles chosen for batch folder assignment (Ctrl/Cmd+click). */
const selectedLeaves = new Set();

// --------------------------------------------------------------- Node helpers
function makeLeaf() {
  return {
    id: uid(),
    kind: 'leaf',
    folder: null,
    files: [],
    index: 0,
    savedIndex: 0,
    loop: false,
    spacer: false,
    volume: 1,
    muted: false,
    el: null,
    refs: null,
    video: null
  };
}

function makeSpacerLeaf() {
  const l = makeLeaf();
  l.spacer = true;
  return l;
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
  applySelection();
  if (projection.active) applyProjection();
  positionTileBadges();
  saveState();
}

/**
 * Keep each tile's delete/close badge clear of the top control bar so it stays
 * clickable even while the UI is open (the bar otherwise covers the top-row
 * tiles' top-right corner).
 */
function positionTileBadges() {
  if (IS_MIRROR || !topbar) return;
  const cs = getComputedStyle(topbar);
  // The bar slides in/out via a CSS transform, so use its layout box (top +
  // offsetHeight) rather than getBoundingClientRect (which reflects the
  // mid-transition transform) to know where it really sits.
  const barShown = cs.display !== 'none' &&
    !(document.body.classList.contains('idle') && !document.body.classList.contains('editing'));
  const barBottom = barShown ? (parseFloat(cs.top) || 0) + topbar.offsetHeight : 0;
  forEachLeaf(root, (leaf) => {
    if (!leaf.refs || !leaf.refs.del || !leaf.el) return;
    const tileTop = leaf.el.getBoundingClientRect().top;
    leaf.refs.del.style.top = Math.max(8, Math.round(barBottom - tileTop) + 8) + 'px';
  });
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
  el.className = 'node-leaf' + (leaf.spacer ? ' pad-spacer' : '');
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
    <button class="folder" title="Assign / change folder — Ctrl+click tiles to select several first">📁</button>
    <button class="prev" title="Previous">⏮</button>
    <button class="play" title="Play / Pause">▶</button>
    <button class="next" title="Next">⏭</button>
    <button class="loop" title="Loop this video (per tile)">🔁</button>
    <button class="trash" title="Delete current video from disk">🗑</button>
    <input class="seek" type="range" min="0" max="1000" value="0" title="Seek" />
    <span class="time">0:00 / 0:00</span>
    <button class="mute" title="Mute">🔊</button>
    <input class="vol" type="range" min="0" max="1" step="0.05" value="1" title="Volume (scroll wheel over tile)" />
    <span class="title"></span>
    <button class="close" title="Close tile">✕</button>`;

  // A always-visible delete badge (only while editing) so removing a mistaken
  // tile is obvious without having to hover the media toolbar first.
  const del = document.createElement('button');
  del.className = 'tile-del';
  del.type = 'button';
  del.title = 'Delete this tile (Del)';
  del.textContent = '🗑';

  el.appendChild(video);
  el.appendChild(empty);
  el.appendChild(toolbar);
  el.appendChild(del);

  const refs = {
    empty,
    assign: empty.querySelector('.assign'),
    toolbar,
    folder: toolbar.querySelector('.folder'),
    prev: toolbar.querySelector('.prev'),
    play: toolbar.querySelector('.play'),
    next: toolbar.querySelector('.next'),
    loop: toolbar.querySelector('.loop'),
    trash: toolbar.querySelector('.trash'),
    seek: toolbar.querySelector('.seek'),
    time: toolbar.querySelector('.time'),
    mute: toolbar.querySelector('.mute'),
    vol: toolbar.querySelector('.vol'),
    title: toolbar.querySelector('.title'),
    close: toolbar.querySelector('.close'),
    del
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
  if (refs.trash) refs.trash.disabled = !hasFiles;
  applyLoop(leaf);

  const current = hasFiles ? leaf.files[leaf.index] : null;
  refs.title.textContent = current ? `${leaf.index + 1}/${leaf.files.length} · ${current.name}` : '';
  applyTileAudio(leaf);
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
  refs.loop.addEventListener('click', (e) => { e.stopPropagation(); toggleLoop(leaf); });
  refs.trash.addEventListener('click', (e) => { e.stopPropagation(); deleteCurrentVideo(leaf); });
  refs.close.addEventListener('click', (e) => { e.stopPropagation(); closeLeaf(leaf); });
  refs.del.addEventListener('mousedown', (e) => e.stopPropagation());
  refs.del.addEventListener('click', (e) => { e.stopPropagation(); closeLeaf(leaf); flash('Tile deleted'); });

  refs.seek.addEventListener('input', (e) => {
    e.stopPropagation();
    if (video.duration) video.currentTime = (refs.seek.value / 1000) * video.duration;
  });
  refs.vol.addEventListener('input', (e) => {
    e.stopPropagation();
    setTileVolume(leaf, parseFloat(refs.vol.value));
  });
  refs.mute.addEventListener('click', (e) => {
    e.stopPropagation();
    leaf.muted = !leaf.muted;
    applyTileAudio(leaf);
    saveState();
  });

  el.addEventListener('wheel', (e) => {
    if (leaf.spacer || !leaf.files.length) return;
    if (e.target.closest('.tile-toolbar')) return;
    e.preventDefault();
    const step = e.shiftKey ? 0.01 : 0.05;
    adjustTileVolume(leaf, e.deltaY < 0 ? step : -step);
  }, { passive: false });

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
  // When a clip ends (and the tile isn't looping), shuffle to a random clip.
  video.addEventListener('ended', () => advanceRandom(leaf));

  // Click on the tile body: split (edit mode) or focus (view mode).
  // Note: the toolbar buttons and the "Choose media folder…" / 📁 buttons all
  // call stopPropagation, so they never reach here. We must NOT bail out on the
  // empty-state placeholder itself — otherwise a freshly-created (folder-less)
  // tile, whose placeholder covers its whole body, could never be split.
  el.addEventListener('click', (e) => {
    if (leaf.spacer) return;
    if (e.target.closest('.tile-toolbar')) return;
    if (isMultiSelectModifier(e)) {
      toggleSelection(leaf);
      return;
    }
    if (settings.editMode) {
      const s = computeSplit(leaf, e.clientX, e.clientY, e.shiftKey);
      splitLeaf(leaf, s.orientation, s.ratio);
    } else {
      setSelectionSingle(leaf);
    }
  });
}

// ============================================================================
// Media
// ============================================================================
function isMultiSelectModifier(e) {
  return !!(e && (e.ctrlKey || e.metaKey));
}

function pruneSelection() {
  const live = new Set();
  forEachLeaf(root, (l) => live.add(l));
  for (const l of selectedLeaves) {
    if (!live.has(l)) selectedLeaves.delete(l);
  }
}

function getAssignmentTargets(leaf) {
  pruneSelection();
  if (selectedLeaves.size > 0) return [...selectedLeaves];
  return leaf ? [leaf] : [];
}

async function assignFolder(leaf) {
  const targets = getAssignmentTargets(leaf);
  if (!targets.length) return;
  const folder = await window.api.pickFolder();
  if (!folder) return;
  for (const t of targets) {
    await loadFolder(t, folder, 0, false);
    advanceRandom(t, true);
  }
  if (targets.length > 1) {
    flash(`Assigned folder to ${targets.length} tiles`);
    clearSelection();
  }
}

async function assignFolderToSelection() {
  const targets = getAssignmentTargets(null);
  if (!targets.length) {
    flash('Ctrl+click tiles to select them, then assign a folder');
    return;
  }
  const folder = await window.api.pickFolder();
  if (!folder) return;
  for (const t of targets) {
    await loadFolder(t, folder, 0, false);
    advanceRandom(t, true);
  }
  flash(`Assigned folder to ${targets.length} tile${targets.length === 1 ? '' : 's'}`);
  clearSelection();
}

/** Permanently delete the currently playing video from disk and advance. */
async function deleteCurrentVideo(leaf) {
  if (!leaf || !leaf.files.length || !leaf.folder) {
    flash('No video to delete');
    return;
  }
  const current = leaf.files[leaf.index];
  if (!current || !current.path) {
    flash('No video to delete');
    return;
  }
  const res = await window.api.deleteFile(current.path, leaf.folder);
  if (!res || res.cancelled) return;
  if (!res.ok) {
    flash(res.error || 'Could not delete video');
    return;
  }

  const removedPath = current.path;
  leaf.files = leaf.files.filter((f) => f.path !== removedPath);
  if (leaf.index >= leaf.files.length) leaf.index = Math.max(0, leaf.files.length - 1);

  if (leaf.files.length > 0) {
    leaf.userPaused = false;
    loadCurrent(leaf, true);
    flash('Deleted ' + current.name);
  } else {
    stopVideoElement(leaf.video);
    updateLeaf(leaf);
    flash('Deleted ' + current.name + ' — folder empty');
  }
  saveState();
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

function loadCurrent(leaf, autoplay, opts = {}) {
  const { video } = leaf;
  if (!video) return;
  const current = leaf.files[leaf.index];
  const visible = opts.force || !projection.active || isLeafVisible(leaf);
  const sameSource = current && sourcesMatch(video, current.url);

  if (!current || !visible) {
    if (!visible && current && !opts.force) pauseVideoElement(video);
    else {
      try {
        video.pause();
        if (video.getAttribute('src')) { video.removeAttribute('src'); video.load(); }
      } catch (_) { /* ignore */ }
    }
    updateLeaf(leaf);
    return;
  }

  if (sameSource) {
    applyTileAudio(leaf);
    video.loop = !!leaf.loop;
    if (autoplay) video.play().catch(() => {});
    else video.pause();
    updateLeaf(leaf);
    return;
  }

  try { video.pause(); } catch (_) { /* ignore */ }
  video.src = current.url;
  video.load();
  video.loop = !!leaf.loop;
  applyTileAudio(leaf);
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

/** Pick a random file index, avoiding an immediate repeat when possible. */
function pickRandomIndex(leaf) {
  const n = leaf.files.length;
  if (n <= 1) return 0;
  let i = leaf.index;
  while (i === leaf.index) i = Math.floor(Math.random() * n);
  return i;
}

/** Auto-advance to a random clip from the folder (the default shuffle playback). */
function advanceRandom(leaf, initial = false) {
  if (!leaf.files.length) return;
  leaf.index = initial ? Math.floor(Math.random() * leaf.files.length) : pickRandomIndex(leaf);
  loadCurrent(leaf, true);
  saveState();
}

/** Per-tile loop toggle: repeat the current clip to keep it on screen. */
function toggleLoop(leaf) {
  leaf.loop = !leaf.loop;
  applyLoop(leaf);
  saveState();
}

function applyLoop(leaf) {
  if (leaf.video) leaf.video.loop = !!leaf.loop;
  if (leaf.refs && leaf.refs.loop) {
    leaf.refs.loop.classList.toggle('active', !!leaf.loop);
    leaf.refs.loop.title = leaf.loop ? 'Looping this video — click to stop' : 'Loop this video (per tile)';
  }
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
    const localX = snapAxis(clientX, rect.left, rect.width, projOffX());
    return { orientation, ratio: clamp(localX / rect.width, 0.05, 0.95) };
  }
  const localY = snapAxis(clientY, rect.top, rect.height, projOffY());
  return { orientation, ratio: clamp(localY / rect.height, 0.05, 0.95) };
}

/**
 * Snap an absolute screen coordinate to the grid and return a tile-local offset.
 * `globalOffset` shifts into the shared canvas coordinate space so snapping (and
 * the visible grid) line up across every display when projecting.
 */
function snapAxis(client, originEdge, size, globalOffset = 0) {
  let local = client - originEdge;
  if (settings.snapOn && settings.cellSize > 0) {
    const g = client + globalOffset;
    const snapped = Math.round(g / settings.cellSize) * settings.cellSize - globalOffset;
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
  if (focusedLeaf === leaf) focusedLeaf = selectedLeaves.size ? [...selectedLeaves].pop() : null;
  selectedLeaves.delete(leaf);
  render();
}

function disposeLeaf(leaf) {
  if (leaf.video) {
    try { leaf.video.pause(); leaf.video.removeAttribute('src'); leaf.video.load(); } catch (_) {}
  }
}

/**
 * Delete the most relevant tile for a keyboard shortcut: the tile under the
 * cursor while editing, otherwise the focused tile. Lets the user quickly undo a
 * mis-click while carving up the layout.
 */
function deleteActiveTile() {
  let target = null;
  if (settings.editMode) {
    const el = document.elementFromPoint(lastMouse.x, lastMouse.y);
    const tile = el && el.closest && el.closest('.node-leaf');
    if (tile) target = leafById(tile.dataset.id);
  }
  if (!target) target = focusedLeaf;
  if (!target) { flash('Hover or click a tile, then press Delete'); return; }
  closeLeaf(target);
  flash('Tile deleted');
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
      const localX = snapAxis(ev.clientX, rect.left, rect.width, projOffX());
      ratio = clamp(localX / rect.width, 0.05, 0.95);
    } else {
      const localY = snapAxis(ev.clientY, rect.top, rect.height, projOffY());
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
  if (!tile || tile.classList.contains('pad-spacer') ||
    (leafEl.closest && (leafEl.closest('.tile-toolbar') || leafEl.closest('.divider')))) {
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
    const localY = snapAxis(y, rect.top, rect.height, projOffY());
    const pct = clamp(localY / rect.height, 0.05, 0.95);
    const aPct = Math.round(pct * 100);

    line.style.top = localY + 'px';
    line.style.left = '';

    setRegion(regionA, { left: '0', right: '0', top: '0', bottom: 'auto', width: 'auto', height: localY + 'px' });
    setRegion(regionB, { left: '0', right: '0', top: localY + 'px', bottom: '0', width: 'auto', height: 'auto' });
    labelA.textContent = aPct + '%';
    labelB.textContent = 'new tile · ' + (100 - aPct) + '%';

    badge.textContent = '▬ Horizontal split (top / bottom)';
    badge.style.left = (rect.width / 2) + 'px';
    badge.style.top = localY + 'px';
  } else {
    preview.classList.add('vertical');
    preview.classList.remove('horizontal');
    const localX = snapAxis(x, rect.left, rect.width, projOffX());
    const pct = clamp(localX / rect.width, 0.05, 0.95);
    const aPct = Math.round(pct * 100);

    line.style.left = localX + 'px';
    line.style.top = '';

    setRegion(regionA, { left: '0', top: '0', bottom: '0', right: 'auto', width: localX + 'px', height: 'auto' });
    setRegion(regionB, { left: localX + 'px', top: '0', bottom: '0', right: '0', width: 'auto', height: 'auto' });
    labelA.textContent = aPct + '%';
    labelB.textContent = 'new tile · ' + (100 - aPct) + '%';

    badge.textContent = '▮ Vertical split (left | right) · ⇧Shift = horizontal';
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
// Focus / multi-select
// ============================================================================
function setSelectionSingle(leaf) {
  selectedLeaves.clear();
  selectedLeaves.add(leaf);
  focusedLeaf = leaf;
  applySelection();
}

function toggleSelection(leaf) {
  if (selectedLeaves.has(leaf)) selectedLeaves.delete(leaf);
  else selectedLeaves.add(leaf);
  focusedLeaf = leaf;
  applySelection();
}

function clearSelection() {
  selectedLeaves.clear();
  applySelection();
}

function setFocus(leaf) {
  setSelectionSingle(leaf);
}

function updateAssignButton() {
  if (!btnAssign) return;
  const n = selectedLeaves.size;
  btnAssign.disabled = n === 0;
  btnAssign.classList.toggle('active', n > 0);
  btnAssign.title = n > 0
    ? `Assign the same folder to ${n} selected tile(s)`
    : 'Ctrl+click tiles to select, then assign a shared folder';
  btnAssign.textContent = n > 0 ? `📁 Folder (${n})` : '📁 Folder';
}

function applySelection() {
  pruneSelection();
  forEachLeaf(root, (l) => {
    if (!l.el) return;
    const sel = selectedLeaves.has(l);
    l.el.classList.toggle('selected', sel);
    l.el.classList.toggle('focused', l === focusedLeaf);
  });
  updateAssignButton();
}

function applyFocus() {
  applySelection();
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
  positionTileBadges();
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
// `withIndex` keeps the per-tile playback position for local persistence. Cross-
// window sync omits it so each display can shuffle independently without forcing
// every other screen to rebuild whenever a single tile advances.
function serializeTree(node, withIndex) {
  if (node.kind === 'leaf') {
    const o = { kind: 'leaf', folder: node.folder, loop: !!node.loop };
    if (node.spacer) o.spacer = true;
    if (withIndex) o.index = node.index;
    if (node.volume != null && node.volume !== 1) o.volume = node.volume;
    if (node.muted) o.muted = true;
    return o;
  }
  return {
    kind: 'split',
    direction: node.direction,
    ratio: node.ratio,
    children: [serializeTree(node.children[0], withIndex), serializeTree(node.children[1], withIndex)]
  };
}
function serialize(node) { return serializeTree(node, true); }
function serializeForSync(node) { return serializeTree(node, false); }

function deserialize(obj) {
  if (!obj) return makeLeaf();
  if (obj.kind === 'leaf') {
    const l = obj.spacer ? makeSpacerLeaf() : makeLeaf();
    l.folder = obj.folder || null;
    l.index = l.savedIndex = obj.index || 0;
    l.loop = !!obj.loop;
    l.volume = typeof obj.volume === 'number' ? clamp(obj.volume, 0, 1) : 1;
    l.muted = !!obj.muted;
    return l;
  }
  return makeSplit(obj.direction, deserialize(obj.children[0]), deserialize(obj.children[1]), obj.ratio);
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Only the controller (main window) persists, so mirror windows can't clobber
    // the saved layout. Every window broadcasts its edits to the other displays.
    if (!IS_MIRROR) {
      try { localStorage.setItem(LS_KEY, JSON.stringify({ settings, tree: serialize(root) })); } catch (_) {}
    }
    broadcastLayout();
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
  setGuide(!!settings.guideOn);

  render();

  // Repopulate media for any leaf that had a folder assigned, then shuffle to a
  // random clip so launch matches the documented random-start behaviour.
  forEachLeaf(root, (leaf) => {
    if (leaf.folder) loadFolder(leaf, leaf.folder, 0, false).then(() => advanceRandom(leaf, true));
  });
}

// ============================================================================
// Layout presets — named snapshots of tile layout + per-tile folder paths
// ============================================================================
function serializePresetTree(node) {
  if (node.kind === 'leaf') {
    const o = { kind: 'leaf', folder: node.folder || null, loop: !!node.loop };
    if (node.spacer) o.spacer = true;
    o.volume = clamp(node.volume == null ? 1 : node.volume, 0, 1);
    if (node.muted) o.muted = true;
    return o;
  }
  return {
    kind: 'split',
    direction: node.direction,
    ratio: node.ratio,
    children: [serializePresetTree(node.children[0]), serializePresetTree(node.children[1])]
  };
}

function countPresetFolders(node, acc = { tiles: 0, folders: 0 }) {
  if (node.kind === 'leaf') {
    if (!node.spacer) {
      acc.tiles += 1;
      if (node.folder) acc.folders += 1;
    }
    return acc;
  }
  countPresetFolders(node.children[0], acc);
  countPresetFolders(node.children[1], acc);
  return acc;
}

function readPresets() {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (_) {
    return [];
  }
}

function writePresets(list) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch (_) { /* ignore */ }
}

function isPresetsPanelOpen() {
  return !!(presetsPanel && !presetsPanel.hidden);
}

function setPresetsPanelOpen(open) {
  if (!presetsPanel) return;
  presetsPanel.hidden = !open;
  presetsPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (btnPresets) btnPresets.classList.toggle('active', open);
  if (open) {
    wake();
    renderPresetsList();
    if (presetNameInput) {
      presetNameInput.value = '';
      presetNameInput.focus();
    }
  }
}

function togglePresetsPanel() {
  setPresetsPanelOpen(!isPresetsPanelOpen());
}

function renderPresetsList() {
  if (!presetsList) return;
  const list = readPresets().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  presetsList.textContent = '';
  for (const preset of list) {
    const stats = countPresetFolders(preset.tree || { kind: 'leaf' });
    const li = document.createElement('li');
    li.className = 'preset-item';
    li.dataset.id = preset.id;

    const meta = document.createElement('div');
    meta.className = 'preset-meta';
    const nameEl = document.createElement('div');
    nameEl.className = 'preset-name';
    nameEl.textContent = preset.name || 'Untitled';
    nameEl.title = preset.name || 'Untitled';
    const sub = document.createElement('div');
    sub.className = 'preset-sub';
    sub.textContent = `${stats.tiles} tile${stats.tiles === 1 ? '' : 's'} · ${stats.folders} folder${stats.folders === 1 ? '' : 's'}`;
    meta.appendChild(nameEl);
    meta.appendChild(sub);

    const actions = document.createElement('div');
    actions.className = 'preset-actions';
    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'tool';
    loadBtn.textContent = 'Load';
    loadBtn.title = 'Apply this preset';
    loadBtn.addEventListener('click', () => applyPreset(preset.id));
    const renBtn = document.createElement('button');
    renBtn.type = 'button';
    renBtn.className = 'tool';
    renBtn.textContent = 'Rename';
    renBtn.title = 'Rename preset';
    renBtn.addEventListener('click', () => renamePreset(preset.id));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'tool danger';
    delBtn.textContent = 'Delete';
    delBtn.title = 'Delete preset';
    delBtn.addEventListener('click', () => deletePreset(preset.id));
    actions.appendChild(loadBtn);
    actions.appendChild(renBtn);
    actions.appendChild(delBtn);

    li.appendChild(meta);
    li.appendChild(actions);
    presetsList.appendChild(li);
  }
}

function saveCurrentPreset() {
  const name = ((presetNameInput && presetNameInput.value) || '').trim();
  if (!name) {
    flash('Enter a name for this preset');
    if (presetNameInput) presetNameInput.focus();
    return;
  }
  const tree = serializePresetTree(root);
  const list = readPresets();
  const existing = list.find((p) => p.name.toLowerCase() === name.toLowerCase());
  const now = Date.now();
  if (existing) {
    existing.tree = tree;
    existing.updatedAt = now;
    writePresets(list);
    flash('Updated preset “' + existing.name + '”');
  } else {
    list.push({
      id: 'p' + now.toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      name,
      createdAt: now,
      updatedAt: now,
      tree
    });
    writePresets(list);
    flash('Saved preset “' + name + '”');
  }
  if (presetNameInput) presetNameInput.value = '';
  renderPresetsList();
}

async function applyPreset(id) {
  const preset = readPresets().find((p) => p.id === id);
  if (!preset || !preset.tree) {
    flash('Preset not found');
    return;
  }
  forEachLeaf(root, disposeLeaf);
  root = deserialize(preset.tree);
  focusedLeaf = null;
  selectedLeaves.clear();
  render();

  const loads = [];
  forEachLeaf(root, (leaf) => {
    if (leaf.folder) {
      loads.push(loadFolder(leaf, leaf.folder, 0, false).then(() => advanceRandom(leaf, true)));
    }
  });
  await Promise.all(loads);
  saveState();
  setPresetsPanelOpen(false);
  flash('Loaded preset “' + (preset.name || 'Untitled') + '”');
}

function renamePreset(id) {
  const list = readPresets();
  const preset = list.find((p) => p.id === id);
  if (!preset) return;
  const next = window.prompt('Rename preset', preset.name || '');
  if (next == null) return;
  const name = next.trim();
  if (!name) {
    flash('Preset name cannot be empty');
    return;
  }
  if (list.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) {
    flash('A preset with that name already exists');
    return;
  }
  preset.name = name;
  preset.updatedAt = Date.now();
  writePresets(list);
  renderPresetsList();
  flash('Renamed preset to “' + name + '”');
}

function deletePreset(id) {
  const list = readPresets();
  const preset = list.find((p) => p.id === id);
  if (!preset) return;
  if (!window.confirm('Delete preset “' + (preset.name || 'Untitled') + '”?')) return;
  writePresets(list.filter((p) => p.id !== id));
  renderPresetsList();
  flash('Deleted preset');
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
    btnTileDisplays.disabled = info.count < 2;
  } catch (_) {}
}

// ============================================================================
// Screen-split guide — shows where each physical display falls so the user can
// see how the canvas is divided (and where to split tiles) when going
// fullscreen or spanning every monitor.
// ============================================================================
function unionBounds(displays) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    minX = Math.min(minX, d.bounds.x);
    minY = Math.min(minY, d.bounds.y);
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function setGuide(on) {
  settings.guideOn = on;
  btnGuide.classList.toggle('active', on);
  saveState();
  renderDisplayGuide();
}

/**
 * Position one guide region per display. When the window already spans every
 * monitor the regions sit 1:1 on top of their physical screens; otherwise the
 * whole multi-monitor desktop is scaled to fit inside the window as a preview
 * of how a full-span layout would be divided.
 */
function renderDisplayGuide() {
  const displays = winState.displays || [];
  // The guide is a windowed preview tool; while projecting, each display is its
  // own fullscreen window so the guide is redundant (and would mis-position).
  const show = settings.guideOn && displays.length > 0 && !projection.active;
  displayGuide.classList.toggle('visible', show);
  if (!show) { displayGuide.textContent = ''; return; }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const span = winState.spanningAllDisplays && winState.windowBounds;

  let map;
  if (span) {
    const win = winState.windowBounds;
    map = (b) => ({
      left: b.x - win.x,
      top: b.y - win.y,
      width: b.width,
      height: b.height
    });
  } else {
    const u = unionBounds(displays);
    const margin = 36;
    const scale = Math.min((vw - margin * 2) / u.width, (vh - margin * 2) / u.height, 1);
    const offX = (vw - u.width * scale) / 2;
    const offY = (vh - u.height * scale) / 2;
    map = (b) => ({
      left: offX + (b.x - u.x) * scale,
      top: offY + (b.y - u.y) * scale,
      width: b.width * scale,
      height: b.height * scale
    });
  }

  displayGuide.classList.toggle('preview', !span);
  displayGuide.textContent = '';
  for (const d of displays) {
    const r = map(d.bounds);
    const cell = document.createElement('div');
    cell.className = 'guide-cell' + (d.isPrimary ? ' primary' : '');
    cell.style.left = r.left + 'px';
    cell.style.top = r.top + 'px';
    cell.style.width = r.width + 'px';
    cell.style.height = r.height + 'px';
    const label = document.createElement('div');
    label.className = 'guide-label';
    label.textContent =
      `${d.isPrimary ? '★ ' : ''}Display ${d.index} · ${d.bounds.width}×${d.bounds.height}`;
    cell.appendChild(label);
    displayGuide.appendChild(cell);
  }
}

// ============================================================================
// Tile-to-displays — carve the canvas into a tile per physical monitor using a
// guillotine partition of the display rectangles (handles rows, columns and
// grids of monitors). Existing folder assignments are preserved in order.
// ============================================================================
function rectBBox(rects) {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Return the alloc rectangle given to the first (true) or second (false) child of a split. */
function allocSlice(alloc, direction, ratio, first) {
  if (direction === 'row') {
    const w1 = alloc.w * ratio;
    if (first) return { x: alloc.x, y: alloc.y, w: w1, h: alloc.h };
    return { x: alloc.x + w1, y: alloc.y, w: alloc.w - w1, h: alloc.h };
  }
  const h1 = alloc.h * ratio;
  if (first) return { x: alloc.x, y: alloc.y, w: alloc.w, h: h1 };
  return { x: alloc.x, y: alloc.y + h1, w: alloc.w, h: alloc.h - h1 };
}

/**
 * Pad a leaf so its content rectangle fits precisely inside the flex allocation.
 * Needed when a monitor is offset inside the union (e.g. a 1080p screen vertically
 * centred beside a taller 4K panel). Padding is built inside-out: bottom/right
 * spacers hug the content, then top/left spacers wrap that stack — applying top
 * then bottom sequentially would nest the top spacer inside the bottom split and
 * stretch the content tile past the screen edge.
 */
function padToAlloc(node, content, alloc) {
  const eps = 2;
  let n = node;

  const topPad = content.y - alloc.y;
  const bottomPad = (alloc.y + alloc.h) - (content.y + content.h);
  const leftPad = content.x - alloc.x;
  const rightPad = (alloc.x + alloc.w) - (content.x + content.w);

  if (bottomPad > eps) {
    const restH = content.h + bottomPad;
    n = makeSplit('col', n, makeSpacerLeaf(), content.h / restH);
  }
  if (topPad > eps) {
    n = makeSplit('col', makeSpacerLeaf(), n, topPad / alloc.h);
  }
  if (rightPad > eps) {
    const restW = content.w + rightPad;
    n = makeSplit('row', n, makeSpacerLeaf(), content.w / restW);
  }
  if (leftPad > eps) {
    n = makeSplit('row', makeSpacerLeaf(), n, leftPad / alloc.w);
  }
  return n;
}

function buildTreeFromRects(rects, alloc) {
  if (rects.length === 0) return makeLeaf();
  const content = rects.length === 1 ? rects[0] : rectBBox(rects);
  if (!alloc) alloc = content;

  if (rects.length === 1) return padToAlloc(makeLeaf(), content, alloc);

  const eps = 2;
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));

  // Try a clean vertical cut (left | right), then a horizontal one (top / bottom).
  const cut = (axisLo, axisHi, edgeOf, startOf) => {
    const edges = [...new Set(rects.map(edgeOf))].sort((a, b) => a - b);
    for (const c of edges) {
      if (c <= axisLo + eps || c >= axisHi - eps) continue;
      const first = rects.filter((r) => edgeOf(r) <= c + eps);
      const second = rects.filter((r) => startOf(r) >= c - eps);
      if (first.length && second.length && first.length + second.length === rects.length) {
        return { c, first, second, ratio: clamp((c - axisLo) / (axisHi - axisLo), 0.05, 0.95) };
      }
    }
    return null;
  };

  const v = cut(minX, maxX, (r) => r.x + r.w, (r) => r.x);
  if (v) {
    const a0 = allocSlice(alloc, 'row', v.ratio, true);
    const a1 = allocSlice(alloc, 'row', v.ratio, false);
    return makeSplit('row', buildTreeFromRects(v.first, a0), buildTreeFromRects(v.second, a1), v.ratio);
  }
  const h = cut(minY, maxY, (r) => r.y + r.h, (r) => r.y);
  if (h) {
    const a0 = allocSlice(alloc, 'col', h.ratio, true);
    const a1 = allocSlice(alloc, 'col', h.ratio, false);
    return makeSplit('col', buildTreeFromRects(h.first, a0), buildTreeFromRects(h.second, a1), h.ratio);
  }

  // Non-guillotine arrangement: split the bounding box at its midpoint on the
  // longer axis so tiles still align to physical screen regions.
  const spanW = maxX - minX;
  const spanH = maxY - minY;
  if (spanW >= spanH) {
    const midX = minX + spanW / 2;
    const first = rects.filter((r) => r.x + r.w / 2 < midX);
    const second = rects.filter((r) => r.x + r.w / 2 >= midX);
    if (first.length && second.length) {
      const ratio = clamp((midX - minX) / spanW, 0.05, 0.95);
      return makeSplit('row',
        buildTreeFromRects(first, allocSlice(alloc, 'row', ratio, true)),
        buildTreeFromRects(second, allocSlice(alloc, 'row', ratio, false)),
        ratio);
    }
  } else {
    const midY = minY + spanH / 2;
    const first = rects.filter((r) => r.y + r.h / 2 < midY);
    const second = rects.filter((r) => r.y + r.h / 2 >= midY);
    if (first.length && second.length) {
      const ratio = clamp((midY - minY) / spanH, 0.05, 0.95);
      return makeSplit('col',
        buildTreeFromRects(first, allocSlice(alloc, 'col', ratio, true)),
        buildTreeFromRects(second, allocSlice(alloc, 'col', ratio, false)),
        ratio);
    }
  }
  const mid = Math.ceil(rects.length / 2);
  const ratio = mid / rects.length;
  return makeSplit('row',
    buildTreeFromRects(rects.slice(0, mid), allocSlice(alloc, 'row', ratio, true)),
    buildTreeFromRects(rects.slice(mid), allocSlice(alloc, 'row', ratio, false)),
    ratio);
}

function collectLeaves(node, out = []) {
  if (node.kind === 'leaf') out.push(node);
  else node.children.forEach((c) => collectLeaves(c, out));
  return out;
}

function tileToDisplays() {
  const displays = winState.displays || [];
  if (displays.length < 2) {
    flash('Tile to Displays needs 2+ connected displays');
    return;
  }
  // Preserve current folder assignments in reading order.
  const oldLeaves = collectLeaves(root);
  const saved = oldLeaves.map((l) => ({ folder: l.folder, index: l.index }));

  forEachLeaf(root, disposeLeaf);
  const union = unionBounds(displays);
  const rects = displays
    .slice()
    .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)
    .map((d) => ({ x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height }));

  root = buildTreeFromRects(rects, { x: union.x, y: union.y, w: union.width, h: union.height });
  focusedLeaf = null;
  selectedLeaves.clear();
  render();

  const newLeaves = collectLeaves(root);
  newLeaves.forEach((leaf, i) => {
    const s = saved[i];
    if (s && s.folder) loadFolder(leaf, s.folder, s.index || 0, false);
  });

  flash(`Tiled layout to match ${displays.length} displays`);
  if (!settings.guideOn) setGuide(true);
}

let flashTimer = null;
function flash(msg) {
  toast.innerHTML = '<strong>' + msg + '</strong>';
  toast.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ============================================================================
// Global event wiring
// ============================================================================
function isTypingTarget(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

document.addEventListener('mousedown', (e) => {
  if (!isPresetsPanelOpen()) return;
  const t = e.target;
  if (presetsPanel && presetsPanel.contains(t)) return;
  if (btnPresets && (btnPresets === t || btnPresets.contains(t))) return;
  setPresetsPanelOpen(false);
});

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
    case 'd': setGuide(!settings.guideOn); break;
    case 't': tileToDisplays(); break;
    case 'delete':
    case 'backspace':
      e.preventDefault();
      deleteActiveTile();
      break;
    case ' ':
      if (focusedLeaf) { e.preventDefault(); togglePlay(focusedLeaf); }
      break;
    case 'p':
      if (!e.ctrlKey && !e.metaKey) togglePresetsPanel();
      break;
    case 'escape':
      if (isPresetsPanelOpen()) { setPresetsPanelOpen(false); break; }
      if (selectedLeaves.size > 0) { clearSelection(); break; }
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
  selectedLeaves.clear();
  render();
});
btnFs.addEventListener('click', () => window.api.toggleFullscreen());
btnFsAll.addEventListener('click', () => window.api.toggleSpanAll());
btnGuide.addEventListener('click', () => setGuide(!settings.guideOn));
btnTileDisplays.addEventListener('click', () => tileToDisplays());
if (btnAssign) btnAssign.addEventListener('click', () => assignFolderToSelection());
if (btnPresets) btnPresets.addEventListener('click', () => togglePresetsPanel());
const btnPresetsClose = document.getElementById('btn-presets-close');
if (btnPresetsClose) btnPresetsClose.addEventListener('click', () => setPresetsPanelOpen(false));
if (btnPresetSave) btnPresetSave.addEventListener('click', () => saveCurrentPreset());
if (presetNameInput) {
  presetNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveCurrentPreset(); }
  });
}
btnMin.addEventListener('click', () => window.api.minimize());
btnX.addEventListener('click', () => window.api.close());
gridSizeInput.addEventListener('input', () => setCellSize(parseInt(gridSizeInput.value, 10)));

function applyWindowState(state) {
  const wasSpanningAll = winState.spanningAllDisplays;
  winState = {
    fullScreen: !!state.fullScreen,
    spanningAllDisplays: !!state.spanningAllDisplays,
    windowBounds: state.windowBounds || null,
    displays: state.displays || winState.displays || []
  };

  btnFs.classList.toggle('active', state.fullScreen);
  btnFsAll.classList.toggle('active', state.spanningAllDisplays);
  document.body.classList.toggle('span-all', !!state.spanningAllDisplays);
  void wasSpanningAll;
  renderDisplayGuide();
  positionTileBadges();

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
function spanToast(count) {
  toast.innerHTML =
    '<strong>Spanning ' + (count || 'all') + ' displays</strong>' +
    '<span>Controls &amp; edit tools are on your primary display · <kbd>A</kbd> to exit · <kbd>E</kbd> to edit tiles</span>';
  toast.classList.add('show');
  clearTimeout(spanToastTimer);
  spanToastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
}

window.api.onWindowState(applyWindowState);
window.api.onDisplayChanged(() => refreshDisplays());

window.addEventListener('resize', () => {
  if (settings.editMode) hidePreview();
  renderDisplayGuide();
  if (projection.active) applyProjection();
  positionTileBadges();
});

// ----------------------------------------------------------------- Boot
if (IS_MIRROR) {
  // Per-display editor window: render this monitor's slice and stay in sync.
  bootMirror();
} else {
  // Controller (main) window: owns persistence + the control bar.
  window.api.onProjection(setProjection);
  window.api.onLayout(applyIncomingLayout);
  // A mirror asked for the current layout — force a fresh broadcast to it.
  window.api.onProvideLayout(() => { lastSyncJSON = ''; broadcastLayout(); });
  loadState();
  refreshDisplays();
  window.api.requestWindowState();
  wake();
}
