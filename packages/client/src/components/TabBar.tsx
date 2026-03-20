import { clsx } from 'clsx';
import type { Tab } from '../pages/MainLayout';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
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

export function TabBar({ tabs, activeTabId, onSelect, onClose }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
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
        >
          <span className={clsx('w-2 h-2 rounded-full', statusColors[tab.status])} />
          <span className="text-xs opacity-60">{protocolIcons[tab.protocol]}</span>
          <span className="max-w-[120px] truncate">{tab.name}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
            className="ml-1 p-0.5 rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
