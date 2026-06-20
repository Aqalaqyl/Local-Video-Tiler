export interface TileData {
  id: string;
  folderPath: string | null;
  videoIndex: number;
}

export interface SplitNode {
  type: 'split';
  id: string;
  direction: 'horizontal' | 'vertical';
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export interface LeafNode {
  type: 'leaf';
  tile: TileData;
}

export type LayoutNode = SplitNode | LeafNode;

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
}

export interface AppState {
  layout: LayoutNode;
  mode: 'edit' | 'view';
  displayMode: 'single' | 'all';
  selectedDisplayId: number | null;
  showGrid: boolean;
  gridColumns: number;
  gridRows: number;
  showSplitIndicator: boolean;
  controlsVisible: boolean;
}

export interface TileRect {
  tileId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoFile {
  name: string;
  path: string;
}

export interface ElectronAPI {
  getDisplays: () => Promise<DisplayInfo[]>;
  selectFolder: () => Promise<string | null>;
  listVideos: (folderPath: string) => Promise<VideoFile[]>;
  toFileUrl: (filePath: string) => Promise<string>;
  enterViewMode: (displayMode: 'single' | 'all', displayId?: number) => Promise<void>;
  exitViewMode: () => Promise<void>;
  saveLayout: (layout: LayoutNode) => Promise<void>;
  loadLayout: () => Promise<LayoutNode | null>;
  onViewModeChanged: (callback: (isViewMode: boolean) => void) => () => void;
  onDisplayLayout: (callback: (data: { displays: DisplayInfo[]; mode: 'single' | 'all' }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
