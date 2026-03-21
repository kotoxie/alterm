import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import type { Tab } from '../pages/MainLayout';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onDuplicate: (tab: Tab) => void;
}

const protocolIcons: Record<string, string> = {
  ssh: '> _',
  rdp: '🖥',
  smb: '📁',
};

const statusColors: Record<string, string> = {
  connecting: 'bg-yellow-500',
  connected: 'bg-green-500',
  disconnected: 'bg-red-500',
};

interface ContextMenu {
  x: number;
  y: number;
  tab: Tab;
}

export function TabBar({ tabs, activeTabId, onSelect, onClose, onDuplicate }: TabBarProps) {
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

  function handleContextMenu(e: React.MouseEvent, tab: Tab) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tab });
  }

  return (
    <>
      <div className="flex items-center h-9 bg-surface-alt border-b border-border overflow-x-auto shrink-0">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={clsx(
              'flex items-center gap-2 px-3 h-full text-sm cursor-pointer border-r border-border select-none shrink-0',
              tab.id === activeTabId
                ? 'bg-surface text-text-primary'
                : 'text-text-secondary hover:bg-surface-hover',
            )}
            onClick={() => onSelect(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab)}
          >
            <span className={clsx('w-2 h-2 rounded-full shrink-0', statusColors[tab.status])} />
            <span className="text-xs opacity-60">{protocolIcons[tab.protocol]}</span>
            <span className="max-w-[120px] truncate">{tab.name}</span>
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

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-surface-alt border border-border rounded shadow-lg py-1 text-sm min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-text-primary flex items-center gap-2"
            onClick={() => { onDuplicate(contextMenu.tab); setContextMenu(null); }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Duplicate Session
          </button>
          <div className="border-t border-border my-1" />
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
