import { useRef } from 'react';
import type { PaneNode, PaneRect } from '../types/panes';
import type { Tab } from '../pages/MainLayout';
import { getLeafIds, computeSplitDividers, DIVIDER_SIZE } from '../utils/panes';

interface PaneOverlayProps {
  paneRoot: PaneNode;
  leafRects: Record<string, PaneRect>;
  paneTabMap: Record<string, string | null>;
  activePaneId: string;
  tabs: Tab[];
  onFocusPane: (id: string) => void;
  onClosePane: (id: string) => void;
  onUpdateRatio: (splitId: string, ratio: number) => void;
  containerW: number;
  containerH: number;
}

function findSplitRatio(node: PaneNode, splitId: string): number | null {
  if (node.type === 'leaf') return null;
  if (node.id === splitId) return node.ratio;
  return findSplitRatio(node.a, splitId) ?? findSplitRatio(node.b, splitId);
}

function getSplitTotalSize(
  node: PaneNode,
  splitId: string,
  dir: 'h' | 'v',
  leafRects: Record<string, PaneRect>,
): number {
  if (node.type === 'leaf') return 0;

  if (node.id === splitId) {
    const aIds = getLeafIds(node.a);
    const bIds = getLeafIds(node.b);
    const allIds = [...aIds, ...bIds];
    if (allIds.length === 0) return 0;

    let min = Infinity, max = -Infinity;
    for (const id of allIds) {
      const r = leafRects[id];
      if (!r) continue;
      if (dir === 'h') {
        if (r.x < min) min = r.x;
        if (r.x + r.w > max) max = r.x + r.w;
      } else {
        if (r.y < min) min = r.y;
        if (r.y + r.h > max) max = r.y + r.h;
      }
    }
    return max - min + DIVIDER_SIZE;
  }

  return (
    getSplitTotalSize(node.a, splitId, dir, leafRects) ||
    getSplitTotalSize(node.b, splitId, dir, leafRects)
  );
}

export function PaneOverlay({
  paneRoot,
  leafRects,
  paneTabMap,
  activePaneId,
  tabs: _tabs,
  onFocusPane,
  onClosePane,
  onUpdateRatio,
  containerW: _containerW,
  containerH: _containerH,
}: PaneOverlayProps) {
  const dividerDragRef = useRef<{
    splitId: string;
    dir: 'h' | 'v';
    startX: number;
    startY: number;
    startRatio: number;
    totalSize: number;
  } | null>(null);

  const leafIds = getLeafIds(paneRoot);
  const paneCount = leafIds.length;
  const dividers = computeSplitDividers(paneRoot, leafRects);

  function handleDividerMouseDown(
    e: React.MouseEvent,
    splitId: string,
    dir: 'h' | 'v',
  ) {
    e.preventDefault();
    e.stopPropagation();

    const startRatio = findSplitRatio(paneRoot, splitId) ?? 0.5;
    const totalSize = getSplitTotalSize(paneRoot, splitId, dir, leafRects);

    dividerDragRef.current = {
      splitId,
      dir,
      startX: e.clientX,
      startY: e.clientY,
      startRatio,
      totalSize,
    };

    const onMouseMove = (ev: MouseEvent) => {
      const drag = dividerDragRef.current;
      if (!drag || drag.totalSize <= 0) return;
      const delta = drag.dir === 'h' ? ev.clientX - drag.startX : ev.clientY - drag.startY;
      const newRatio = Math.max(0.1, Math.min(0.9, drag.startRatio + delta / drag.totalSize));
      onUpdateRatio(drag.splitId, newRatio);
    };

    const onMouseUp = () => {
      dividerDragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // Only render when there's something to show (multi-pane or empty pane)
  const hasEmptyPane = leafIds.some((id) => !paneTabMap[id]);
  if (paneCount <= 1 && !hasEmptyPane) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      {/* Empty pane placeholders */}
      {leafIds.map((paneId) => {
        const tabId = paneTabMap[paneId];
        const rect = leafRects[paneId];
        if (!rect || tabId) return null;

        return (
          <div
            key={`empty-${paneId}`}
            className="absolute pointer-events-auto cursor-pointer bg-surface flex items-center justify-center"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            onClick={() => onFocusPane(paneId)}
          >
            <div className="text-center text-text-secondary select-none">
              <svg
                className="mx-auto mb-2 opacity-30"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
              <p className="text-sm">Select a connection from the sidebar</p>
            </div>
          </div>
        );
      })}

      {/* Unfocused occupied pane click blockers */}
      {paneCount > 1 &&
        leafIds.map((paneId) => {
          const tabId = paneTabMap[paneId];
          const rect = leafRects[paneId];
          if (!rect || !tabId || paneId === activePaneId) return null;

          return (
            <div
              key={`blocker-${paneId}`}
              className="absolute pointer-events-auto cursor-pointer"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              onClick={() => onFocusPane(paneId)}
            />
          );
        })}

      {/* Focus ring on active pane */}
      {paneCount > 1 && (() => {
        const rect = leafRects[activePaneId];
        if (!rect) return null;
        return (
          <div
            className="absolute pointer-events-none ring-1 ring-inset ring-accent/60"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          />
        );
      })()}

      {/* Close buttons per pane */}
      {paneCount > 1 &&
        leafIds.map((paneId) => {
          const rect = leafRects[paneId];
          if (!rect) return null;

          return (
            <button
              key={`close-${paneId}`}
              className="absolute pointer-events-auto z-20 w-5 h-5 flex items-center justify-center rounded bg-surface/80 hover:bg-red-500/80 text-text-secondary hover:text-white opacity-0 hover:opacity-100 transition-all border border-border/40 shadow"
              style={{
                left: rect.x + rect.w - 22,
                top: rect.y + 4,
              }}
              onClick={(e) => { e.stopPropagation(); onClosePane(paneId); }}
              title="Close pane"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          );
        })}

      {/* Divider resize handles */}
      {dividers.map((div) => (
        <div
          key={`divider-${div.id}`}
          className={`absolute pointer-events-auto bg-border/60 hover:bg-accent/60 transition-colors ${
            div.dir === 'h' ? 'cursor-col-resize' : 'cursor-row-resize'
          }`}
          style={{ left: div.x, top: div.y, width: div.w, height: div.h }}
          onMouseDown={(e) => handleDividerMouseDown(e, div.id, div.dir)}
        />
      ))}
    </div>
  );
}
