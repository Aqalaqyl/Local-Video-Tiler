export type SplitDirection = 'vertical' | 'horizontal';

export interface TileLeaf {
  type: 'leaf';
  id: string;
  folderPath: string | null;
  selectedVideo: string | null;
}

export interface TileSplit {
  type: 'split';
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: TileNode;
  second: TileNode;
}

export type TileNode = TileLeaf | TileSplit;

export interface AppSettings {
  editMode: boolean;
  showGrid: boolean;
  snapEnabled: boolean;
  gridDivisions: number;
  uiVisible: boolean;
  spanFullscreen: boolean;
  activeDisplayId: number | null;
}

export interface SplitPreview {
  tileId: string;
  direction: SplitDirection;
  ratio: number;
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileLayoutInfo {
  node: TileNode;
  rect: Rect;
}
