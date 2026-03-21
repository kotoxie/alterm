import { useCallback, useEffect, useRef, useState, type MouseEvent as RMouseEvent } from 'react';
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
  isShared?: boolean;
}

interface FlatGroup {
  id: string;
  name: string;
}

interface SidebarProps {
  onConnect: (conn: { id: string; name: string; protocol: 'ssh' | 'rdp' | 'smb' }) => void;
  onDuplicate: (conn: { id: string; name: string; protocol: 'ssh' | 'rdp' | 'smb' }) => void;
  width?: number;
}

interface ContextMenu {
  x: number;
  y: number;
  conn: Connection;
}

function flattenGroups(groups: ConnectionGroup[], prefix = ''): FlatGroup[] {
  const result: FlatGroup[] = [];
  for (const g of groups) {
    result.push({ id: g.id, name: prefix + g.name });
    result.push(...flattenGroups(g.children, prefix + '\u00a0\u00a0'));
  }
  return result;
}

const ProtocolBadge = ({ protocol }: { protocol: string }) => (
  <span className="text-[10px] font-mono opacity-50 w-5 text-center shrink-0 select-none">
    {protocol === 'ssh' ? '>_' : protocol === 'rdp' ? '⬛' : '📁'}
  </span>
);

const EditIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const TrashIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const FolderIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

