import { useState, useRef, useEffect, useCallback } from 'react';

interface ResultsGridProps {
  columns: string[];
  rows: unknown[][];
  truncated?: boolean;
  onExport?: (format: 'csv' | 'json') => void;
}

const ROW_HEIGHT = 28;
const OVERSCAN = 5;

function cellToString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export function ResultsGrid({ columns, rows, truncated, onExport }: ResultsGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [colWidths, setColWidths] = useState<number[]>(() => columns.map(() => 150));
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  // ResizeObserver must observe the scrollable div.
  // We use a callback ref so it re-attaches whenever the element mounts/unmounts.
  const attachObserver = useCallback((el: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      setContainerHeight(entries[0].contentRect.height);
    });
    obs.observe(el);
    // Store cleanup on the element itself
    (el as HTMLDivElement & { _resizeCleanup?: () => void })._resizeCleanup = () => obs.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      const el = containerRef.current as (HTMLDivElement & { _resizeCleanup?: () => void }) | null;
      el?._resizeCleanup?.();
    };
  }, []);

  // Reset sort/scroll when result set changes
  useEffect(() => {
    setSortCol(null);
    setColWidths(columns.map(() => 150));
    setScrollTop(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [columns.join(',')]);

  const sortedRows = (() => {
    if (sortCol === null) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  })();

  const totalHeight = sortedRows.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(sortedRows.length, Math.ceil((scrollTop + Math.max(containerHeight, 1)) / ROW_HEIGHT) + OVERSCAN);
  const visibleRows = sortedRows.slice(startIdx, endIdx);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const handleSortClick = (colIdx: number) => {
    if (sortCol === colIdx) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(colIdx);
      setSortDir('asc');
    }
  };

  const copyCell = (val: unknown) => {
    const s = cellToString(val);
    navigator.clipboard.writeText(s).catch(() => {});
    const key = s.slice(0, 50);
    setCopiedCell(key);
    setTimeout(() => setCopiedCell(null), 1500);
  };

  const resizeHandleMouseDown = (colIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[colIdx];
    const onMove = (me: MouseEvent) => {
      const newW = Math.max(60, startW + me.clientX - startX);
      setColWidths(prev => { const next = [...prev]; next[colIdx] = newW; return next; });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border shrink-0">
        <span className="text-xs text-text-secondary">
          {columns.length > 0 && `${sortedRows.length} row${sortedRows.length !== 1 ? 's' : ''}${truncated ? ' (result truncated)' : ''}`}
        </span>
        {onExport && columns.length > 0 && (
          <div className="ml-auto flex gap-1">
            <button
              onClick={() => onExport('csv')}
              className="px-2 py-0.5 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            >CSV</button>
            <button
              onClick={() => onExport('json')}
              className="px-2 py-0.5 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            >JSON</button>
          </div>
        )}
      </div>

      {/* Scrollable grid — always mounted so ResizeObserver fires on load */}
      <div className="flex-1 overflow-auto min-h-0 relative" ref={attachObserver} onScroll={handleScroll}>
        {columns.length === 0 ? (
          <div className="flex h-full items-center justify-center text-text-secondary text-sm">
            Run a query to see results
          </div>
        ) : (
          <>
            {/* Header (sticky) */}
            <div className="sticky top-0 z-10 flex bg-surface border-b border-border" style={{ minWidth: colWidths.reduce((s, w) => s + w, 0) + 'px' }}>
              {columns.map((col, ci) => (
                <div
                  key={ci}
                  className="relative flex items-center shrink-0 px-2 text-xs font-medium text-text-secondary cursor-pointer hover:bg-surface-hover select-none"
                  style={{ width: colWidths[ci], height: ROW_HEIGHT }}
                  onClick={() => handleSortClick(ci)}
                >
                  <span className="truncate">{col}</span>
                  {sortCol === ci && (
                    <span className="ml-1 opacity-60">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                  <div
                    className="absolute right-0 top-1 bottom-1 w-1 cursor-col-resize hover:bg-accent/40"
                    onMouseDown={e => resizeHandleMouseDown(ci, e)}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
              ))}
            </div>

            {/* Virtual body */}
            <div style={{ height: totalHeight, position: 'relative', minWidth: colWidths.reduce((s, w) => s + w, 0) + 'px' }}>
              {visibleRows.map((row, ri) => {
                const absIdx = startIdx + ri;
                return (
                  <div
                    key={absIdx}
                    className={`absolute flex border-b border-border/50 ${absIdx % 2 === 0 ? 'bg-surface' : 'bg-surface-hover/30'}`}
                    style={{ top: absIdx * ROW_HEIGHT, height: ROW_HEIGHT, width: '100%' }}
                  >
                    {row.map((cell, ci) => {
                      const s = cellToString(cell);
                      const isNull = cell === null || cell === undefined;
                      const cellKey = s.slice(0, 50);
                      return (
                        <div
                          key={ci}
                          className={`shrink-0 px-2 text-xs flex items-center overflow-hidden cursor-pointer hover:bg-accent/5 ${isNull ? 'text-text-secondary/40 italic' : 'text-text-primary'}`}
                          style={{ width: colWidths[ci], height: ROW_HEIGHT }}
                          title={s || '(null)'}
                          onClick={() => copyCell(cell)}
                        >
                          {copiedCell === cellKey ? (
                            <span className="text-accent text-[10px]">Copied</span>
                          ) : (
                            <span className="truncate">{isNull ? 'NULL' : s}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
