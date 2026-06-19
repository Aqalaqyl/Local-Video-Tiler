const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("videoTiler", {
  selectFolder: () => ipcRenderer.invoke("dialog:select-folder"),
  listMediaFiles: (folderPath) => ipcRenderer.invoke("media:list-files", folderPath),
  setSpanAllDisplays: (enabled) =>
    ipcRenderer.invoke("window:set-span-all-displays", enabled),
  getDisplayInfo: () => ipcRenderer.invoke("window:get-display-info"),
  onDisplaysChanged: (callback) => {
    const listener = (_, info) => callback(info);
    ipcRenderer.on("displays:changed", listener);
    return () => ipcRenderer.removeListener("displays:changed", listener);
  },
});