export function Sidebar({ onConnect, onDuplicate, width }: SidebarProps) {
  const { token } = useAuth();
  const [groups, setGroups] = useState<ConnectionGroup[]>([]);
  const [ungrouped, setUngrouped] = useState<Connection[]>([]);
  const [sharedConnections, setSharedConnections] = useState<Connection[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [draggingConnId, setDraggingConnId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setContextMenu(null);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onEsc); };
  }, [contextMenu]);

  const flatGroups = flattenGroups(groups);

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
      setSharedConnections(data.sharedConnections || []);
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  useEffect(() => {
    if (showNewFolder) newFolderInputRef.current?.focus();
  }, [showNewFolder]);

  function toggleGroup(id: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function deleteConnection(id: string) {
    if (!token) return;
    await fetch(`/api/v1/connections/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchConnections();
  }

  async function deleteGroup(id: string) {
    if (!token) return;
    await fetch(`/api/v1/connections/groups/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchConnections();
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name || !token) return;
    await fetch('/api/v1/connections/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    });
    setNewFolderName('');
    setShowNewFolder(false);
    fetchConnections();
  }

  async function moveConnection(connId: string, targetGroupId: string | null) {
    if (!token) return;
    await fetch(`/api/v1/connections/${connId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ groupId: targetGroupId }),
    });
    fetchConnections();
  }

  function handleDragStart(e: React.DragEvent, connId: string) {
    setDraggingConnId(connId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragEnd() {
    setDraggingConnId(null);
    setDragOverId(null);
  }

  function handleGroupDragOver(e: React.DragEvent, groupId: string) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(groupId);
  }

  function handleGroupDrop(e: React.DragEvent, groupId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (draggingConnId) {
      moveConnection(draggingConnId, groupId);
      setExpandedGroups((prev) => new Set([...prev, groupId]));
    }
    setDraggingConnId(null);
    setDragOverId(null);
  }

  function handleUngroupedDrop(e: React.DragEvent) {
    e.preventDefault();
    if (draggingConnId) moveConnection(draggingConnId, null);
    setDraggingConnId(null);
    setDragOverId(null);
  }

  function handleConnContextMenu(e: RMouseEvent, conn: Connection) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, conn });
  }

  function renderConnection(conn: Connection) {
    return (
      <div
        key={conn.id}
        draggable
        onDragStart={(e) => handleDragStart(e, conn.id)}
        onDragEnd={handleDragEnd}
        onClick={() => onConnect(conn)}
        onContextMenu={(e) => handleConnContextMenu(e, conn)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-surface-hover rounded mx-1 group/conn"
      >
        <ProtocolBadge protocol={conn.protocol} />
        <span className="truncate flex-1 text-text-primary">{conn.name}</span>
        <div className="hidden group-hover/conn:flex items-center gap-0.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setEditingConnection(conn); setShowModal(true); }}
            title="Edit"
            className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-surface"
          >
            <EditIcon />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); deleteConnection(conn.id); }}
            title="Delete"
            className="p-1 rounded text-text-secondary hover:text-red-400 hover:bg-surface"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    );
  }

  function renderGroup(group: ConnectionGroup) {
    const expanded = expandedGroups.has(group.id);
    const isDropTarget = dragOverId === group.id;
    const totalCount = group.connections.length + group.children.reduce((s, c) => s + c.connections.length, 0);

    return (
      <div key={group.id}>
        <div
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded mx-1 cursor-pointer group/folder',
            isDropTarget
              ? 'bg-accent/20 ring-1 ring-inset ring-accent/40'
              : 'hover:bg-surface-hover',
          )}
          onClick={() => toggleGroup(group.id)}
          onDragOver={(e) => handleGroupDragOver(e, group.id)}
          onDragLeave={(e) => { e.stopPropagation(); setDragOverId(null); }}
          onDrop={(e) => handleGroupDrop(e, group.id)}
        >
          <svg
            width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={clsx('text-text-secondary transition-transform shrink-0', expanded && 'rotate-90')}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          <FolderIcon />
          <span className="text-text-secondary font-medium truncate flex-1">{group.name}</span>
          <span className="text-xs text-text-secondary mr-1">{totalCount}</span>
          <button
            onClick={(e) => { e.stopPropagation(); deleteGroup(group.id); }}
            title="Delete folder"
            className="hidden group-hover/folder:flex p-1 rounded text-text-secondary hover:text-red-400 hover:bg-surface"
          >
            <TrashIcon size={11} />
          </button>
        </div>

        {expanded && (
          <div className="ml-3 border-l border-border/40 pl-1">
            {group.connections.map(renderConnection)}
            {group.children.map(renderGroup)}
            {group.connections.length === 0 && group.children.length === 0 && (
              <p className="text-xs text-text-secondary px-3 py-1 italic">Empty folder</p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <aside
        className="bg-surface-alt border-r border-border flex flex-col shrink-0 overflow-hidden"
        style={width !== undefined ? { width } : { width: 240 }}
      >
        {/* Header */}
        <div className="p-2 border-b border-border space-y-1.5">
          <button
            onClick={() => { setEditingConnection(null); setShowModal(true); }}
            className="w-full py-1.5 px-3 text-sm bg-accent text-white rounded hover:bg-accent-hover font-medium"
          >
            + New Connection
          </button>

          {showNewFolder ? (
            <div className="flex gap-1">
              <input
                ref={newFolderInputRef}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createFolder();
                  if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); }
                }}
                placeholder="Folder name"
                className="flex-1 min-w-0 px-2 py-1 text-sm bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={createFolder}
                className="px-2 py-1 text-sm bg-accent text-white rounded hover:bg-accent-hover"
              >
                ✓
              </button>
              <button
                onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}
                className="px-2 py-1 text-sm border border-border rounded text-text-secondary hover:bg-surface-hover"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewFolder(true)}
              className="w-full py-1 px-3 text-sm border border-border rounded text-text-secondary hover:bg-surface-hover flex items-center gap-1.5"
            >
              <FolderIcon />
              + New Folder
            </button>
          )}
        </div>

        {/* Connection list */}
        <div
          className={clsx(
            'flex-1 py-2 overflow-y-auto transition-colors',
            draggingConnId && dragOverId === 'ungrouped' && 'bg-accent/5',
          )}
          onDragOver={(e) => { e.preventDefault(); setDragOverId('ungrouped'); }}
          onDragLeave={() => setDragOverId(null)}
          onDrop={handleUngroupedDrop}
        >
          {groups.map(renderGroup)}
          {ungrouped.map(renderConnection)}

          {sharedConnections.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-text-secondary font-medium uppercase tracking-wider">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                Shared
              </div>
              {sharedConnections.map((conn) => (
                <div
                  key={conn.id}
                  onClick={() => onConnect(conn)}
                  onContextMenu={(e) => handleConnContextMenu(e, conn)}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-surface-hover rounded mx-1"
                >
                  <ProtocolBadge protocol={conn.protocol} />
                  <span className="truncate flex-1 text-text-primary">{conn.name}</span>
                </div>
              ))}
            </div>
          )}

          {draggingConnId && (
            <p className="text-xs text-text-secondary text-center py-2 opacity-60">
              Drop here to remove from folder
            </p>
          )}

          {groups.length === 0 && ungrouped.length === 0 && sharedConnections.length === 0 && (
            <p className="text-xs text-text-secondary text-center px-4 mt-8 leading-relaxed">
              No connections yet.<br />
              Click "+ New Connection" to get started.
            </p>
          )}
        </div>
      </aside>

      {showModal && (
        <ConnectionModal
          connection={editingConnection}
          groups={flatGroups}
          onClose={() => { setShowModal(false); setEditingConnection(null); }}
          onSaved={() => { setShowModal(false); setEditingConnection(null); fetchConnections(); }}
        />
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-surface-alt border border-border rounded shadow-lg py-1 text-sm min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-text-primary flex items-center gap-2"
            onClick={() => { onConnect(contextMenu.conn); setContextMenu(null); }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            Connect
          </button>
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-text-primary flex items-center gap-2"
            onClick={() => { onDuplicate(contextMenu.conn); setContextMenu(null); }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Duplicate Session
          </button>
          {!contextMenu.conn.isShared && (
            <>
              <div className="border-t border-border my-1" />
              <button
                className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-text-primary flex items-center gap-2"
                onClick={() => { setEditingConnection(contextMenu.conn); setShowModal(true); setContextMenu(null); }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit
              </button>
              <button
                className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-red-400 flex items-center gap-2"
                onClick={() => { deleteConnection(contextMenu.conn.id); setContextMenu(null); }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
