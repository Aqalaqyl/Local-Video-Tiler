'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen, protocol, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const { startQualityServer, resolveQuality } = require('./quality-server');
const { showWindowsTaskbars, showWindowsTaskbarsSync } = require('./taskbar-win');
const { raisePlaybackPriority } = require('./playback-priority');

/**
 * Prefer GPU compositing + hardware video decode. Chromium falls back to
 * software (CPU) paths automatically when the GPU / decoder isn't available.
 * These switches must be set before app.whenReady(). Never call
 * app.disableHardwareAcceleration() — that forces the laggy CPU path.
 */
function configureHardwareAcceleration() {
  // Allow GPUs that Chromium would otherwise blocklist; still fails safe to CPU.
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
  // Legacy Chromium flags — ignored when unsupported, helpful on older builds.
  app.commandLine.appendSwitch('enable-accelerated-video-decode');
  app.commandLine.appendSwitch('enable-accelerated-video-encode');
  app.commandLine.appendSwitch('enable-accelerated-mjpeg-decode');
  // Dual-GPU laptops: prefer the discrete adapter for decode/compositing.
  app.commandLine.appendSwitch('force_high_performance_gpu');

  const features = ['CanvasOopRasterization'];
  if (process.platform === 'linux') {
    features.push('VaapiVideoDecoder', 'VaapiVideoEncoder', 'VaapiIgnoreDriverChecks');
  } else if (process.platform === 'win32') {
    // D3D11 is the path that keeps decode and compositing on the same GPU.
    features.push('PlatformHEVCDecoderSupport', 'D3D11VideoDecoder');
    app.commandLine.appendSwitch('use-angle', 'd3d11');
    app.commandLine.appendSwitch('enable-gpu-memory-buffer-video-frames');
  }
  app.commandLine.appendSwitch('enable-features', features.join(','));
  // Each display gets its own renderer so its videos decode in parallel.
  // The GPU process is still shared, and playback-priority.js raises it.
  // These flags stop Windows from parking a screen that doesn't have the pointer.
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  if (process.platform === 'win32') {
    app.commandLine.appendSwitch(
      'disable-features',
      'CalculateNativeWinOcclusion,UseEcoQoSForBackgroundProcess,DirectCompositionVideoOverlays'
    );
  }
}

configureHardwareAcceleration();
// Raise the browser process before Chromium starts the GPU process.
raisePlaybackPriority();
app.on('browser-window-created', () => {
  setTimeout(raisePlaybackPriority, 200);
});

// Scaled playback is served as lvtq:// so file:// pages can load it.
protocol.registerSchemesAsPrivileged([{
  scheme: 'lvtq',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true
  }
}]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.webm', '.ogv', '.ogg', '.mov', '.mkv', '.avi',
  '.wmv', '.flv', '.mpg', '.mpeg', '.3gp', '.ts', '.m2ts', '.gif',
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.avif'
]);

/** @type {BrowserWindow | null} */
let mainWindow = null;

// Remembers the windowed geometry so we can restore after an all-display span.
let savedBounds = null;
let spanningAllDisplays = false;

// One borderless fullscreen window per monitor. Windows only covers the taskbar
// and fills a screen when that window matches that one monitor. Each window has
// its own renderer so its videos decode in parallel; the GPU process is shared
// and raised to high priority. Extra windows stay off the taskbar.
/** @type {BrowserWindow[]} */
let projectionWindows = [];
let mirrorDisplayKey = '';

/** Fullscreen a window on whichever display it currently occupies. */
function setWindowFullscreen(win, on) {
  if (!win || win.isDestroyed()) return;
  if (process.platform === 'darwin') win.setSimpleFullScreen(on);
  else win.setFullScreen(on);
}

function isWindowFullscreen(win) {
  if (!win || win.isDestroyed()) return false;
  return process.platform === 'darwin'
    ? (win.isSimpleFullScreen && win.isSimpleFullScreen())
    : win.isFullScreen();
}

