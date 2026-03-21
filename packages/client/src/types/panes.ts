export interface PaneLeaf {
  type: 'leaf';
  id: string;
}

export interface PaneSplit {
  type: 'split';
  id: string;
  dir: 'h' | 'v';
  ratio: number;
  a: PaneNode;
  b: PaneNode;
}

export type PaneNode = PaneLeaf | PaneSplit;

export interface PaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
