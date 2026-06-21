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
// Whether the current span used real OS fullscreen (single-display case) so we
// know how to undo it on restore.
let spanUsedNativeFullscreen = false;

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
      webSecurity: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
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

function spanAllDisplays() {
  if (!mainWindow) return;
  if (!spanningAllDisplays) {
    savedBounds = mainWindow.getBounds();
  }
  if (mainWindow.isMaximized()) mainWindow.unmaximize();

  // Strip chrome and raise the window above the taskbar / dock. The
  // `screen-saver` level is the documented way to sit above the Windows taskbar
  // and the macOS Dock; covering the area + this level hides the taskbar behind
  // the window for an immersive surface.
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  spanningAllDisplays = true;
  const target = getAllDisplaysBounds();
  const singleScreen = screen.getAllDisplays().length <= 1;

  if (singleScreen) {
    // One display: use real OS fullscreen, which reliably covers the taskbar /
    // dock / menu bar on every platform (a plain borderless window does not, as
    // window managers reserve the panel/strut area otherwise).
    spanUsedNativeFullscreen = true;
    mainWindow.setBounds(target);
    if (process.platform === 'darwin') mainWindow.setSimpleFullScreen(true);
    else mainWindow.setFullScreen(true);
  } else {
    // Multiple displays: native fullscreen only covers one screen, so stretch a
    // borderless, always-on-top window across the union of every monitor.
    spanUsedNativeFullscreen = false;
    if (mainWindow.isSimpleFullScreen && mainWindow.isSimpleFullScreen()) {
      mainWindow.setSimpleFullScreen(false);
    }
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    mainWindow.setBounds(target);
    mainWindow.setContentBounds(target);
  }

  mainWindow.moveTop();
  mainWindow.focus();
  sendWindowState();
}

function restoreFromSpan() {
  if (!mainWindow) return;
  if (spanUsedNativeFullscreen) {
    if (process.platform === 'darwin') mainWindow.setSimpleFullScreen(false);
    else mainWindow.setFullScreen(false);
    spanUsedNativeFullscreen = false;
  }
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setVisibleOnAllWorkspaces(false);
  spanningAllDisplays = false;
  // Restore the previous windowed geometry once we've left fullscreen.
  const restore = () => { if (savedBounds && mainWindow) mainWindow.setBounds(savedBounds); };
  restore();
  setTimeout(restore, 60);
  sendWindowState();
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
