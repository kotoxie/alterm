import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import type { TabBarItem } from '../pages/MainLayout';

interface TabBarProps {
  tabs: TabBarItem[];
  activeTabId: string | null;
  onTabSelect: (id: string) => void;
  onClose: (id: string) => void;
  onSplitH: (tabId: string) => void;
  onSplitV: (tabId: string) => void;
  canSplit: boolean;
  onCloseAll?: () => void;
}

const protocolIcons: Record<string, string> = {
  ssh: '> _',
  rdp: '🖥',
  smb: '📁',
  vnc: '🖱',
  sftp: '📂',
  ftp: '🗂',
  split: '⊞',
};

const statusColors: Record<string, string> = {
  connecting: 'bg-yellow-500',
  connected: 'bg-green-500',
  disconnected: 'bg-red-500',
};

interface ContextMenu {
  x: number;
  y: number;
  tab: TabBarItem;
}

export function TabBar({
  tabs,
  activeTabId,
  onTabSelect,
  onClose,
  onSplitH,
  onSplitV,
  canSplit,
  onCloseAll,
}: TabBarProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setContextMenu(null);
    }
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [contextMenu]);

  if (tabs.length === 0) return null;

  function handleContextMenu(e: React.MouseEvent, tab: TabBarItem) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tab });
  }

  return (
    <>
      <div className="flex items-center h-9 bg-surface-alt border-b border-border shrink-0">
        <div className="flex items-center h-full overflow-x-auto flex-1 min-w-0">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={clsx(
              'flex items-center gap-2 px-3 h-full text-sm cursor-pointer border-r border-border select-none shrink-0',
              tab.id === activeTabId
                ? 'bg-surface text-text-primary'
                : 'text-text-secondary hover:bg-surface-hover',
            )}
            onClick={() => onTabSelect(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab)}
          >
            <span className={clsx('w-2 h-2 rounded-full shrink-0', statusColors[tab.status])} />
            <span className="text-xs opacity-60">{protocolIcons[tab.protocol] ?? tab.protocol}</span>
            <span className="max-w-[120px] truncate">{tab.label}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
              className="ml-1 p-0.5 rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
        </div>
        {onCloseAll && tabs.length > 0 && (
          <button
            onClick={onCloseAll}
            className="flex items-center gap-1.5 px-3 h-full text-xs text-text-secondary hover:text-red-400 hover:bg-surface-hover border-l border-border shrink-0 transition-colors"
            title="Close all sessions"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            Close All
          </button>
        )}
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-surface-alt border border-border rounded shadow-lg py-1 text-sm min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className={clsx(
              'w-full px-4 py-1.5 text-left flex items-center gap-2',
              canSplit
                ? 'text-text-primary hover:bg-surface-hover'
                : 'text-text-secondary/40 cursor-not-allowed',
            )}
            disabled={!canSplit}
            onClick={() => {
              if (!canSplit) return;
              onSplitH(contextMenu.tab.id);
              setContextMenu(null);
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="1" />
              <line x1="12" y1="3" x2="12" y2="21" />
            </svg>
            Split Right
          </button>
          <button
            className={clsx(
              'w-full px-4 py-1.5 text-left flex items-center gap-2',
              canSplit
                ? 'text-text-primary hover:bg-surface-hover'
                : 'text-text-secondary/40 cursor-not-allowed',
            )}
            disabled={!canSplit}
            onClick={() => {
              if (!canSplit) return;
              onSplitV(contextMenu.tab.id);
              setContextMenu(null);
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="1" />
              <line x1="3" y1="12" x2="21" y2="12" />
            </svg>
            Split Down
          </button>
          <div className="my-1 h-px bg-border mx-1" />
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-red-400 flex items-center gap-2"
            onClick={() => { onClose(contextMenu.tab.id); setContextMenu(null); }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            Close Tab
          </button>
        </div>
      )}
    </>
  );
}
