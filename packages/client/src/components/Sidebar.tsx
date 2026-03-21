import { useCallback, useEffect, useRef, useState, type MouseEvent as RMouseEvent } from 'react';
import { clsx } from 'clsx';
import { useAuth } from '../hooks/useAuth';
import { ConnectionModal, type ConnectionPrefill } from './ConnectionModal';

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
  protocol: 'ssh' | 'rdp' | 'smb' | 'vnc' | 'sftp' | 'ftp';
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
  onConnect: (conn: { id: string; name: string; protocol: 'ssh' | 'rdp' | 'smb' | 'vnc' | 'sftp' | 'ftp' }) => void;
  width?: number;
}

interface ContextMenu {
  x: number;
  y: number;
  conn: Connection;
}

interface FolderContextMenu {
  x: number;
  y: number;
  group: ConnectionGroup;
}

function flattenGroups(groups: ConnectionGroup[], prefix = ''): FlatGroup[] {
  const result: FlatGroup[] = [];
  for (const g of groups) {
    result.push({ id: g.id, name: prefix + g.name });
    result.push(...flattenGroups(g.children, prefix + '\u00a0\u00a0'));
  }
  return result;
}

const PROTOCOL_ICONS: Record<string, string> = {
  ssh: '>_',
  rdp: '🖥',
  smb: '📁',
  vnc: '🖱',
  sftp: '📂',
  ftp: '🗂',
};

const ProtocolBadge = ({ protocol }: { protocol: string }) => (
  <span className="text-[10px] font-mono opacity-50 w-5 text-center shrink-0 select-none">
    {PROTOCOL_ICONS[protocol] ?? protocol}
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

const PlugIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M7 17l9.2-9.2M14 6l3.5-3.5a2.121 2.121 0 0 1 3 3L17 9" />
    <path d="M11 19l-1 1a3 3 0 0 1-4.24-4.24L12 10" />
    <path d="M14.5 9.5L9.5 14.5" />
  </svg>
);

const SubfolderIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    <line x1="12" y1="13" x2="12" y2="17" />
    <line x1="10" y1="15" x2="14" y2="15" />
  </svg>
);

const PenIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

