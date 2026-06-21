let nextId = 1;

export function createLeaf(overrides = {}) {
  return {
    id: `tile-${nextId++}`,
    type: 'leaf',
    folderPath: null,
    videos: [],
    videoIndex: 0,
    ...overrides,
  };
}

export function createSplit(direction, ratio = 0.5, first = null, second = null) {
  return {
    id: `split-${nextId++}`,
    type: 'split',
    direction,
    ratio,
    first: first ?? createLeaf(),
    second: second ?? createLeaf(),
  };
}

export function findNode(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  if (root.type === 'split') {
    return findNode(root.first, id) || findNode(root.second, id);
  }
  return null;
}

export function findParent(root, id, parent = null) {
  if (!root) return null;
  if (root.id === id) return parent;
  if (root.type === 'split') {
    return findParent(root.first, id, root) || findParent(root.second, id, root);
  }
  return null;
}

export function splitLeaf(root, leafId, direction) {
  const leaf = findNode(root, leafId);
  if (!leaf || leaf.type !== 'leaf') return root;

  const parent = findParent(root, leafId);
  const split = createSplit(direction, 0.5, leaf, createLeaf());

  if (!parent) {
    return split;
  }

  if (parent.first?.id === leafId) {
    parent.first = split;
  } else {
    parent.second = split;
  }

  return root;
}

export function removeLeaf(root, leafId) {
  const parent = findParent(root, leafId);
  if (!parent) return root;

  const sibling = parent.first?.id === leafId ? parent.second : parent.first;
  const grandparent = findParent(root, parent.id);

  if (!grandparent) {
    return sibling;
  }

  if (grandparent.first?.id === parent.id) {
    grandparent.first = sibling;
  } else {
    grandparent.second = sibling;
  }

  return root;
}

export function updateRatio(root, splitId, ratio) {
  const split = findNode(root, splitId);
  if (split?.type === 'split') {
    split.ratio = Math.max(0.08, Math.min(0.92, ratio));
  }
  return root;
}

export function assignFolder(root, leafId, folderPath, videos) {
  const leaf = findNode(root, leafId);
  if (leaf?.type === 'leaf') {
    leaf.folderPath = folderPath;
    leaf.videos = videos;
    leaf.videoIndex = 0;
  }
  return root;
}

export function setVideoIndex(root, leafId, index) {
  const leaf = findNode(root, leafId);
  if (leaf?.type === 'leaf' && leaf.videos.length > 0) {
    leaf.videoIndex = ((index % leaf.videos.length) + leaf.videos.length) % leaf.videos.length;
  }
  return root;
}

export function collectLeaves(node, leaves = []) {
  if (!node) return leaves;
  if (node.type === 'leaf') {
    leaves.push(node);
  } else {
    collectLeaves(node.first, leaves);
    collectLeaves(node.second, leaves);
  }
  return leaves;
}

export function collectSplits(node, splits = []) {
  if (!node) return splits;
  if (node.type === 'split') {
    splits.push(node);
    collectSplits(node.first, splits);
    collectSplits(node.second, splits);
  }
  return splits;
}

export function cloneTree(node) {
  if (!node) return null;
  if (node.type === 'leaf') {
    return {
      ...node,
      videos: [...(node.videos || [])],
    };
  }
  return {
    ...node,
    first: cloneTree(node.first),
    second: cloneTree(node.second),
  };
}

export function serializeTree(root) {
  return JSON.stringify(cloneTree(root));
}

export function deserializeTree(json) {
  try {
    const parsed = JSON.parse(json);
    let maxId = 0;
    const walk = (node) => {
      if (!node) return;
      const match = node.id?.match(/(\d+)$/);
      if (match) maxId = Math.max(maxId, Number(match[1]));
      if (node.type === 'split') {
        walk(node.first);
        walk(node.second);
      }
    };
    walk(parsed);
    nextId = maxId + 1;
    return parsed;
  } catch {
    return createLeaf();
  }
}

export function snapRatio(ratio, gridDivisions, enabled) {
  if (!enabled || gridDivisions <= 1) return ratio;
  const step = 1 / gridDivisions;
  return Math.round(ratio / step) * step;
}
