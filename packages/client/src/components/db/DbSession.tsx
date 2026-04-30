import { useState, useEffect, useRef, useCallback } from 'react';
import { SchemaTree } from './SchemaTree';
import { QueryEditor } from './QueryEditor';
import { ResultsGrid } from './ResultsGrid';
import { QueryHistory } from './QueryHistory';

interface DbSessionProps {
  connectionId: string;
  connectionName: string;
  isActive: boolean;
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void;
}

interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
  truncated?: boolean;
  error?: string;
}

const SCHEMA_WIDTH_DEFAULT = 220;
const SCHEMA_WIDTH_MIN = 140;
const SCHEMA_WIDTH_MAX = 400;
const RESULTS_HEIGHT_DEFAULT = 260;
const RESULTS_HEIGHT_MIN = 80;

export function DbSession({ connectionId, connectionName, isActive, onStatusChange }: DbSessionProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<'postgres' | 'mysql'>('postgres');
  const [defaultDatabase, setDefaultDatabase] = useState('');
  const [connectError, setConnectError] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);

  const [schemaWidth, setSchemaWidth] = useState(SCHEMA_WIDTH_DEFAULT);
  const [resultsHeight, setResultsHeight] = useState(RESULTS_HEIGHT_DEFAULT);
  const [showHistory, setShowHistory] = useState(false);

  // Pending SQL to inject into editor (from schema tree double-click)
  const [pendingSql, setPendingSql] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Connect on mount
  useEffect(() => {
    let cancelled = false;
    onStatusChange?.('connecting');

    fetch(`/api/v1/db/${connectionId}/connect`, { method: 'POST', credentials: 'include' })
      .then(r => r.json())
      .then((d: { sessionId?: string; protocol?: string; defaultDatabase?: string; error?: string }) => {
        if (cancelled) return;
        if (d.error) {
          setConnectError(d.error);
          onStatusChange?.('disconnected');
          return;
        }
        setSessionId(d.sessionId ?? null);
        setProtocol((d.protocol as 'postgres' | 'mysql') ?? 'postgres');
        setDefaultDatabase(d.defaultDatabase ?? '');
        onStatusChange?.('connected');
      })
      .catch(err => {
        if (cancelled) return;
        setConnectError(err instanceof Error ? err.message : 'Connection failed');
        onStatusChange?.('disconnected');
      });

    return () => {
      cancelled = true;
      fetch(`/api/v1/db/${connectionId}/disconnect`, { method: 'POST', credentials: 'include' }).catch(() => {});
      onStatusChange?.('disconnected');
    };
  }, [connectionId]);

  const handleExecute = useCallback(async (sql: string) => {
    setIsLoading(true);
    setResult(null);
    try {
      const r = await fetch(`/api/v1/db/${connectionId}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sql }),
      });
      const d = await r.json() as {
        columns?: string[];
        rows?: unknown[][];
        rowCount?: number;
        durationMs?: number;
        truncated?: boolean;
        error?: string;
      };
      setResult({
        columns: d.columns ?? [],
        rows: d.rows ?? [],
        rowCount: d.rowCount ?? 0,
        durationMs: d.durationMs ?? 0,
        truncated: d.truncated,
        error: d.error,
      });
    } catch (err) {
      setResult({ columns: [], rows: [], rowCount: 0, durationMs: 0, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setIsLoading(false);
    }
  }, [connectionId]);

  const handleExport = useCallback(async (sql: string, format: 'csv' | 'json') => {
    try {
      const r = await fetch(`/api/v1/db/${connectionId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sql, format }),
      });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  }, [connectionId]);

  // Schema resize
  const onSchemaResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = schemaWidth;
    const onMove = (me: MouseEvent) => {
      setSchemaWidth(Math.min(SCHEMA_WIDTH_MAX, Math.max(SCHEMA_WIDTH_MIN, startW + me.clientX - startX)));
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Results resize
  const onResultsResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = resultsHeight;
    const containerH = containerRef.current?.getBoundingClientRect().height ?? 600;
    const onMove = (me: MouseEvent) => {
      const delta = startY - me.clientY;
      setResultsHeight(Math.min(containerH * 0.8, Math.max(RESULTS_HEIGHT_MIN, startH + delta)));
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (connectError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-sm">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-red-400">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p className="text-text-primary font-medium">Connection failed</p>
        <p className="text-text-secondary text-xs max-w-sm text-center">{connectError}</p>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-sm text-text-secondary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        Connecting to {connectionName}…
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden" ref={containerRef}>
      {/* Schema tree */}
      <div style={{ width: schemaWidth, minWidth: schemaWidth, maxWidth: schemaWidth }} className="flex flex-col overflow-hidden">
        <SchemaTree
          connectionId={connectionId}
          protocol={protocol}
          defaultDatabase={defaultDatabase}
          onTableClick={(sql) => setPendingSql(sql)}
        />
      </div>

      {/* Resize handle */}
      <div
        className="w-1 bg-border hover:bg-accent/50 cursor-col-resize shrink-0"
        onMouseDown={onSchemaResizeStart}
      />

      {/* Right pane: editor + results */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Query editor */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <QueryEditor
            onExecute={handleExecute}
            isLoading={isLoading}
            error={result?.error}
            rowCount={result?.error ? undefined : result?.rowCount}
            durationMs={result?.error ? undefined : result?.durationMs}
            pendingSql={pendingSql}
            onPendingSqlConsumed={() => setPendingSql(null)}
          />
        </div>

        {/* Results resize handle */}
        <div
          className="h-1 bg-border hover:bg-accent/50 cursor-row-resize shrink-0"
          onMouseDown={onResultsResizeStart}
        />

        {/* Results grid */}
        <div style={{ height: resultsHeight, minHeight: resultsHeight, maxHeight: resultsHeight }} className="overflow-hidden flex">
          <div className="flex-1 min-w-0 overflow-hidden">
            <ResultsGrid
              columns={result?.columns ?? []}
              rows={result?.rows ?? []}
              truncated={result?.truncated}
              onExport={result && !result.error ? undefined : undefined}
            />
          </div>

          {/* History panel */}
          {showHistory && (
            <div className="w-72 shrink-0 overflow-hidden">
              <QueryHistory
                connectionId={connectionId}
                onLoadQuery={(sql) => setPendingSql(sql)}
                onClose={() => setShowHistory(false)}
              />
            </div>
          )}
        </div>
      </div>

      {/* History toggle button (floating) */}
      {!showHistory && (
        <button
          onClick={() => setShowHistory(true)}
          title="Query history"
          className="absolute bottom-4 right-4 z-10 px-2 py-1 text-xs rounded bg-surface border border-border shadow text-text-secondary hover:text-text-primary hover:bg-surface-hover"
        >
          History
        </button>
      )}
    </div>
  );
}
