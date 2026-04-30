import { useState, useRef, useCallback, useEffect } from 'react';

interface QueryTab {
  id: string;
  title: string;
  sql: string;
}

interface QueryEditorProps {
  onExecute: (sql: string) => void;
  isLoading: boolean;
  error?: string;
  rowCount?: number;
  durationMs?: number;
  /** SQL to inject into the active tab (e.g. from schema tree double-click) */
  pendingSql?: string | null;
  onPendingSqlConsumed?: () => void;
}

export function QueryEditor({ onExecute, isLoading, error, rowCount, durationMs, pendingSql, onPendingSqlConsumed }: QueryEditorProps) {
  const [tabs, setTabs] = useState<QueryTab[]>([{ id: crypto.randomUUID(), title: 'Query 1', sql: '' }]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];

  // Inject pending SQL into active tab when set from outside
  useEffect(() => {
    if (!pendingSql) return;
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, sql: pendingSql } : t));
    onPendingSqlConsumed?.();
  }, [pendingSql]);

  const updateSql = useCallback((sql: string) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, sql } : t));
  }, [activeTabId]);

  const addTab = useCallback(() => {
    if (tabs.length >= 20) return;
    const newTab: QueryTab = {
      id: crypto.randomUUID(),
      title: `Query ${tabs.length + 1}`,
      sql: '',
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs.length]);

  const closeTab = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) {
        const fallback = { id: crypto.randomUUID(), title: 'Query 1', sql: '' };
        setActiveTabId(fallback.id);
        return [fallback];
      }
      if (activeTabId === id) {
        setActiveTabId(next[next.length - 1].id);
      }
      return next;
    });
  }, [activeTabId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const textarea = textareaRef.current;
      const sql = e.shiftKey && textarea && textarea.selectionStart !== textarea.selectionEnd
        ? textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).trim()
        : activeTab.sql.trim();
      if (sql && !isLoading) onExecute(sql);
    }
  }, [activeTab.sql, isLoading, onExecute]);

  const handleRun = () => {
    const sql = activeTab.sql.trim();
    if (sql && !isLoading) onExecute(sql);
  };

  return (
    <div className="flex flex-col h-full bg-surface border-b border-border">
      {/* Tabs */}
      <div className="flex items-center border-b border-border bg-surface overflow-x-auto shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-border whitespace-nowrap shrink-0 ${
              tab.id === activeTabId
                ? 'bg-surface-hover text-text-primary border-b-2 border-b-accent'
                : 'text-text-secondary hover:bg-surface-hover'
            }`}
          >
            <span>{tab.title}</span>
            {tabs.length > 1 && (
              <span
                onClick={e => closeTab(tab.id, e)}
                className="opacity-40 hover:opacity-100 cursor-pointer"
              >×</span>
            )}
          </button>
        ))}
        <button
          onClick={addTab}
          title="New query tab"
          className="px-2 py-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-hover text-sm shrink-0"
        >+</button>
      </div>

      {/* Editor */}
      <div className="flex-1 relative min-h-0">
        <textarea
          ref={textareaRef}
          value={activeTab.sql}
          onChange={e => updateSql(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter SQL query… (Ctrl+Enter to run, Shift+Ctrl+Enter for selection)"
          spellCheck={false}
          className="absolute inset-0 w-full h-full resize-none bg-surface text-text-primary text-sm font-mono px-3 py-2 outline-none placeholder:text-text-secondary/40"
          style={{ fontFamily: 'Cascadia Code, Fira Code, Menlo, Monaco, Courier New, monospace' }}
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 px-3 py-1 border-t border-border bg-surface shrink-0">
        <button
          onClick={handleRun}
          disabled={isLoading || !activeTab.sql.trim()}
          className="px-3 py-0.5 text-xs rounded bg-accent text-white disabled:opacity-40 hover:bg-accent/90"
        >
          {isLoading ? 'Running…' : 'Run'}
        </button>
        {error && (
          <span className="text-xs text-red-400 truncate flex-1">{error}</span>
        )}
        {!error && rowCount !== undefined && (
          <span className="text-xs text-text-secondary">
            {rowCount} row{rowCount !== 1 ? 's' : ''}
            {durationMs !== undefined && ` · ${durationMs}ms`}
          </span>
        )}
        <span className="ml-auto text-xs text-text-secondary/50">Ctrl+Enter to run</span>
      </div>
    </div>
  );
}

/** Programmatically set query in the active editor tab — exposed via ref */
export function createQueryTab(sql: string, title?: string): QueryTab {
  return { id: crypto.randomUUID(), title: title ?? 'Query', sql };
}
