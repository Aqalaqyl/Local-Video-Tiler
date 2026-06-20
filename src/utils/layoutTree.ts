import type { LayoutNode, LeafNode, SplitNode, TileRect } from '../types/layout';

let idCounter = 0;

export function generateId(prefix = 'node'): string {
  return `${prefix}-${++idCounter}-${Date.now().toString(36)}`;
}

export function createLeaf(folderPath: string | null = null): LeafNode {
  return {
    type: 'leaf',
    tile: {
      id: generateId('tile'),
      folderPath,
      videoIndex: 0,
    },
  };
}

export function createDefaultLayout(): LayoutNode {
  return createLeaf();
}

export function isLeaf(node: LayoutNode): node is LeafNode {
  return node.type === 'leaf';
}

export function isSplit(node: LayoutNode): node is SplitNode {
  return node.type === 'split';
}

export function snapToGrid(value: number, divisions: number): number {
  const step = 1 / divisions;
  return Math.round(value / step) * step;
}

export function clampRatio(ratio: number, min = 0.1, max = 0.9): number {
  return Math.min(max, Math.max(min, ratio));
}

export function collectTiles(node: LayoutNode): LeafNode[] {
  if (isLeaf(node)) return [node];
  return [...collectTiles(node.first), ...collectTiles(node.second)];
}

export function computeTileRects(
  node: LayoutNode,
  x = 0,
  y = 0,
  width = 1,
  height = 1
): TileRect[] {
  if (isLeaf(node)) {
    return [{ tileId: node.tile.id, x, y, width, height }];
  }

  if (node.direction === 'horizontal') {
    const splitX = width * node.ratio;
    return [
      ...computeTileRects(node.first, x, y, splitX, height),
      ...computeTileRects(node.second, x + splitX, y, width - splitX, height),
    ];
  }

  const splitY = height * node.ratio;
  return [
    ...computeTileRects(node.first, x, y, width, splitY),
    ...computeTileRects(node.second, x, y + splitY, width, height - splitY),
  ];
}

export function findNodeByTileId(
  node: LayoutNode,
  tileId: string
): { node: LayoutNode; parent: SplitNode | null; isFirst: boolean } | null {
  if (isLeaf(node)) {
    return node.tile.id === tileId ? { node, parent: null, isFirst: false } : null;
  }

  const inFirst = findNodeByTileId(node.first, tileId);
  if (inFirst) {
    return inFirst.parent === null
      ? { ...inFirst, parent: node, isFirst: true }
      : inFirst;
  }

  const inSecond = findNodeByTileId(node.second, tileId);
  if (inSecond) {
    return inSecond.parent === null
      ? { ...inSecond, parent: node, isFirst: false }
      : inSecond;
  }

  return null;
}

export function splitTile(
  layout: LayoutNode,
  tileId: string,
  direction: 'horizontal' | 'vertical'
): LayoutNode {
  if (isLeaf(layout)) {
    if (layout.tile.id !== tileId) return layout;
    return {
      type: 'split',
      id: generateId('split'),
      direction,
      ratio: 0.5,
      first: layout,
      second: createLeaf(),
    };
  }

  if (isLeaf(layout.first) && layout.first.tile.id === tileId) {
    return {
      ...layout,
      first: {
        type: 'split',
        id: generateId('split'),
        direction,
        ratio: 0.5,
        first: layout.first,
        second: createLeaf(),
      },
    };
  }

  if (isLeaf(layout.second) && layout.second.tile.id === tileId) {
    return {
      ...layout,
      second: {
        type: 'split',
        id: generateId('split'),
        direction,
        ratio: 0.5,
        first: layout.second,
        second: createLeaf(),
      },
    };
  }

  return {
    ...layout,
    first: splitTile(layout.first, tileId, direction),
    second: splitTile(layout.second, tileId, direction),
  };
}

export function updateSplitRatio(
  layout: LayoutNode,
  splitId: string,
  ratio: number
): LayoutNode {
  if (isLeaf(layout)) return layout;

  if (layout.id === splitId) {
    return { ...layout, ratio: clampRatio(ratio) };
  }

  return {
    ...layout,
    first: updateSplitRatio(layout.first, splitId, ratio),
    second: updateSplitRatio(layout.second, splitId, ratio),
  };
}

export function updateTileFolder(
  layout: LayoutNode,
  tileId: string,
  folderPath: string | null
): LayoutNode {
  if (isLeaf(layout)) {
    if (layout.tile.id !== tileId) return layout;
    return {
      ...layout,
      tile: { ...layout.tile, folderPath, videoIndex: 0 },
    };
  }

  return {
    ...layout,
    first: updateTileFolder(layout.first, tileId, folderPath),
    second: updateTileFolder(layout.second, tileId, folderPath),
  };
}

export function updateTileVideoIndex(
  layout: LayoutNode,
  tileId: string,
  videoIndex: number
): LayoutNode {
  if (isLeaf(layout)) {
    if (layout.tile.id !== tileId) return layout;
    return {
      ...layout,
      tile: { ...layout.tile, videoIndex },
    };
  }

  return {
    ...layout,
    first: updateTileVideoIndex(layout.first, tileId, videoIndex),
    second: updateTileVideoIndex(layout.second, tileId, videoIndex),
  };
}

export function removeTile(layout: LayoutNode, tileId: string): LayoutNode {
  const tiles = collectTiles(layout);
  if (tiles.length <= 1) return layout;

  const found = findNodeByTileId(layout, tileId);
  if (!found || !found.parent) return layout;

  const sibling = found.isFirst ? found.parent.second : found.parent.first;

  return replaceNode(layout, found.parent.id, sibling);
}

function replaceNode(
  node: LayoutNode,
  targetId: string,
  replacement: LayoutNode
): LayoutNode {
  if (isLeaf(node)) return node;
  if (node.id === targetId) return replacement;

  return {
    ...node,
    first: replaceNode(node.first, targetId, replacement),
    second: replaceNode(node.second, targetId, replacement),
  };
}

export function getSplitBoundaries(node: LayoutNode): Array<{
  id: string;
  direction: 'horizontal' | 'vertical';
  position: number;
  start: number;
  end: number;
}> {
  const boundaries: Array<{
    id: string;
    direction: 'horizontal' | 'vertical';
    position: number;
    start: number;
    end: number;
  }> = [];

  function walk(n: LayoutNode, x: number, y: number, w: number, h: number) {
    if (isLeaf(n)) return;

    if (n.direction === 'horizontal') {
      const pos = x + w * n.ratio;
      boundaries.push({
        id: n.id,
        direction: 'horizontal',
        position: pos,
        start: y,
        end: y + h,
      });
      walk(n.first, x, y, w * n.ratio, h);
      walk(n.second, x + w * n.ratio, y, w * (1 - n.ratio), h);
    } else {
      const pos = y + h * n.ratio;
      boundaries.push({
        id: n.id,
        direction: 'vertical',
        position: pos,
        start: x,
        end: x + w,
      });
      walk(n.first, x, y, w, h * n.ratio);
      walk(n.second, x, y + h * n.ratio, w, h * (1 - n.ratio));
    }
  }

  walk(node, 0, 0, 1, 1);
  return boundaries;
}
