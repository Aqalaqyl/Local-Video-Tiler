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
  },

  // Projection / multi-display fullscreen
  onProjection: (cb) => {
    const handler = (_e, config) => cb(config);
    ipcRenderer.on('projection:set', handler);
    return () => ipcRenderer.removeListener('projection:set', handler);
  },
  // Controller → mirrors: push the current layout (serialized tree).
  pushLayout: (payload) => ipcRenderer.send('projection:pushLayout', payload),
  // Mirror → controller: ask for the current layout once ready.
  requestLayout: () => ipcRenderer.send('projection:requestLayout'),
  onProvideLayout: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('projection:provideLayout', handler);
    return () => ipcRenderer.removeListener('projection:provideLayout', handler);
  },
  onLayout: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('projection:layout', handler);
    return () => ipcRenderer.removeListener('projection:layout', handler);
  }
});
