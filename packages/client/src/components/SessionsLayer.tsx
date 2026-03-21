import type { Tab } from '../pages/MainLayout';
import type { PaneRect } from '../types/panes';
import { RdpSession } from './RdpSession';
import { SshSession } from './SshSession';
import { SmbSession } from './SmbSession';
import { VncSession } from './VncSession';
import { SftpSession } from './SftpSession';
import { FtpSession } from './FtpSession';

interface SessionsLayerProps {
  tabs: Tab[];
  paneTabMap: Record<string, string | null>;
  leafRects: Record<string, PaneRect>;
  activePaneId: string;
  onStatusChange: (tabId: string, status: Tab['status']) => void;
  onClose: (tabId: string) => void;
}

export function SessionsLayer({
  tabs,
  paneTabMap,
  leafRects,
  activePaneId,
  onStatusChange,
  onClose,
}: SessionsLayerProps) {
  // Build reverse map: tabId -> paneId
  const tabPaneMap: Record<string, string> = {};
  for (const [paneId, tabId] of Object.entries(paneTabMap)) {
    if (tabId) tabPaneMap[tabId] = paneId;
  }

  return (
    <div className="absolute inset-0 z-0">
      {tabs.map((tab) => {
        const paneId = tabPaneMap[tab.id];
        const rect = paneId ? leafRects[paneId] : undefined;
        const isActive = paneId === activePaneId;

        // No rect means not assigned to any visible pane
        const style: React.CSSProperties = rect
          ? {
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              // Active pane gets pointer events; unfocused panes are blocked by PaneOverlay click blocker
              pointerEvents: isActive ? 'auto' : 'none',
              zIndex: isActive ? 1 : 0,
            }
          : {
              position: 'absolute',
              display: 'none',
            };

        return (
          <div key={tab.id} style={style}>
            {tab.protocol === 'rdp' && (
              <RdpSession tab={tab} onStatusChange={onStatusChange} onClose={onClose} />
            )}
            {tab.protocol === 'ssh' && (
              <SshSession
                tab={tab}
                isActive={isActive}
                onStatusChange={onStatusChange}
                onClose={onClose}
              />
            )}
            {tab.protocol === 'smb' && (
              <SmbSession
                connectionId={tab.connectionId}
                connectionName={tab.name}
                isActive={isActive}
                onStatusChange={(status) => onStatusChange(tab.id, status)}
              />
            )}
            {tab.protocol === 'vnc' && (
              <VncSession
                connectionId={tab.connectionId}
                connectionName={tab.name}
                isActive={isActive}
                onStatusChange={(status) => onStatusChange(tab.id, status)}
              />
            )}
            {tab.protocol === 'sftp' && (
              <SftpSession
                connectionId={tab.connectionId}
                connectionName={tab.name}
                isActive={isActive}
                onStatusChange={(status) => onStatusChange(tab.id, status)}
              />
            )}
            {tab.protocol === 'ftp' && (
              <FtpSession
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
