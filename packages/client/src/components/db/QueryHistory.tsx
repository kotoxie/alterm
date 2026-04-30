import { useState, useEffect, useCallback } from 'react';

interface HistoryItem {
  id: string;
  query_text: string;
  row_count: number | null;
  duration_ms: number | null;
  error: string | null;
  executed_at: string;
}

interface QueryHistoryProps {
  connectionId: string;
  onLoadQuery: (sql: string) => void;
  onClose: () => void;
}

export function QueryHistory({ connectionId, onLoadQuery, onClose }: QueryHistoryProps) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(() => {
    setLoading(true);
    fetch(`/api/v1/db/${connectionId}/history?limit=200`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.history)) setHistory(d.history); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [connectionId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const clearHistory = () => {
    if (!confirm('Clear all query history for this connection?')) return;
    fetch(`/api/v1/db/${connectionId}/history`, { method: 'DELETE', credentials: 'include' })
      .then(() => setHistory([]))
      .catch(() => {});
  };

  const filtered = search
    ? history.filter(h => h.query_text.toLowerCase().includes(search.toLowerCase()))
    : history;

  return (
    <div className="flex flex-col h-full bg-surface border-l border-border">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-medium text-text-secondary">Query History</span>
        <div className="flex items-center gap-1.5">
          <button onClick={clearHistory} className="text-xs text-text-secondary hover:text-text-primary">Clear</button>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-lg leading-none">×</button>
        </div>
      </div>
      <div className="px-2 py-1.5 border-b border-border shrink-0">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter queries…"
          className="w-full px-2 py-1 text-xs bg-surface border border-border rounded text-text-primary outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && <p className="text-xs text-text-secondary text-center py-4">Loading…</p>}
        {!loading && filtered.length === 0 && (
          <p className="text-xs text-text-secondary text-center py-4">No history</p>
        )}
        {filtered.map(item => (
          <div
            key={item.id}
            onClick={() => onLoadQuery(item.query_text)}
            className="px-3 py-2 border-b border-border/50 cursor-pointer hover:bg-surface-hover group"
          >
            <pre className="text-xs text-text-primary font-mono whitespace-pre-wrap line-clamp-3 leading-relaxed">{item.query_text}</pre>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-text-secondary">
                {new Date(item.executed_at).toLocaleString()}
              </span>
              {item.error ? (
                <span className="text-[10px] text-red-400">Error</span>
              ) : item.row_count !== null ? (
                <span className="text-[10px] text-text-secondary">{item.row_count} rows</span>
              ) : null}
              {item.duration_ms !== null && (
                <span className="text-[10px] text-text-secondary">{item.duration_ms}ms</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
