const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('tilerAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getVideosInFolder: (folderPath) => ipcRenderer.invoke('get-videos-in-folder', folderPath),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  setDisplayMode: (mode, displayId) =>
    ipcRenderer.invoke('set-display-mode', { mode, displayId }),
  exitFullscreen: () => ipcRenderer.invoke('exit-fullscreen'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
  toFileURL: (filePath) => pathToFileURL(filePath).href,
});
