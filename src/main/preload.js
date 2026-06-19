const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mediaTiler", {
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  readFolder: (folderPath) => ipcRenderer.invoke("folder:read", folderPath),
  getDisplayState: () => ipcRenderer.invoke("display:get-state"),
  setSpanAllDisplays: (enabled) => ipcRenderer.invoke("display:set-span-all", enabled)
});
