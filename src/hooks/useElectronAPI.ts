import { useEffect, useState, useCallback } from 'react';

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
}

export function useElectronAPI() {
  const api = window.electronAPI;

  const selectFolder = useCallback(async () => {
    if (!api) return null;
    return api.selectFolder();
  }, [api]);

  const listVideos = useCallback(
    async (folderPath: string) => {
      if (!api) return [];
      return api.listVideos(folderPath);
    },
    [api]
  );

  const getDisplays = useCallback(async () => {
    if (!api) return [];
    return api.getDisplays();
  }, [api]);

  const moveToDisplay = useCallback(
    async (displayId: number) => {
      if (!api) return;
      return api.moveToDisplay(displayId);
    },
    [api]
  );

  const enterSpanFullscreen = useCallback(async () => {
    if (!api) return;
    return api.enterSpanFullscreen();
  }, [api]);

  const exitSpanFullscreen = useCallback(async () => {
    if (!api) return;
    return api.exitSpanFullscreen();
  }, [api]);

  const saveLayout = useCallback(
    async (data: string) => {
      if (!api) return;
      return api.saveLayout(data);
    },
    [api]
  );

  const loadLayout = useCallback(async () => {
    if (!api) return null;
    return api.loadLayout();
  }, [api]);

  const toFileUrl = useCallback(
    async (filePath: string) => {
      if (!api) return `file://${filePath}`;
      return api.toFileUrl(filePath);
    },
    [api]
  );

  return {
    isElectron: !!api,
    selectFolder,
    listVideos,
    getDisplays,
    moveToDisplay,
    enterSpanFullscreen,
    exitSpanFullscreen,
    saveLayout,
    loadLayout,
    toFileUrl,
  };
}

export function useDisplays() {
  const { getDisplays } = useElectronAPI();
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);

  useEffect(() => {
    getDisplays().then(setDisplays);
    const interval = setInterval(() => getDisplays().then(setDisplays), 5000);
    return () => clearInterval(interval);
  }, [getDisplays]);

  return displays;
}
