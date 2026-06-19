import { contextBridge, ipcRenderer } from 'electron';

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
}

const api = {
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
  listVideos: (folderPath: string): Promise<string[]> =>
    ipcRenderer.invoke('list-videos', folderPath),
  getDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('get-displays'),
  moveToDisplay: (displayId: number): Promise<void> =>
    ipcRenderer.invoke('move-to-display', displayId),
  enterSpanFullscreen: (): Promise<void> => ipcRenderer.invoke('enter-span-fullscreen'),
  exitSpanFullscreen: (): Promise<void> => ipcRenderer.invoke('exit-span-fullscreen'),
  isSpanFullscreen: (): Promise<boolean> => ipcRenderer.invoke('is-span-fullscreen'),
  saveLayout: (data: string): Promise<void> => ipcRenderer.invoke('save-layout', data),
  loadLayout: (): Promise<string | null> => ipcRenderer.invoke('load-layout'),
  toFileUrl: (filePath: string): Promise<string> => ipcRenderer.invoke('to-file-url', filePath),
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
