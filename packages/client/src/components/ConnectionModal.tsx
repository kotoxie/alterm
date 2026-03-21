import { useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';

interface Connection {
  id: string;
  name: string;
  protocol: 'ssh' | 'rdp' | 'smb';
  host: string;
  port: number;
  groupId: string | null;
}

interface FlatGroup {
  id: string;
  name: string;
}

interface ConnectionModalProps {
  connection: Connection | null;
  groups: FlatGroup[];
  onClose: () => void;
  onSaved: () => void;
}

const defaultPorts: Record<string, number> = {
  ssh: 22,
  rdp: 3389,
  smb: 445,
};

export function ConnectionModal({ connection, groups, onClose, onSaved }: ConnectionModalProps) {
  const { token } = useAuth();
  const [name, setName] = useState(connection?.name ?? '');
  const [protocol, setProtocol] = useState<'ssh' | 'rdp' | 'smb'>(connection?.protocol ?? 'rdp');
  const [host, setHost] = useState(connection?.host ?? '');
  const [port, setPort] = useState(connection?.port ?? 3389);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [groupId, setGroupId] = useState<string>(connection?.groupId ?? '');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [localGroups, setLocalGroups] = useState<FlatGroup[]>(groups);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  function handleProtocolChange(p: 'ssh' | 'rdp' | 'smb') {
    setProtocol(p);
    if (!connection) setPort(defaultPorts[p]);
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name || !token) return;
    try {
      const res = await fetch('/api/v1/connections/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const newGroup: FlatGroup = { id: data.id, name: data.name };
      setLocalGroups((prev) => [...prev, newGroup]);
      setGroupId(data.id);
      setNewFolderName('');
      setShowNewFolder(false);
    } catch { /* ignore */ }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = {
        name,
        protocol,
        host,
        port,
        username,
        password,
        groupId: groupId || null,
        ...(protocol === 'ssh' && privateKey ? { privateKey } : {}),
      };
      const url = connection ? `/api/v1/connections/${connection.id}` : '/api/v1/connections';
      const method = connection ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-surface-alt border border-border rounded-lg shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-text-primary mb-4">
          {connection ? 'Edit Connection' : 'New Connection'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="My Server"
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Protocol</label>
            <div className="flex gap-2">
              {(['rdp', 'ssh', 'smb'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleProtocolChange(p)}
                  className={`flex-1 py-2 rounded text-sm font-medium border ${
                    protocol === p
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface border-border text-text-secondary hover:bg-surface-hover'
                  }`}
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-text-secondary mb-1">Host</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                required
                placeholder="192.168.1.100"
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="w-24">
              <label className="block text-sm font-medium text-text-secondary mb-1">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                required
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="user"
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={connection ? '(unchanged)' : ''}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {protocol === 'ssh' && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Private Key <span className="font-normal">(optional, overrides password)</span>
              </label>
              <textarea
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                rows={4}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent font-mono text-xs resize-none"
              />
            </div>
          )}

          {/* Folder selector */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Folder</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">No Folder</option>
              {localGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>

            {showNewFolder ? (
              <div className="flex gap-1 mt-1.5">
                <input
                  ref={newFolderInputRef}
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleCreateFolder(); }
                    if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); }
                  }}
                  placeholder="Folder name"
                  className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  type="button"
                  onClick={handleCreateFolder}
                  className="px-2 py-1 text-sm bg-accent text-white rounded hover:bg-accent-hover"
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}
                  className="px-2 py-1 text-sm border border-border rounded text-text-secondary hover:bg-surface-hover"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowNewFolder(true)}
                className="mt-1.5 text-xs text-accent hover:text-accent-hover"
              >
                + Create new folder
              </button>
            )}
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-border rounded text-text-secondary hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 font-medium"
            >
              {saving ? 'Saving...' : connection ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
