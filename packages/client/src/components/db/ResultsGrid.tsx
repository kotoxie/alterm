import { useState, useRef, useEffect, useCallback } from 'react';

interface ResultsGridProps {
  columns: string[];
  rows: unknown[][];
  page: number;
  totalPages: number;
  totalRows: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onExport?: (format: 'csv' | 'json') => void;
}

const ROW_HEIGHT = 28;
const OVERSCAN = 5;

function cellToString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function pageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const result: (number | '...')[] = [];
  const left = Math.max(1, current - 2);
  const right = Math.min(total - 2, current + 2);
  result.push(0);
  if (left > 1) result.push('...');
  for (let i = left; i <= right; i++) result.push(i);
  if (right < total - 2) result.push('...');
  result.push(total - 1);
  return result;
}

export function ResultsGrid({ columns, rows, page, totalPages, totalRows, pageSize, onPageChange, onExport }: ResultsGridProps) {
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
          {columns.length > 0 && `${totalRows.toLocaleString()} row${totalRows !== 1 ? 's' : ''}`}
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

      {/* Pagination bar — shown when more than one page */}
      {columns.length > 0 && totalPages > 1 && (() => {
        const btnBase = 'flex items-center justify-center w-7 h-7 rounded text-xs transition-colors';
        const btnActive = 'bg-accent text-white font-medium';
        const btnNormal = 'text-text-secondary hover:bg-surface-hover hover:text-text-primary';
        const btnDisabled = 'text-text-secondary/30 cursor-not-allowed';
        const rowStart = page * pageSize + 1;
        const rowEnd = Math.min((page + 1) * pageSize, totalRows);
        return (
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-border shrink-0 bg-surface">
            <span className="text-xs text-text-secondary min-w-[120px]">
              Rows {rowStart.toLocaleString()}–{rowEnd.toLocaleString()} of {totalRows.toLocaleString()}
            </span>
            <div className="flex items-center gap-0.5">
              {/* First */}
              <button
                onClick={() => onPageChange(0)}
                disabled={page === 0}
                className={`${btnBase} ${page === 0 ? btnDisabled : btnNormal}`}
                title="First page"
              >«</button>
              {/* Prev */}
              <button
                onClick={() => onPageChange(page - 1)}
                disabled={page === 0}
                className={`${btnBase} ${page === 0 ? btnDisabled : btnNormal}`}
                title="Previous page"
              >‹</button>
              {/* Page numbers */}
              {pageNumbers(page, totalPages).map((p, i) =>
                p === '...' ? (
                  <span key={`e${i}`} className="w-6 text-center text-xs text-text-secondary/50">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => onPageChange(p as number)}
                    className={`${btnBase} ${p === page ? btnActive : btnNormal}`}
                  >
                    {(p as number) + 1}
                  </button>
                )
              )}
              {/* Next */}
              <button
                onClick={() => onPageChange(page + 1)}
                disabled={page >= totalPages - 1}
                className={`${btnBase} ${page >= totalPages - 1 ? btnDisabled : btnNormal}`}
                title="Next page"
              >›</button>
              {/* Last */}
              <button
                onClick={() => onPageChange(totalPages - 1)}
                disabled={page >= totalPages - 1}
                className={`${btnBase} ${page >= totalPages - 1 ? btnDisabled : btnNormal}`}
                title="Last page"
              >»</button>
            </div>
            <div className="min-w-[120px]" />
          </div>
        );
      })()}
    </div>
  );
}
