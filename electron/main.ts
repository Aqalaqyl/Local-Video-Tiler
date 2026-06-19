import { app, BrowserWindow, ipcMain, dialog, screen, nativeTheme, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.flv', '.ogv',
]);

let mainWindow: BrowserWindow | null = null;
let spanWindows: BrowserWindow[] = [];

function createMainWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;

  const win = new BrowserWindow({
    width: Math.min(1400, width),
    height: Math.min(900, height),
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#0a0a0a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

function scanMediaFolder(folderPath: string): string[] {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => path.join(folderPath, e.name))
      .filter((p) => VIDEO_EXTENSIONS.has(path.extname(p).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function getDisplays() {
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: d.label || `Display ${d.id}`,
    bounds: d.bounds,
    workArea: d.workArea,
    scaleFactor: d.scaleFactor,
    isPrimary: d.id === screen.getPrimaryDisplay().id,
  }));
}

function closeSpanWindows() {
  for (const w of spanWindows) {
    if (!w.isDestroyed()) w.close();
  }
  spanWindows = [];
}

function enterSpanFullscreen() {
  if (!mainWindow) return;
  closeSpanWindows();

  const displays = screen.getAllDisplays();
  const minX = Math.min(...displays.map((d) => d.bounds.x));
  const minY = Math.min(...displays.map((d) => d.bounds.y));
  const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
  const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));

  mainWindow.setBounds({
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  });
  mainWindow.setFullScreen(true);
  mainWindow.setMenuBarVisibility(false);
}

function exitSpanFullscreen() {
  if (!mainWindow) return;
  mainWindow.setFullScreen(false);
  closeSpanWindows();
}

app.whenReady().then(() => {
  protocol.registerFileProtocol('media', (request, callback) => {
    const url = request.url.replace('media://', '');
    const decoded = decodeURIComponent(url);
    callback({ path: path.normalize(decoded) });
  });

  nativeTheme.themeSource = 'dark';
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('list-videos', async (_event, folderPath: string) => {
  return scanMediaFolder(folderPath);
});

ipcMain.handle('get-displays', async () => getDisplays());

ipcMain.handle('move-to-display', async (_event, displayId: number) => {
  if (!mainWindow) return;
  const display = screen.getAllDisplays().find((d) => d.id === displayId);
  if (!display) return;
  mainWindow.setBounds(display.workArea);
});

ipcMain.handle('enter-span-fullscreen', async () => enterSpanFullscreen());
ipcMain.handle('exit-span-fullscreen', async () => exitSpanFullscreen());

ipcMain.handle('is-span-fullscreen', async () => {
  return mainWindow?.isFullScreen() ?? false;
});

ipcMain.handle('save-layout', async (_event, data: string) => {
  const userData = app.getPath('userData');
  const layoutPath = path.join(userData, 'layout.json');
  fs.writeFileSync(layoutPath, data, 'utf-8');
});

ipcMain.handle('load-layout', async () => {
  const userData = app.getPath('userData');
  const layoutPath = path.join(userData, 'layout.json');
  try {
    return fs.readFileSync(layoutPath, 'utf-8');
  } catch {
    return null;
  }
});

ipcMain.handle('to-file-url', async (_event, filePath: string) => {
  return `media://${encodeURIComponent(filePath)}`;
});