function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1280, width),
    height: Math.min(800, height),
    minWidth: 480,
    minHeight: 320,
    backgroundColor: '#0b0b0e',
    frame: false,
    // Borderless, like a game window. A thick frame or a shadow is what makes
    // Windows keep the window above the taskbar.
    thickFrame: false,
    hasShadow: false,
    roundedCorners: false,
    show: false,
    title: 'Local Video Tiler',
    // Required so the window may be sized larger than a single screen — without
    // it macOS clamps the window to one display and "All Displays" can't span.
    enableLargerThanScreen: true,
    webPreferences: sharedWebPreferences()
  });

  mainWindow.removeMenu();
  mainWindow.webContents.setBackgroundThrottling(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    closeProjectionWindows();
    spanningAllDisplays = false;
    mirrorDisplayKey = '';
    showWindowsTaskbarsSync();
    mainWindow = null;
  });

  // Keep the renderer informed about fullscreen state for UI affordances.
  const emitState = () => sendWindowState();
  mainWindow.on('enter-full-screen', emitState);
  mainWindow.on('leave-full-screen', () => {
    emitState();
    // Windows restores the pre-fullscreen work-area size after this event.
    // Ignore the exit we trigger ourselves while moving onto another monitor.
    if (spanningAllDisplays && !placingSpan.has(mainWindow)) applySpanLayout();
  });
  mainWindow.on('maximize', emitState);
  mainWindow.on('unmaximize', emitState);
}

function sendWindowState() {
  if (!mainWindow) return;
  const primary = screen.getPrimaryDisplay();
  const displays = screen.getAllDisplays();
  const spanTargets = displaysForSpan();
  const anchor = spanningAllDisplays ? anchorDisplay(spanTargets) : null;
  mainWindow.webContents.send('window:state', {
    fullScreen: mainWindow.isFullScreen(),
    spanningAllDisplays,
    maximized: mainWindow.isMaximized(),
    // Geometry the renderer uses to keep controls on a real, visible monitor
    // (the display this window is covering) when spanning.
    windowBounds: spanningAllDisplays ? mainWindow.getContentBounds() : mainWindow.getBounds(),
    primaryBounds: primary.bounds,
    anchorBounds: anchor ? anchor.bounds : null,
    displayCount: displays.length,
    spanCount: spanTargets.length,
    // null means every connected monitor. An array is the user's subset.
    spanDisplayIds: spanDisplayIds,
    // Full per-display geometry so the renderer can draw a screen-split guide
    // showing exactly where each physical monitor falls inside the window.
    displays: displays.map((d, i) => ({
      id: d.id,
      index: i + 1,
      bounds: d.bounds,
      isPrimary: d.id === primary.id
    }))
  });
}

/**
 * Compute the smallest rectangle that contains the given displays so each
 * fullscreen window can show its slice of that shared canvas.
 */
function unionOfDisplays(displays) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    const b = d.bounds;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function getAllDisplaysBounds() {
  return unionOfDisplays(screen.getAllDisplays());
}

// null = every connected monitor. Otherwise the display ids the user checked.
let spanDisplayIds = null;

function normalizeSpanIds(ids) {
  const all = screen.getAllDisplays();
  if (!Array.isArray(ids) || !ids.length) return null;
  const known = new Set(all.map((d) => d.id));
  const next = [];
  for (const id of ids) {
    const n = Number(id);
    if (!known.has(n) || next.includes(n)) continue;
    next.push(n);
  }
  if (!next.length || next.length >= all.length) return null;
  return next;
}

/** Displays All Displays should cover. Falls back to every monitor. */
function displaysForSpan() {
  const all = screen.getAllDisplays();
  if (!spanDisplayIds || !spanDisplayIds.length) return all;
  const want = new Set(spanDisplayIds);
  const picked = all.filter((d) => want.has(d.id));
  return picked.length ? picked : all;
}

/** The window with the control bar. Prefer the primary when it is selected. */
function anchorDisplay(displays) {
  const primary = screen.getPrimaryDisplay();
  if (displays.some((d) => d.id === primary.id)) return primary;
  return displays.slice().sort((a, b) => (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y))[0];
}

function boundsMatch(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) < 4 && Math.abs(a.y - b.y) < 4
    && Math.abs(a.width - b.width) < 8 && Math.abs(a.height - b.height) < 8;
}

function sharedWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    webSecurity: true,
    backgroundThrottling: false,
    autoplayPolicy: 'no-user-gesture-required'
  };
}

function closeProjectionWindows() {
  for (const w of projectionWindows.slice()) {
    try { if (!w.isDestroyed()) w.destroy(); } catch (_) { /* ignore */ }
  }
  projectionWindows = [];
}

