import { v4 as uuidv4 } from 'uuid';
import type { TileLeaf, TileNode, TileSplit, SplitDirection, Rect, TileLayoutInfo } from '../types/layout';

export function createLeaf(folderPath: string | null = null): TileLeaf {
  return {
    type: 'leaf',
    id: uuidv4(),
    folderPath,
    selectedVideo: null,
  };
}

export function createDefaultLayout(): TileNode {
  return createLeaf();
}

export function findNode(root: TileNode, id: string): TileNode | null {
  if (root.id === id) return root;
  if (root.type === 'split') {
    return findNode(root.first, id) ?? findNode(root.second, id);
  }
  return null;
}

export function findParent(
  root: TileNode,
  id: string,
  parent: TileSplit | null = null
): { parent: TileSplit | null; childKey: 'first' | 'second' | null } | null {
  if (root.id === id) {
    if (!parent) return { parent: null, childKey: null };
    return {
      parent,
      childKey: parent.first.id === id ? 'first' : 'second',
    };
  }
  if (root.type === 'split') {
    return (
      findParent(root.first, id, root) ?? findParent(root.second, id, root)
    );
  }
  return null;
}

export function splitTile(
  root: TileNode,
  tileId: string,
  direction: SplitDirection,
  ratio: number
): TileNode {
  const node = findNode(root, tileId);
  if (!node || node.type !== 'leaf') return root;

  const split: TileNode = {
    type: 'split',
    id: uuidv4(),
    direction,
    ratio,
    first: { ...node, id: node.id },
    second: createLeaf(node.folderPath),
  };

  const parentInfo = findParent(root, tileId);
  if (!parentInfo?.parent) return split;

  const { parent, childKey } = parentInfo;
  const newParent = { ...parent };
  if (childKey === 'first') newParent.first = split;
  else newParent.second = split;

  return replaceNode(root, parent.id, newParent);
}

function replaceNode(root: TileNode, targetId: string, replacement: TileNode): TileNode {
  if (root.id === targetId) return replacement;
  if (root.type === 'split') {
    return {
      ...root,
      first: replaceNode(root.first, targetId, replacement),
      second: replaceNode(root.second, targetId, replacement),
    };
  }
  return root;
}

export function updateLeaf(
  root: TileNode,
  tileId: string,
  updates: Partial<Pick<TileLeaf, 'folderPath' | 'selectedVideo'>>
): TileNode {
  if (root.type === 'leaf' && root.id === tileId) {
    return { ...root, ...updates };
  }
  if (root.type === 'split') {
    return {
      ...root,
      first: updateLeaf(root.first, tileId, updates),
      second: updateLeaf(root.second, tileId, updates),
    };
  }
  return root;
}

export function removeTile(root: TileNode, tileId: string): TileNode {
  const parentInfo = findParent(root, tileId);
  if (!parentInfo?.parent || !parentInfo.childKey) {
    if (root.type === 'leaf' && root.id === tileId) return createLeaf();
    return root;
  }

  const { parent, childKey } = parentInfo;
  const sibling = childKey === 'first' ? parent.second : parent.first;
  const grandParentInfo = findParent(root, parent.id);

  if (!grandParentInfo?.parent) return sibling;

  const { parent: grandParent, childKey: gpChildKey } = grandParentInfo;
  const newGrandParent = { ...grandParent };
  if (gpChildKey === 'first') newGrandParent.first = sibling;
  else newGrandParent.second = sibling;

  return replaceNode(root, grandParent.id, newGrandParent);
}

export function computeLayouts(
  node: TileNode,
  rect: Rect,
  gap = 2
): TileLayoutInfo[] {
  if (node.type === 'leaf') {
    return [{ node, rect }];
  }

  const { direction, ratio, first, second } = node;
  const halfGap = gap / 2;

  if (direction === 'vertical') {
    const splitX = rect.x + rect.width * ratio;
    const firstRect: Rect = {
      x: rect.x,
      y: rect.y,
      width: rect.width * ratio - halfGap,
      height: rect.height,
    };
    const secondRect: Rect = {
      x: splitX + halfGap,
      y: rect.y,
      width: rect.width * (1 - ratio) - halfGap,
      height: rect.height,
    };
    return [
      ...computeLayouts(first, firstRect, gap),
      ...computeLayouts(second, secondRect, gap),
    ];
  }

  const splitY = rect.y + rect.height * ratio;
  const firstRect: Rect = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height * ratio - halfGap,
  };
  const secondRect: Rect = {
    x: rect.x,
    y: splitY + halfGap,
    width: rect.width,
    height: rect.height * (1 - ratio) - halfGap,
  };
  return [
    ...computeLayouts(first, firstRect, gap),
    ...computeLayouts(second, secondRect, gap),
  ];
}

export function findTileAtPoint(
  layouts: TileLayoutInfo[],
  x: number,
  y: number
): TileLayoutInfo | null {
  for (const layout of layouts) {
    const { rect } = layout;
    if (
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height &&
      layout.node.type === 'leaf'
    ) {
      return layout;
    }
  }
  return null;
}

export function snapRatio(ratio: number, divisions: number): number {
  const step = 1 / divisions;
  return Math.max(step, Math.min(1 - step, Math.round(ratio / step) * step));
}

export function computeSplitRatio(
  rect: Rect,
  direction: SplitDirection,
  x: number,
  y: number,
  snapEnabled: boolean,
  gridDivisions: number
): number {
  let ratio: number;
  if (direction === 'vertical') {
    ratio = (x - rect.x) / rect.width;
  } else {
    ratio = (y - rect.y) / rect.height;
  }
  ratio = Math.max(0.1, Math.min(0.9, ratio));
  if (snapEnabled) {
    ratio = snapRatio(ratio, gridDivisions);
  }
  return ratio;
}

export function countLeaves(node: TileNode): number {
  if (node.type === 'leaf') return 1;
  return countLeaves(node.first) + countLeaves(node.second);
}
