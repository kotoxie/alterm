import type { PaneNode, PaneRect } from '../types/panes';

export const DIVIDER_SIZE = 4;

export function getLeafIds(node: PaneNode): string[] {
  if (node.type === 'leaf') return [node.id];
  return [...getLeafIds(node.a), ...getLeafIds(node.b)];
}

export function countLeaves(node: PaneNode): number {
  if (node.type === 'leaf') return 1;
  return countLeaves(node.a) + countLeaves(node.b);
}

export function addSplit(
  tree: PaneNode,
  targetId: string,
  dir: 'h' | 'v',
  newId: string,
): PaneNode {
  if (tree.type === 'leaf') {
    if (tree.id === targetId) {
      return {
        type: 'split',
        id: crypto.randomUUID(),
        dir,
        ratio: 0.5,
        a: { type: 'leaf', id: tree.id },
        b: { type: 'leaf', id: newId },
      };
    }
    return tree;
  }
  return {
    ...tree,
    a: addSplit(tree.a, targetId, dir, newId),
    b: addSplit(tree.b, targetId, dir, newId),
  };
}

export function removeLeaf(tree: PaneNode, id: string): PaneNode | null {
  if (tree.type === 'leaf') {
    return tree.id === id ? null : tree;
  }
  const newA = removeLeaf(tree.a, id);
  const newB = removeLeaf(tree.b, id);
  // If one side was removed, collapse to sibling
  if (newA === null) return newB;
  if (newB === null) return newA;
  return { ...tree, a: newA, b: newB };
}

export function updateRatio(tree: PaneNode, splitId: string, ratio: number): PaneNode {
  if (tree.type === 'leaf') return tree;
  if (tree.id === splitId) {
    return { ...tree, ratio };
  }
  return {
    ...tree,
    a: updateRatio(tree.a, splitId, ratio),
    b: updateRatio(tree.b, splitId, ratio),
  };
}

export function computeLeafRects(
  node: PaneNode,
  x: number,
  y: number,
  w: number,
  h: number,
): Record<string, PaneRect> {
  if (node.type === 'leaf') {
    return { [node.id]: { x, y, w, h } };
  }
  if (node.dir === 'h') {
    // horizontal split: a on left, b on right
    const aW = Math.round(node.ratio * (w - DIVIDER_SIZE));
    const bW = w - DIVIDER_SIZE - aW;
    return {
      ...computeLeafRects(node.a, x, y, aW, h),
      ...computeLeafRects(node.b, x + aW + DIVIDER_SIZE, y, bW, h),
    };
  } else {
    // vertical split: a on top, b on bottom
    const aH = Math.round(node.ratio * (h - DIVIDER_SIZE));
    const bH = h - DIVIDER_SIZE - aH;
    return {
      ...computeLeafRects(node.a, x, y, w, aH),
      ...computeLeafRects(node.b, x, y + aH + DIVIDER_SIZE, w, bH),
    };
  }
}

interface DividerInfo {
  id: string;
  dir: 'h' | 'v';
  x: number;
  y: number;
  w: number;
  h: number;
}

export function computeSplitDividers(
  node: PaneNode,
  leafRects: Record<string, PaneRect>,
): DividerInfo[] {
  if (node.type === 'leaf') return [];

  const dividers: DividerInfo[] = [];

  // Get the bounding box of children by taking union of their leaf rects
  function getBounds(n: PaneNode): { x: number; y: number; x2: number; y2: number } | null {
    const ids = getLeafIds(n);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const r = leafRects[id];
      if (!r) return null;
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.w > maxX) maxX = r.x + r.w;
      if (r.y + r.h > maxY) maxY = r.y + r.h;
    }
    return { x: minX, y: minY, x2: maxX, y2: maxY };
  }

  const aBounds = getBounds(node.a);
  const bBounds = getBounds(node.b);

  if (aBounds && bBounds) {
    if (node.dir === 'h') {
      // Divider is vertical strip between a's right edge and b's left edge
      const divX = aBounds.x2;
      const divY = Math.min(aBounds.y, bBounds.y);
      const divH = Math.max(aBounds.y2, bBounds.y2) - divY;
      dividers.push({
        id: node.id,
        dir: 'h',
        x: divX,
        y: divY,
        w: DIVIDER_SIZE,
        h: divH,
      });
    } else {
      // Divider is horizontal strip between a's bottom edge and b's top edge
      const divX = Math.min(aBounds.x, bBounds.x);
      const divY = aBounds.y2;
      const divW = Math.max(aBounds.x2, bBounds.x2) - divX;
      dividers.push({
        id: node.id,
        dir: 'v',
        x: divX,
        y: divY,
        w: divW,
        h: DIVIDER_SIZE,
      });
    }
  }

  // Recurse into children
  dividers.push(...computeSplitDividers(node.a, leafRects));
  dividers.push(...computeSplitDividers(node.b, leafRects));

  return dividers;
}
