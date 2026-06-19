const { app, BrowserWindow, dialog, ipcMain, screen } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MEDIA_EXTENSIONS = new Set([
  ".3g2",
  ".3gp",
  ".aac",
  ".avi",
  ".flac",
  ".m4a",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".oga",
  ".ogg",
  ".ogv",
  ".opus",
  ".wav",
  ".webm"
]);

const VIDEO_EXTENSIONS = new Set([
  ".3g2",
  ".3gp",
  ".avi",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".ogv",
  ".webm"
]);

let mainWindow;
let isSpanningDisplays = false;
let savedWindowBounds = null;
let savedMaximizedState = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 520,
    backgroundColor: "#05070b",
    autoHideMenuBar: true,
    title: "Local Video Tiler",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

function getAllDisplayBounds() {
  const displays = screen.getAllDisplays();
  const minX = Math.min(...displays.map((display) => display.bounds.x));
  const minY = Math.min(...displays.map((display) => display.bounds.y));
  const maxX = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
  const maxY = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function applySpanAllDisplays(enabled) {
  if (!mainWindow) {
    return false;
  }

  if (enabled) {
    if (!isSpanningDisplays) {
      savedWindowBounds = mainWindow.getBounds();
      savedMaximizedState = mainWindow.isMaximized();
    }

    isSpanningDisplays = true;
    mainWindow.setFullScreen(false);
    mainWindow.setResizable(true);
    mainWindow.setBounds(getAllDisplayBounds(), true);
    mainWindow.setMenuBarVisibility(false);
    return true;
  }

  isSpanningDisplays = false;
  mainWindow.setFullScreen(false);

  if (savedWindowBounds) {
    mainWindow.setBounds(savedWindowBounds, true);
  }

  if (savedMaximizedState) {
    mainWindow.maximize();
  }

  return false;
}

async function listMediaFiles(folderPath) {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
    .map((entry) => {
      const filePath = path.join(folderPath, entry.name);
      const extension = path.extname(entry.name).toLowerCase();

      return {
        name: entry.name,
        path: filePath,
        url: pathToFileURL(filePath).href,
        kind: VIDEO_EXTENSIONS.has(extension) ? "video" : "audio"
      };
    });
}

function registerIpcHandlers() {
  ipcMain.handle("folder:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a media folder",
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const folderPath = result.filePaths[0];
    const files = await listMediaFiles(folderPath);

    return {
      folderPath,
      files
    };
  });

  ipcMain.handle("folder:read", async (_event, folderPath) => {
    if (typeof folderPath !== "string" || folderPath.length === 0) {
      return [];
    }

    return listMediaFiles(folderPath);
  });

  ipcMain.handle("display:get-state", () => ({
    isSpanningDisplays,
    displays: screen.getAllDisplays().map((display) => ({
      id: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor
    }))
  }));

  ipcMain.handle("display:set-span-all", (_event, enabled) => applySpanAllDisplays(Boolean(enabled)));
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  const reapplySpan = () => {
    if (isSpanningDisplays) {
      applySpanAllDisplays(true);
    }
  };

  screen.on("display-added", reapplySpan);
  screen.on("display-removed", reapplySpan);
  screen.on("display-metrics-changed", reapplySpan);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
