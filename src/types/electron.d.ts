declare global {
  interface Window {
    electronAPI?: {
      selectFolder: () => Promise<string | null>;
      listVideos: (folderPath: string) => Promise<string[]>;
      getDisplays: () => Promise<
        Array<{
          id: number;
          label: string;
          bounds: { x: number; y: number; width: number; height: number };
          workArea: { x: number; y: number; width: number; height: number };
          scaleFactor: number;
          isPrimary: boolean;
        }>
      >;
      moveToDisplay: (displayId: number) => Promise<void>;
      enterSpanFullscreen: () => Promise<void>;
      exitSpanFullscreen: () => Promise<void>;
      isSpanFullscreen: () => Promise<boolean>;
      saveLayout: (data: string) => Promise<void>;
      loadLayout: () => Promise<string | null>;
      toFileUrl: (filePath: string) => Promise<string>;
    };
  }
}

export {};
