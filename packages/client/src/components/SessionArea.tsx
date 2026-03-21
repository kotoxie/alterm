import type { Tab } from '../pages/MainLayout';
import { RdpSession } from './RdpSession';
import { SshSession } from './SshSession';

interface SessionAreaProps {
  tab: Tab | null;
  onStatusChange: (tabId: string, status: Tab['status']) => void;
  onClose: (tabId: string) => void;
}

export function SessionArea({ tab, onStatusChange, onClose }: SessionAreaProps) {
  if (!tab) {
    return (
      <div className="flex items-center justify-center flex-1 bg-surface">
        <div className="text-center text-text-secondary">
          <p className="text-lg">No active session</p>
          <p className="text-sm mt-1">Select a connection from the sidebar to begin</p>
        </div>
      </div>
    );
  }

  if (tab.protocol === 'rdp') {
    return <RdpSession tab={tab} onStatusChange={onStatusChange} onClose={onClose} />;
  }

  if (tab.protocol === 'ssh') {
    return <SshSession tab={tab} onStatusChange={onStatusChange} onClose={onClose} />;
  }

  return (
    <div className="flex items-center justify-center flex-1 bg-surface">
      <div className="text-text-secondary">
        {tab.protocol.toUpperCase()} sessions coming in Phase 3
      </div>
    </div>
  );
}
