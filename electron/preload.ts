import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  listVideos: (folderPath: string) => ipcRenderer.invoke('list-videos', folderPath),
  toFileUrl: (filePath: string) => ipcRenderer.invoke('to-file-url', filePath),
  enterViewMode: (displayMode: 'single' | 'all', displayId?: number) =>
    ipcRenderer.invoke('enter-view-mode', displayMode, displayId),
  exitViewMode: () => ipcRenderer.invoke('exit-view-mode'),
  saveLayout: (layout: unknown) => ipcRenderer.invoke('save-layout', layout),
  loadLayout: () => ipcRenderer.invoke('load-layout'),
  onViewModeChanged: (callback: (isViewMode: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isViewMode: boolean) =>
      callback(isViewMode);
    ipcRenderer.on('view-mode-changed', handler);
    return () => ipcRenderer.removeListener('view-mode-changed', handler);
  },
  onDisplayLayout: (
    callback: (data: { displays: unknown[]; mode: 'single' | 'all' }) => void
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
      callback(data as { displays: unknown[]; mode: 'single' | 'all' });
    ipcRenderer.on('display-layout', handler);
    return () => ipcRenderer.removeListener('display-layout', handler);
  },
});