const placingSpan = new WeakSet();

function fullscreenOnDisplay(win, bounds) {
  if (!win || win.isDestroyed() || !bounds || placingSpan.has(win)) return;
  try { win.setMenuBarVisibility(false); } catch (_) { /* ignore */ }
  try { win.setHasShadow(false); } catch (_) { /* ignore */ }
  try { win.setAlwaysOnTop(true, 'screen-saver', 1); } catch (_) {
    try { win.setAlwaysOnTop(true); } catch (_) { /* ignore */ }
  }
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) { /* ignore */ }

  let onTarget = false;
  try { onTarget = boundsMatch(bounds, screen.getDisplayMatching(win.getBounds()).bounds); } catch (_) { /* ignore */ }
  if (onTarget && isWindowFullscreen(win)) return;

  const enter = () => {
    if (!spanningAllDisplays || win.isDestroyed()) return;
    if (win.isMaximized()) win.unmaximize();
    // setBounds while already fullscreen makes Windows leave fullscreen and
    // snaps the window back above the taskbar. Place first, then fullscreen.
    try { win.setBounds(bounds); } catch (_) { /* ignore */ }
    setTimeout(() => {
      if (!spanningAllDisplays || win.isDestroyed() || isWindowFullscreen(win)) return;
      setWindowFullscreen(win, true);
    }, 60);
  };

  if (isWindowFullscreen(win)) {
    placingSpan.add(win);
    setWindowFullscreen(win, false);
    setTimeout(() => {
      enter();
      setTimeout(() => placingSpan.delete(win), 250);
    }, 80);
    return;
  }
  enter();
}

function mirrorSearch(bounds, union) {
  const params = new URLSearchParams({
    role: 'mirror',
    vx: String(bounds.x),
    vy: String(bounds.y),
    vw: String(bounds.width),
    vh: String(bounds.height),
    ux: String(union.x),
    uy: String(union.y),
    uw: String(union.width),
    uh: String(union.height)
  });
  (spanOpenViewports || []).forEach((b, i) => {
    params.set('o' + i, [b.x, b.y, b.width, b.height].join(','));
  });
  return params.toString();
}

function openMirrorWindow(bounds, union) {
  const win = new BrowserWindow({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
    frame: false,
    thickFrame: false,
    hasShadow: false,
    roundedCorners: false,
    enableLargerThanScreen: true,
    backgroundColor: '#0b0b0e',
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Local Video Tiler',
    webPreferences: sharedWebPreferences()
  });
  win.removeMenu();
  try { win.webContents.setBackgroundThrottling(false); } catch (_) { /* ignore */ }
  win.loadFile(path.join(__dirname, 'src', 'index.html'), { search: mirrorSearch(bounds, union) });
  const showOnDisplay = () => {
    if (!spanningAllDisplays || win.isDestroyed()) return;
    if (!win.isVisible()) win.showInactive();
    fullscreenOnDisplay(win, bounds);
    syncProjectionViewport(win, 'mirror', union, bounds);
  };
  win.once('ready-to-show', showOnDisplay);
  win.on('leave-full-screen', () => {
    if (spanningAllDisplays) fullscreenOnDisplay(win, bounds);
  });
  projectionWindows.push(win);
}

// Bounds of the monitors that currently have a window. Tiles outside these
// stay closed instead of being restretched onto the screens that remain.
let spanOpenViewports = null;

