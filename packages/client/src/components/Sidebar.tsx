import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { useAuth } from '../hooks/useAuth';
import { ConnectionModal } from './ConnectionModal';

interface ConnectionGroup {
  id: string;
  name: string;
  parentId: string | null;
  children: ConnectionGroup[];
  connections: Connection[];
}

interface Connection {
  id: string;
  name: string;
  protocol: 'ssh' | 'rdp' | 'smb';
  host: string;
  port: number;
  groupId: string | null;
}

interface SidebarProps {
  onConnect: (conn: { id: string; name: string; protocol: 'ssh' | 'rdp' | 'smb' }) => void;
}

const protocolIcons: Record<string, string> = {
  ssh: '> _',
  rdp: '🖥',
  smb: '📁',
};

export function Sidebar({ onConnect }: SidebarProps) {
  const { token } = useAuth();
  const [groups, setGroups] = useState<ConnectionGroup[]>([]);
  const [ungrouped, setUngrouped] = useState<Connection[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; conn: Connection } | null>(null);

  const fetchConnections = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/v1/connections', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setGroups(data.groups || []);
      setUngrouped(data.ungrouped || []);
    } catch {
      // ignore
    }
  }, [token]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  function toggleGroup(id: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleContextMenu(e: React.MouseEvent, conn: Connection) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, conn });
  }

  async function deleteConnection(id: string) {
    if (!token) return;
    await fetch(`/api/v1/connections/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchConnections();
  }

  function renderConnection(conn: Connection) {
    return (
      <div
        key={conn.id}
        className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-surface-hover rounded mx-1 group"
        onDoubleClick={() => onConnect(conn)}
        onContextMenu={(e) => handleContextMenu(e, conn)}
      >
        <span className="text-xs opacity-60 w-5 text-center">{protocolIcons[conn.protocol]}</span>
        <span className="truncate flex-1 text-text-primary">{conn.name}</span>
        <button
          onClick={() => onConnect(conn)}
          className="hidden group-hover:block text-xs text-accent hover:text-accent-hover"
        >
          Connect
        </button>
      </div>
    );
  }

  function renderGroup(group: ConnectionGroup) {
    const expanded = expandedGroups.has(group.id);
    return (
      <div key={group.id}>
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-surface-hover rounded mx-1"
          onClick={() => toggleGroup(group.id)}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={clsx('text-text-secondary transition-transform', expanded && 'rotate-90')}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span className="text-text-secondary font-medium">{group.name}</span>
          <span className="text-xs text-text-secondary ml-auto">{group.connections.length}</span>
        </div>
        {expanded && (
          <div className="ml-4">
            {group.connections.map(renderConnection)}
            {group.children.map(renderGroup)}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <aside className="w-60 bg-surface-alt border-r border-border flex flex-col shrink-0 overflow-y-auto">
        <div className="p-3 border-b border-border">
          <button
            onClick={() => {
              setEditingConnection(null);
              setShowModal(true);
            }}
            className="w-full py-1.5 px-3 text-sm bg-accent text-white rounded hover:bg-accent-hover font-medium"
          >
            + New Connection
          </button>
        </div>
        <div className="flex-1 py-2 overflow-y-auto">
          {groups.map(renderGroup)}
          {ungrouped.map(renderConnection)}
          {groups.length === 0 && ungrouped.length === 0 && (
            <p className="text-xs text-text-secondary text-center px-4 mt-8">
              No connections yet. Click "+ New Connection" to get started.
            </p>
          )}
        </div>
      </aside>

      {contextMenu && (
        <div
          className="fixed z-50 bg-surface-alt border border-border rounded shadow-lg py-1 text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-text-primary"
            onClick={() => {
              onConnect(contextMenu.conn);
              setContextMenu(null);
            }}
          >
            Connect
          </button>
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-text-primary"
            onClick={() => {
              setEditingConnection(contextMenu.conn);
              setShowModal(true);
              setContextMenu(null);
            }}
          >
            Edit
          </button>
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-red-500"
            onClick={() => {
              deleteConnection(contextMenu.conn.id);
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}

      {showModal && (
        <ConnectionModal
          connection={editingConnection}
          onClose={() => {
            setShowModal(false);
            setEditingConnection(null);
          }}
          onSaved={() => {
            setShowModal(false);
            setEditingConnection(null);
            fetchConnections();
          }}
        />
      )}
    </>
  );
}
