const { app, BrowserWindow, dialog, ipcMain, screen } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".mkv",
  ".webm",
  ".mov",
  ".avi",
  ".flv",
  ".wmv",
]);

let mainWindow = null;
let spanAllDisplays = false;
let restoreState = null;

const getVirtualDisplayBounds = () => {
  const displays = screen.getAllDisplays();
  const minX = Math.min(...displays.map((display) => display.bounds.x));
  const minY = Math.min(...displays.map((display) => display.bounds.y));
  const maxX = Math.max(
    ...displays.map((display) => display.bounds.x + display.bounds.width),
  );
  const maxY = Math.max(
    ...displays.map((display) => display.bounds.y + display.bounds.height),
  );

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const getDisplayInfo = () => ({
  count: screen.getAllDisplays().length,
  spanningBounds: getVirtualDisplayBounds(),
  spanAllDisplays,
});

const applySpanAllDisplays = (enabled) => {
  if (!mainWindow) {
    return false;
  }

  if (enabled === spanAllDisplays) {
    return spanAllDisplays;
  }

  if (enabled) {
    restoreState = {
      bounds: mainWindow.getBounds(),
      wasMaximized: mainWindow.isMaximized(),
      wasFullScreen: mainWindow.isFullScreen(),
    };

    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    }

    mainWindow.setBounds(getVirtualDisplayBounds(), true);
  } else if (restoreState) {
    mainWindow.setBounds(restoreState.bounds, true);
    if (restoreState.wasMaximized) {
      mainWindow.maximize();
    }
    if (restoreState.wasFullScreen) {
      mainWindow.setFullScreen(true);
    }
  }

  spanAllDisplays = enabled;
  return spanAllDisplays;
};

const listMediaFiles = async (folderPath) => {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) =>
      VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase()),
    )
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((fileName) => {
      const fullPath = path.join(folderPath, fileName);
      return {
        name: fileName,
        path: fullPath,
        url: pathToFileURL(fullPath).toString(),
      };
    });
};

const createMainWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 900,
    minHeight: 620,
    autoHideMenuBar: true,
    backgroundColor: "#0b0d11",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
};

ipcMain.handle("dialog:select-folder", async () => {
  if (!mainWindow) {
    return null;
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "dontAddToRecent"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("media:list-files", async (_, folderPath) => {
  if (!folderPath) {
    return [];
  }

  try {
    return await listMediaFiles(folderPath);
  } catch {
    return [];
  }
});

ipcMain.handle("window:set-span-all-displays", (_, enabled) => {
  applySpanAllDisplays(Boolean(enabled));
  return getDisplayInfo();
});

ipcMain.handle("window:get-display-info", () => getDisplayInfo());

const emitDisplayUpdate = () => {
  if (!mainWindow) {
    return;
  }

  if (spanAllDisplays) {
    mainWindow.setBounds(getVirtualDisplayBounds(), true);
  }

  mainWindow.webContents.send("displays:changed", getDisplayInfo());
};

app.whenReady().then(async () => {
  await createMainWindow();

  screen.on("display-added", emitDisplayUpdate);
  screen.on("display-removed", emitDisplayUpdate);
  screen.on("display-metrics-changed", emitDisplayUpdate);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
