const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  Menu,
} = require('electron');
const path = require('path');
const fs = require('fs');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.ogg', '.ogv', '.mov', '.avi', '.mkv', '.m4v', '.wmv', '.flv',
]);

let mainWindow = null;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1400, width),
    height: Math.min(900, height),
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#0a0a0a',
    title: 'Local Video Tiler',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (process.argv.includes('--enable-logging')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getVideoFiles(folderPath) {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => path.join(folderPath, name));
  } catch {
    return [];
  }
}

function getDisplayInfo() {
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    index,
    label: display.label || `Display ${index + 1}`,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    isPrimary: display.id === screen.getPrimaryDisplay().id,
  }));
}

function applyDisplayMode(mode, displayId) {
  if (!mainWindow) return;

  const displays = screen.getAllDisplays();

  if (mode === 'all') {
    const bounds = displays.reduce(
      (acc, display) => ({
        x: Math.min(acc.x, display.bounds.x),
        y: Math.min(acc.y, display.bounds.y),
        right: Math.max(acc.right, display.bounds.x + display.bounds.width),
        bottom: Math.max(acc.bottom, display.bounds.y + display.bounds.height),
      }),
      { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity }
    );

    mainWindow.setFullScreen(false);
    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.right - bounds.x,
      height: bounds.bottom - bounds.y,
    });
    mainWindow.setSimpleFullScreen?.(true);
    return;
  }

  const target =
    displays.find((d) => d.id === displayId) ||
    screen.getPrimaryDisplay();

  mainWindow.setSimpleFullScreen?.(false);
  mainWindow.setFullScreen(false);
  mainWindow.setBounds(target.workArea);
  mainWindow.setFullScreen(true);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Video evidence folder',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  return {
    folderPath,
    videos: getVideoFiles(folderPath),
  };
});

ipcMain.handle('get-videos-in-folder', async (_event, folderPath) => {
  return getVideoFiles(folderPath);
});

ipcMain.handle('get-displays', async () => {
  return getDisplayInfo();
});

ipcMain.handle('set-display-mode', async (_event, { mode, displayId }) => {
  applyDisplayMode(mode, displayId);
  return getDisplayInfo();
});

ipcMain.handle('exit-fullscreen', async () => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(false);
  mainWindow.setSimpleFullScreen?.(false);
  mainWindow.unmaximize();
  mainWindow.setBounds({
    width: 1200,
    height: 800,
  });
  mainWindow.center();
});

ipcMain.handle('toggle-fullscreen', async () => {
  if (!mainWindow) return false;
  const isFullScreen = mainWindow.isFullScreen();
  mainWindow.setFullScreen(!isFullScreen);
  return !isFullScreen;
});

ipcMain.handle('is-fullscreen', async () => {
  return mainWindow?.isFullScreen() ?? false;
});