function copyBounds(bounds) {
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

function projectionPayload(role, viewport, union) {
  return {
    active: true,
    role,
    viewport: copyBounds(viewport),
    union: copyBounds(union),
    displayCount: screen.getAllDisplays().length,
    openViewports: (spanOpenViewports || []).map(copyBounds)
  };
}

/**
 * Fullscreen the monitors the user checked. The shared canvas stays the whole
 * desk, so each window shows the slice that already belonged on that screen.
 * Unchecked monitors get no window: tiles that sit on them are not opened.
 */
function applySpanLayout() {
  if (!mainWindow || mainWindow.isDestroyed() || !spanningAllDisplays) return null;
  const displays = displaysForSpan();
  const anchor = anchorDisplay(displays);
  const others = displays.filter((d) => d.id !== anchor.id);
  // Always the full desk. A smaller union would squash every tile onto the
  // checked monitors.
  const union = getAllDisplaysBounds();
  spanOpenViewports = displays.map((d) => copyBounds(d.bounds));
  const key = anchor.id + '|' + others.map((d) => d.id + ':' + d.bounds.x + ',' + d.bounds.y + ',' + d.bounds.width + 'x' + d.bounds.height).join('|')
    + '|u:' + union.x + ',' + union.y + ',' + union.width + 'x' + union.height;

  fullscreenOnDisplay(mainWindow, anchor.bounds);

  // The only connected monitor already is the whole desk.
  const singleScreen = !others.length && boundsMatch(anchor.bounds, union);
  if (singleScreen) {
    if (projectionWindows.length) closeProjectionWindows();
    mirrorDisplayKey = key;
    spanOpenViewports = null;
    sendProjection(mainWindow, { active: false });
    return anchor.bounds;
  }

  sendProjection(mainWindow, projectionPayload('controller', anchor.bounds, union));

  if (!others.length) {
    if (projectionWindows.length) closeProjectionWindows();
    mirrorDisplayKey = key;
    return anchor.bounds;
  }

  if (key !== mirrorDisplayKey) {
    closeProjectionWindows();
    mirrorDisplayKey = key;
    for (const d of others) openMirrorWindow(d.bounds, union);
  } else {
    others.forEach((d, i) => {
      const w = projectionWindows[i];
      if (!w || w.isDestroyed()) return;
      fullscreenOnDisplay(w, d.bounds);
      syncProjectionViewport(w, 'mirror', union, d.bounds);
    });
  }
  return anchor.bounds;
}

function spanAllDisplays() {
  if (!mainWindow) return;
  if (!spanningAllDisplays) {
    savedBounds = mainWindow.getBounds();
  }
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  spanningAllDisplays = true;
  mirrorDisplayKey = '';
  closeProjectionWindows();
  try { mainWindow.webContents.setBackgroundThrottling(false); } catch (_) { /* ignore */ }
  applySpanLayout();
  mainWindow.focus();
  sendWindowState();
  try { mainWindow.webContents.send('projection:resumeAudio'); } catch (_) { /* ignore */ }
}

function restoreFromSpan() {
  if (!mainWindow) return;
  spanningAllDisplays = false;
  mirrorDisplayKey = '';
  spanOpenViewports = null;
  showWindowsTaskbars();
  closeProjectionWindows();
  if (isWindowFullscreen(mainWindow)) setWindowFullscreen(mainWindow, false);
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setVisibleOnAllWorkspaces(false);
  sendProjection(mainWindow, { active: false });
  // Restore the previous windowed geometry once we've left fullscreen.
  const restore = () => { if (savedBounds && mainWindow && !mainWindow.isDestroyed() && !spanningAllDisplays) mainWindow.setBounds(savedBounds); };
  restore();
  setTimeout(restore, 60);
  setTimeout(restore, 240);
  sendWindowState();
}

function sendProjection(win, config) {
  if (win && !win.isDestroyed()) win.webContents.send('projection:set', config);
}

/** Push display bounds in global desktop coordinates (never win.getBounds() — fullscreen on a secondary monitor often reports 0,0). */
function syncProjectionViewport(win, role, union, displayBounds) {
  if (!win || win.isDestroyed() || !displayBounds) return;
  sendProjection(win, projectionPayload(role, displayBounds, union));
}

function toggleSpanAllDisplays() {
  if (spanningAllDisplays) restoreFromSpan();
  else spanAllDisplays();
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

ipcMain.handle('dialog:pickFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a media folder for this tile',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('media:readFolder', async (_event, folderPath) => {
  if (!folderPath) return { folder: null, files: [] };
  try {
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && VIDEO_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
      .map((e) => {
        const full = path.join(folderPath, e.name);
        return { name: e.name, path: full, url: url.pathToFileURL(full).href };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return { folder: folderPath, files };
  } catch (err) {
    return { folder: folderPath, files: [], error: String(err && err.message ? err.message : err) };
  }
});

/** Permanently delete a video file that belongs to an assigned media folder. */
ipcMain.handle('media:deleteFile', async (_event, filePath, folderPath) => {
  if (!filePath || !folderPath) return { ok: false, error: 'Missing path' };
  const resolvedFile = path.resolve(filePath);
  const resolvedFolder = path.resolve(folderPath);
  const rel = path.relative(resolvedFolder, resolvedFile);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, error: 'File is outside the assigned folder' };
  }
  if (!VIDEO_EXTENSIONS.has(path.extname(resolvedFile).toLowerCase())) {
    return { ok: false, error: 'Not a supported video file' };
  }
  const parent = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showMessageBox(parent || undefined, {
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Delete video',
    message: 'Delete this video permanently?',
    detail: path.basename(resolvedFile) + '\n\nThis cannot be undone.'
  });
  if (result.response !== 0) return { ok: false, cancelled: true };
  try {
    await fs.promises.unlink(resolvedFile);
    return { ok: true, path: resolvedFile };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('media:qualityUrl', async (_event, opts) => {
  try {
    return await resolveQuality(opts || {});
  } catch (err) {
    return { url: '', seekable: true, passthrough: true, origin: 0, duration: 0, key: 'orig', bitrate: 0, maxEdge: 0, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('display:getInfo', () => {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  return {
    count: displays.length,
    primaryId,
    displays: displays.map((d) => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
      isPrimary: d.id === primaryId
    }))
  };
});

ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:close', () => mainWindow && mainWindow.close());

ipcMain.on('window:toggleFullscreen', () => {
  if (!mainWindow) return;
  if (spanningAllDisplays) restoreFromSpan();
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

ipcMain.on('window:toggleSpanAll', () => toggleSpanAllDisplays());

ipcMain.handle('display:setSpanIds', (_event, ids) => {
  spanDisplayIds = normalizeSpanIds(ids);
  if (spanningAllDisplays) {
    mirrorDisplayKey = '';
    applySpanLayout();
    mainWindow.focus();
    try { mainWindow.webContents.send('projection:resumeAudio'); } catch (_) { /* ignore */ }
  }
  sendWindowState();
  return { ids: spanDisplayIds, spanning: spanningAllDisplays };
});

ipcMain.on('window:requestState', () => sendWindowState());

// --- Projection (multi-display fullscreen) layout sync -------------------------
// Any display window can edit; its layout is relayed to every OTHER window so all
// screens — and the controller's persisted state — stay in sync.
ipcMain.on('projection:pushLayout', (e, payload) => {
  const targets = [mainWindow, ...projectionWindows];
  for (const w of targets) {
    if (w && !w.isDestroyed() && w.webContents !== e.sender) {
      w.webContents.send('projection:layout', payload);
    }
  }
});

// A freshly-created mirror asks for the current layout; relay the request to the
// controller, which answers by broadcasting `projection:pushLayout`.
ipcMain.on('projection:requestLayout', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('projection:provideLayout');
  }
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  // Keep the CPU/GPU clocks up for the whole session. A video wall is not idle.
  try { powerSaveBlocker.start('prevent-app-suspension'); } catch (_) { /* ignore */ }
  raisePlaybackPriority();
  setTimeout(raisePlaybackPriority, 800);
  // Log GPU / video-decode status once; Chromium already chose GPU or CPU.
  try {
    const status = app.getGPUFeatureStatus();
    const compositing = status.gpu_compositing || status.gpu_compositing_status || '?';
    const videoDecode = status.video_decode || status.video_decode_status || '?';
    console.log(`[Local Video Tiler] GPU compositing: ${compositing}; video decode: ${videoDecode}`);
  } catch (_) { /* ignore */ }

  startQualityServer();
  createWindow();

  // Re-broadcast display changes so the renderer can update its info pill.
  const broadcastDisplays = () => {
    if (!mainWindow) return;
    // If we're spanning every display, re-apply the span so it keeps covering
    // all monitors (and switches between native-fullscreen for a single screen
    // and a borderless span for many) after a hot-plug / resolution change.
    if (spanningAllDisplays) {
      spanAllDisplays();
    }
    mainWindow.webContents.send('display:changed');
    sendWindowState();
  };
  screen.on('display-added', broadcastDisplays);
  screen.on('display-removed', broadcastDisplays);
  screen.on('display-metrics-changed', broadcastDisplays);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  spanningAllDisplays = false;
  mirrorDisplayKey = '';
  showWindowsTaskbarsSync();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
