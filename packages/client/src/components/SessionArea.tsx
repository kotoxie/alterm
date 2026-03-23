import type { Tab } from '../pages/MainLayout';
import { RdpSession } from './RdpSession';
import { SshSession } from './SshSession';
import { SmbSession } from './SmbSession';

interface SessionAreaProps {
  tabs: Tab[];
  activeTabId: string | null;
  onStatusChange: (tabId: string, status: Tab['status']) => void;
  onClose: (tabId: string) => void;
}

export function SessionArea({ tabs, activeTabId, onStatusChange, onClose }: SessionAreaProps) {
  if (tabs.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 bg-surface">
        <div className="text-center text-text-secondary">
          <p className="text-lg">No active session</p>
          <p className="text-sm mt-1">Select a connection from the sidebar to begin</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative overflow-hidden">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`absolute inset-0 flex flex-col ${isActive ? '' : 'invisible pointer-events-none'}`}
          >
            {tab.protocol === 'rdp' && (
              <RdpSession tab={tab} onStatusChange={onStatusChange} onClose={onClose} />
            )}
            {tab.protocol === 'ssh' && (
              <SshSession tab={tab} isActive={isActive} paneWidth={0} paneHeight={0} onStatusChange={onStatusChange} onClose={onClose} />
            )}
            {tab.protocol === 'smb' && (
              <SmbSession
                connectionId={tab.connectionId}
                connectionName={tab.name}
                isActive={isActive}
                onStatusChange={(status) => onStatusChange(tab.id, status)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
