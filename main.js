'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.webm', '.ogv', '.ogg', '.mov', '.mkv', '.avi',
  '.wmv', '.flv', '.mpg', '.mpeg', '.3gp', '.ts', '.m2ts'
]);

/** @type {BrowserWindow | null} */
let mainWindow = null;

// Remembers the windowed geometry so we can restore after an all-display span.
let savedBounds = null;
let spanningAllDisplays = false;

// While spanning, every NON-primary display gets its own fullscreen "mirror"
// window showing that display's slice of the global canvas. The primary display
// is covered by the main window (which keeps the controls).
/** @type {BrowserWindow[]} */
let projectionWindows = [];

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
    show: false,
    title: 'Local Video Tiler',
    // Required so the window may be sized larger than a single screen — without
    // it macOS clamps the window to one display and "All Displays" can't span.
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Allow file:// media to load from the file:// page.
      webSecurity: true,
      // Let assigned folders start playing on launch without a user gesture.
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    closeProjectionWindows();
    mainWindow = null;
  });

  // Keep the renderer informed about fullscreen state for UI affordances.
  const emitState = () => sendWindowState();
  mainWindow.on('enter-full-screen', emitState);
  mainWindow.on('leave-full-screen', emitState);
  mainWindow.on('maximize', emitState);
  mainWindow.on('unmaximize', emitState);
}

function sendWindowState() {
  if (!mainWindow) return;
  const primary = screen.getPrimaryDisplay();
  const displays = screen.getAllDisplays();
  mainWindow.webContents.send('window:state', {
    fullScreen: mainWindow.isFullScreen(),
    spanningAllDisplays,
    maximized: mainWindow.isMaximized(),
    // Geometry the renderer uses to keep controls on a real, visible monitor
    // (the primary display) when the window spans every display at once.
    windowBounds: mainWindow.getBounds(),
    primaryBounds: primary.bounds,
    displayCount: displays.length,
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
 * Compute the smallest rectangle that contains every connected display so the
 * window can be stretched across ALL monitors at once.
 */
function getAllDisplaysBounds() {
  const displays = screen.getAllDisplays();
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

/**
 * Create a frameless, fullscreen "mirror" window pinned to one display. It loads
 * the same UI in `role=mirror`, told its viewport (the display) and the union of
 * all displays, so it renders just that display's slice of the global canvas.
 */
function createProjectionWindow(display, union) {
  const b = display.bounds;
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    show: false,
    backgroundColor: '#000000',
    enableLargerThanScreen: true,
    skipTaskbar: true,
    title: 'Local Video Tiler',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'src', 'index.html'), {
    query: {
      role: 'mirror',
      vx: String(b.x), vy: String(b.y), vw: String(b.width), vh: String(b.height),
      ux: String(union.x), uy: String(union.y), uw: String(union.width), uh: String(union.height)
    }
  });
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    win.setBounds(b);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    setWindowFullscreen(win, true);
    // Re-sync after fullscreen so the renderer's slice matches the real window.
    setTimeout(() => syncProjectionViewport(win, 'mirror', union, null), 80);
  });
  win.on('closed', () => {
    projectionWindows = projectionWindows.filter((w) => w !== win);
  });
  return win;
}

function closeProjectionWindows() {
  for (const w of projectionWindows.slice()) {
    try { if (!w.isDestroyed()) w.destroy(); } catch (_) { /* ignore */ }
  }
  projectionWindows = [];
}

function spanAllDisplays() {
  if (!mainWindow) return;
  if (!spanningAllDisplays) {
    savedBounds = mainWindow.getBounds();
  }
  if (mainWindow.isMaximized()) mainWindow.unmaximize();

  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const union = getAllDisplaysBounds();
  spanningAllDisplays = true;

  // The main window becomes the controller, fullscreen on the PRIMARY display.
  // Real OS fullscreen reliably covers the taskbar / dock / menu bar — that's
  // what gives a genuinely immersive surface on each individual screen.
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (isWindowFullscreen(mainWindow)) setWindowFullscreen(mainWindow, false);
  mainWindow.setBounds(primary.bounds);
  setWindowFullscreen(mainWindow, true);
  sendProjection(mainWindow, {
    active: true,
    role: 'controller',
    viewport: primary.bounds,
    union,
    displayCount: displays.length
  });
  // Re-sync after fullscreen so tile layout aligns with the real primary window.
  setTimeout(() => syncProjectionViewport(mainWindow, 'controller', union, displays.length), 80);

  // Every other display gets its own fullscreen mirror window.
  closeProjectionWindows();
  for (const d of displays) {
    if (d.id === primary.id) continue;
    projectionWindows.push(createProjectionWindow(d, union));
  }

  mainWindow.moveTop();
  mainWindow.focus();
  sendWindowState();
}

function restoreFromSpan() {
  if (!mainWindow) return;
  closeProjectionWindows();
  if (isWindowFullscreen(mainWindow)) setWindowFullscreen(mainWindow, false);
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setVisibleOnAllWorkspaces(false);
  sendProjection(mainWindow, { active: false });
  spanningAllDisplays = false;
  // Restore the previous windowed geometry once we've left fullscreen.
  const restore = () => { if (savedBounds && mainWindow && !mainWindow.isDestroyed()) mainWindow.setBounds(savedBounds); };
  restore();
  setTimeout(restore, 60);
  sendWindowState();
}

function sendProjection(win, config) {
  if (win && !win.isDestroyed()) win.webContents.send('projection:set', config);
}

/** Push the window's actual post-fullscreen bounds so the renderer slice matches. */
function syncProjectionViewport(win, role, union, displayCount) {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  sendProjection(win, {
    active: true,
    role,
    viewport: { x: b.x, y: b.y, width: b.width, height: b.height },
    union,
    displayCount
  });
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
