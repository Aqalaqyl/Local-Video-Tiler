import { app, BrowserWindow, ipcMain, screen, dialog, protocol } from 'electron';
import path from 'path';
import fs from 'fs';

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mkv', '.avi', '.mov', '.m4v', '.ogv', '.wmv', '.flv',
]);

let mainWindow: BrowserWindow | null = null;
let viewWindows: BrowserWindow[] = [];

const LAYOUT_FILE = path.join(app.getPath('userData'), 'layout.json');
const isDev = !app.isPackaged;

function getDisplayInfos() {
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: display.label || `Display ${index + 1}`,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    isPrimary: display.id === screen.getPrimaryDisplay().id,
  }));
}

function getCombinedBounds(displays: ReturnType<typeof getDisplayInfos>) {
  const xs = displays.map((d) => d.bounds.x);
  const ys = displays.map((d) => d.bounds.y);
  const rights = displays.map((d) => d.bounds.x + d.bounds.width);
  const bottoms = displays.map((d) => d.bounds.y + d.bounds.height);

  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...rights) - Math.min(...xs),
    height: Math.max(...bottoms) - Math.min(...ys),
  };
}

function getPreloadPath() {
  return path.join(__dirname, 'preload.js');
}

function getIndexPath() {
  return path.join(__dirname, '../dist/index.html');
}

function createMainWindow() {
  const primary = screen.getPrimaryDisplay();

  mainWindow = new BrowserWindow({
    width: Math.min(1400, primary.workArea.width - 80),
    height: Math.min(900, primary.workArea.height - 80),
    x: primary.workArea.x + 40,
    y: primary.workArea.y + 40,
    title: 'Local Video Tiler',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(getIndexPath());
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    closeViewWindows();
  });
}

function closeViewWindows() {
  viewWindows.forEach((win) => {
    if (!win.isDestroyed()) win.close();
  });
  viewWindows = [];
}

function createViewWindows(displayMode: 'single' | 'all', displayId?: number) {
  closeViewWindows();

  const displays = getDisplayInfos();
  const targets =
    displayMode === 'all'
      ? displays
      : displays.filter((d) => d.id === (displayId ?? screen.getPrimaryDisplay().id));

  if (targets.length === 0) return;

  const combined = getCombinedBounds(targets);

  targets.forEach((display) => {
    const query = {
      view: '1',
      displayMode,
      displayId: String(display.id),
      combinedX: String(combined.x),
      combinedY: String(combined.y),
      combinedW: String(combined.width),
      combinedH: String(combined.height),
      offsetX: String(display.bounds.x - combined.x),
      offsetY: String(display.bounds.y - combined.y),
      offsetW: String(display.bounds.width),
      offsetH: String(display.bounds.height),
    };

    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      fullscreen: true,
      backgroundColor: '#000000',
      skipTaskbar: true,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false,
      },
    });

    if (isDev) {
      const params = new URLSearchParams(query);
      win.loadURL(`http://localhost:5173?${params}`);
    } else {
      win.loadFile(getIndexPath(), { query });
    }

    win.on('closed', () => {
      viewWindows = viewWindows.filter((w) => w !== win);
      if (viewWindows.length === 0) {
        mainWindow?.webContents.send('view-mode-changed', false);
      }
    });

    viewWindows.push(win);
  });

  mainWindow?.webContents.send('view-mode-changed', true);
  mainWindow?.webContents.send('display-layout', { displays: targets, mode: displayMode });
}

function listVideosInFolder(folderPath: string) {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => ({
        name,
        path: path.join(folderPath, name),
      }));
  } catch {
    return [];
  }
}

app.whenReady().then(() => {
  protocol.registerFileProtocol('localvideo', (request, callback) => {
    const url = request.url.replace('localvideo://', '');
    callback({ path: decodeURIComponent(url) });
  });

  createMainWindow();

  ipcMain.handle('get-displays', () => getDisplayInfos());

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('list-videos', (_event, folderPath: string) =>
    listVideosInFolder(folderPath)
  );

  ipcMain.handle('to-file-url', (_event, filePath: string) =>
    `localvideo://${encodeURIComponent(filePath)}`
  );

  ipcMain.handle('enter-view-mode', (_event, displayMode: 'single' | 'all', displayId?: number) => {
    createViewWindows(displayMode, displayId);
  });

  ipcMain.handle('exit-view-mode', () => {
    closeViewWindows();
    mainWindow?.webContents.send('view-mode-changed', false);
  });

  ipcMain.handle('save-layout', (_event, layout: unknown) => {
    fs.writeFileSync(LAYOUT_FILE, JSON.stringify(layout, null, 2));
  });

  ipcMain.handle('load-layout', () => {
    try {
      if (!fs.existsSync(LAYOUT_FILE)) return null;
      return JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf-8'));
    } catch {
      return null;
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
