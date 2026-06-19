'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Media / folders
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  readFolder: (folderPath) => ipcRenderer.invoke('media:readFolder', folderPath),

  // Displays
  getDisplayInfo: () => ipcRenderer.invoke('display:getInfo'),
  onDisplayChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('display:changed', handler);
    return () => ipcRenderer.removeListener('display:changed', handler);
  },

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  toggleFullscreen: () => ipcRenderer.send('window:toggleFullscreen'),
  toggleSpanAll: () => ipcRenderer.send('window:toggleSpanAll'),
  requestWindowState: () => ipcRenderer.send('window:requestState'),
  onWindowState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('window:state', handler);
    return () => ipcRenderer.removeListener('window:state', handler);
  }
});