export function Sidebar({ onConnect, width }: SidebarProps) {
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
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenu | null>(null);
  const [bgContextMenu, setBgContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [duplicatePrefill, setDuplicatePrefill] = useState<ConnectionPrefill | null>(null);
  const [healthMap, setHealthMap] = useState<Record<string, 'checking' | 'up' | 'down'>>({});
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newConnGroupId, setNewConnGroupId] = useState<string | null>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const bgMenuRef = useRef<HTMLDivElement>(null);

  // Close connection context menu on outside click / Escape
  useEffect(() => {
    if (!contextMenu && !folderContextMenu && !bgContextMenu) return;
    function onDown(e: MouseEvent) {
      const refs = [menuRef, folderMenuRef, bgMenuRef];
      if (refs.every(r => !r.current?.contains(e.target as Node))) {
        setContextMenu(null);
        setFolderContextMenu(null);
        setBgContextMenu(null);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setFolderContextMenu(null);
        setBgContextMenu(null);
      }
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, [contextMenu, folderContextMenu, bgContextMenu]);

  const flatGroups = flattenGroups(groups);

  const checkHealth = useCallback(async () => {
    if (!token) return;
    const allConns: { id: string; host: string; port: number }[] = [];
    function collectFromGroup(g: ConnectionGroup) {
      g.connections.forEach((c) => allConns.push({ id: c.id, host: c.host, port: c.port }));
      g.children.forEach(collectFromGroup);
    }
    groups.forEach(collectFromGroup);
    ungrouped.forEach((c) => allConns.push({ id: c.id, host: c.host, port: c.port }));
    sharedConnections.forEach((c) => allConns.push({ id: c.id, host: c.host, port: c.port }));
    if (allConns.length === 0) return;

    setHealthMap((prev) => {
      const next = { ...prev };
      allConns.forEach((c) => { next[c.id] = 'checking'; });
      return next;
    });

    try {
      const res = await fetch('/api/v1/connections/health-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ checks: allConns }),
      });
      if (!res.ok) return;
      const data = await res.json() as { results: { id: string; reachable: boolean }[] };
      setHealthMap((prev) => {
        const next = { ...prev };
        data.results.forEach((r) => { next[r.id] = r.reachable ? 'up' : 'down'; });
        return next;
      });
    } catch { /* ignore */ }
  }, [token, groups, ungrouped, sharedConnections]);

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
    if (groups.length > 0 || ungrouped.length > 0 || sharedConnections.length > 0) {
      checkHealth();
    }
  }, [groups, ungrouped, sharedConnections, checkHealth]);

  useEffect(() => {
    const t = setInterval(checkHealth, 60_000);
    return () => clearInterval(t);
  }, [checkHealth]);

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

  async function renameGroup(id: string, newName: string) {
    if (!token || !newName.trim()) return;
    await fetch(`/api/v1/connections/groups/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setRenamingGroupId(null);
    fetchConnections();
  }

  async function createSubfolder(parentId: string) {
    const name = window.prompt('Subfolder name:');
    if (!name?.trim() || !token) return;
    await fetch('/api/v1/connections/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: name.trim(), parentId }),
    });
    // Ensure parent stays expanded after subfolder creation
    setExpandedGroups((prev) => new Set([...prev, parentId]));
    fetchConnections();
  }

  function openNewConnectionInFolder(groupId: string | null) {
    setNewConnGroupId(groupId);
    setEditingConnection(null);
    setShowModal(true);
  }

  async function handleDuplicate(conn: Connection) {
    if (!token) return;
    try {
      const res = await fetch(`/api/v1/connections/${conn.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const d = await res.json();
      const prefill: ConnectionPrefill = {
        name: `${conn.name} - copy`,
        protocol: conn.protocol,
        host: conn.host,
        port: conn.port,
        username: d.username ?? '',
        groupId: conn.groupId,
        shared: d.shared === 1,
        smbShare: d.extraConfig?.share ?? '',
        smbDomain: d.extraConfig?.domain ?? '',
        tunnels: (d.tunnels ?? []).map((t: { localPort: number; remoteHost: string; remotePort: number }) => ({
          id: crypto.randomUUID(),
          localPort: String(t.localPort),
          remoteHost: t.remoteHost,
          remotePort: String(t.remotePort),
        })),
      };
      setDuplicatePrefill(prefill);
      setShowModal(true);
    } catch { /* ignore */ }
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

  async function handleExport() {
    if (!token) return;
    const res = await fetch('/api/v1/connections/export', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alterm-connections-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch('/api/v1/connections/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(json),
      });
      if (res.ok) {
        await fetchConnections();
      }
    } catch { /* ignore */ }
    // Reset so same file can be imported again
    e.target.value = '';
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
    const status = healthMap[conn.id];
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
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            status === 'up' ? 'bg-green-500' :
            status === 'down' ? 'bg-red-500' :
            status === 'checking' ? 'bg-yellow-400 animate-pulse' :
            'bg-border'
          }`}
          title={status === 'up' ? 'Reachable' : status === 'down' ? 'Unreachable' : 'Checking...'}
        />
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
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setFolderContextMenu({ x: e.clientX, y: e.clientY, group });
          }}
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
          {renamingGroupId === group.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') renameGroup(group.id, renameValue);
                if (e.key === 'Escape') setRenamingGroupId(null);
              }}
              onBlur={() => renameGroup(group.id, renameValue)}
              className="flex-1 px-1 py-0 text-sm bg-surface border border-accent rounded text-text-primary focus:outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-text-secondary font-medium truncate flex-1">{group.name}</span>
          )}
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
            onClick={() => { setEditingConnection(null); setNewConnGroupId(null); setShowModal(true); }}
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

          {/* Import/Export row */}
          <div className="flex gap-1">
            <button
              onClick={handleExport}
              className="flex-1 py-1 px-2 text-xs border border-border rounded text-text-secondary hover:bg-surface-hover flex items-center justify-center gap-1"
              title="Export connections to JSON"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export
            </button>
            <label className="flex-1 py-1 px-2 text-xs border border-border rounded text-text-secondary hover:bg-surface-hover flex items-center justify-center gap-1 cursor-pointer">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Import
              <input type="file" accept=".json" className="hidden" onChange={handleImport} />
            </label>
          </div>
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
          onContextMenu={(e) => {
            // Only trigger on the background, not on child connection/folder elements
            if (e.target === e.currentTarget) {
              e.preventDefault();
              setBgContextMenu({ x: e.clientX, y: e.clientY });
            }
          }}
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
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      healthMap[conn.id] === 'up' ? 'bg-green-500' :
                      healthMap[conn.id] === 'down' ? 'bg-red-500' :
                      healthMap[conn.id] === 'checking' ? 'bg-yellow-400 animate-pulse' :
                      'bg-border'
                    }`}
                    title={healthMap[conn.id] === 'up' ? 'Reachable' : healthMap[conn.id] === 'down' ? 'Unreachable' : 'Checking...'}
                  />
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
          prefill={duplicatePrefill ?? (newConnGroupId !== null && !editingConnection ? {
            name: '',
            protocol: 'rdp',
            host: '',
            port: 3389,
            username: '',
            groupId: newConnGroupId,
            shared: false,
            smbShare: '',
            smbDomain: '',
            tunnels: [],
          } : undefined)}
          onClose={() => {
            setShowModal(false);
            setEditingConnection(null);
            setDuplicatePrefill(null);
            setNewConnGroupId(null);
          }}
          onSaved={() => {
            setShowModal(false);
            setEditingConnection(null);
            setDuplicatePrefill(null);
            setNewConnGroupId(null);
            fetchConnections();
          }}
        />
      )}

      {/* Connection right-click context menu */}
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
            onClick={() => { handleDuplicate(contextMenu.conn); setContextMenu(null); }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Duplicate Configuration
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

      {/* Background right-click context menu */}
      {bgContextMenu && (
        <div
          ref={bgMenuRef}
          className="fixed z-50 bg-surface-alt border border-border rounded shadow-lg py-1 text-sm min-w-[160px]"
          style={{ left: bgContextMenu.x, top: bgContextMenu.y }}
        >
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-text-primary flex items-center gap-2"
            onClick={() => { openNewConnectionInFolder(null); setBgContextMenu(null); }}
          >
            <PlugIcon />
            New Connection
          </button>
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-text-primary flex items-center gap-2"
            onClick={() => { setShowNewFolder(true); setBgContextMenu(null); }}
          >
            <FolderIcon />
            New Folder
          </button>
        </div>
      )}

      {/* Folder right-click context menu */}
      {folderContextMenu && (
        <div
          ref={folderMenuRef}
          className="fixed z-50 bg-surface-alt border border-border rounded shadow-lg py-1 text-sm min-w-[180px]"
          style={{ left: folderContextMenu.x, top: folderContextMenu.y }}
        >
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-text-primary flex items-center gap-2"
            onClick={() => { openNewConnectionInFolder(folderContextMenu.group.id); setFolderContextMenu(null); }}
          >
            <PlugIcon />
            New Connection here
          </button>
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-text-primary flex items-center gap-2"
            onClick={() => { createSubfolder(folderContextMenu.group.id); setFolderContextMenu(null); }}
          >
            <SubfolderIcon />
            New Subfolder
          </button>
          <div className="border-t border-border my-1" />
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-text-primary flex items-center gap-2"
            onClick={() => {
              setRenamingGroupId(folderContextMenu.group.id);
              setRenameValue(folderContextMenu.group.name);
              // Ensure the folder is visible (expand it so the rename input renders)
              setExpandedGroups((prev) => new Set([...prev, folderContextMenu.group.id]));
              setFolderContextMenu(null);
            }}
          >
            <PenIcon />
            Rename
          </button>
          <button
            className="w-full px-4 py-1.5 text-left hover:bg-surface-hover text-red-400 flex items-center gap-2"
            onClick={() => { deleteGroup(folderContextMenu.group.id); setFolderContextMenu(null); }}
          >
            <TrashIcon size={13} />
            Delete Folder
          </button>
        </div>
      )}
    </>
  );
}
