import { useRef, useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';

interface Connection {
  id: string;
  name: string;
  protocol: 'ssh' | 'rdp' | 'smb';
  host: string;
  port: number;
  groupId: string | null;
  shared?: number;
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

interface TunnelDef { id: string; localPort: string; remoteHost: string; remotePort: string; }

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
  const [shared, setShared] = useState<boolean>(connection ? (connection.shared === 1) : false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [localGroups, setLocalGroups] = useState<FlatGroup[]>(groups);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [tunnels, setTunnels] = useState<TunnelDef[]>([]);
  const [smbShare, setSmbShare] = useState('');
  const [smbDomain, setSmbDomain] = useState('');
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!connection?.id || !token) return;
    fetch(`/api/v1/connections/${connection.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.tunnels) setTunnels(d.tunnels.map((t: Omit<TunnelDef, 'id'> & { localPort: number; remotePort: number }) => ({
          id: crypto.randomUUID(),
          localPort: String(t.localPort),
          remoteHost: t.remoteHost,
          remotePort: String(t.remotePort),
        })));
        if (d.extraConfig?.share) setSmbShare(d.extraConfig.share as string);
        if (d.extraConfig?.domain) setSmbDomain(d.extraConfig.domain as string);
      })
      .catch(() => {});
  }, [connection?.id, token]);

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
      const tunnelsClean = tunnels.filter((t) => t.localPort && t.remoteHost && t.remotePort);
      const body: Record<string, unknown> = {
        name,
        protocol,
        host,
        port,
        username,
        password,
        groupId: groupId || null,
        shared,
        ...(protocol === 'ssh' && privateKey ? { privateKey } : {}),
      };
      if (protocol === 'ssh') {
        body.tunnels = tunnelsClean.map(({ localPort, remoteHost, remotePort }) => ({
          localPort: parseInt(localPort, 10),
          remoteHost,
          remotePort: parseInt(remotePort, 10),
        }));
      }
      if (protocol === 'smb') {
        body.extraConfig = { share: smbShare.trim(), ...(smbDomain.trim() ? { domain: smbDomain.trim() } : {}) };
      }
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

          {protocol === 'ssh' && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Port Forwards
                <span className="font-normal ml-1 text-xs">(local→remote, active while connected)</span>
              </label>
              <div className="space-y-1.5">
                {tunnels.map((t) => (
                  <div key={t.id} className="flex gap-1 items-center">
                    <input
                      type="number"
                      placeholder="Local port"
                      value={t.localPort}
                      onChange={(e) => setTunnels((prev) => prev.map((x) => x.id === t.id ? { ...x, localPort: e.target.value } : x))}
                      className="w-20 px-2 py-1.5 bg-surface border border-border rounded text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <span className="text-text-secondary text-xs">→</span>
                    <input
                      type="text"
                      placeholder="Remote host"
                      value={t.remoteHost}
                      onChange={(e) => setTunnels((prev) => prev.map((x) => x.id === t.id ? { ...x, remoteHost: e.target.value } : x))}
                      className="flex-1 px-2 py-1.5 bg-surface border border-border rounded text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <span className="text-text-secondary text-xs">:</span>
                    <input
                      type="number"
                      placeholder="Port"
                      value={t.remotePort}
                      onChange={(e) => setTunnels((prev) => prev.map((x) => x.id === t.id ? { ...x, remotePort: e.target.value } : x))}
                      className="w-16 px-2 py-1.5 bg-surface border border-border rounded text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <button
                      type="button"
                      onClick={() => setTunnels((prev) => prev.filter((x) => x.id !== t.id))}
                      className="p-1 text-text-secondary hover:text-red-400"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setTunnels((prev) => [...prev, { id: crypto.randomUUID(), localPort: '', remoteHost: '', remotePort: '' }])}
                  className="text-xs text-accent hover:text-accent-hover"
                >
                  + Add tunnel
                </button>
              </div>
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

          {protocol === 'smb' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Share name <span className="font-normal text-xs">(e.g. <code className="font-mono">Documents</code> for \\host\Documents)</span>
                </label>
                <input
                  type="text"
                  value={smbShare}
                  onChange={(e) => setSmbShare(e.target.value)}
                  placeholder="share"
                  required
                  className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Domain <span className="font-normal text-xs">(optional — for AD or workgroup auth)</span>
                </label>
                <input
                  type="text"
                  value={smbDomain}
                  onChange={(e) => setSmbDomain(e.target.value)}
                  placeholder="WORKGROUP"
                  className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent font-mono"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => setShared((v) => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                shared ? 'bg-accent' : 'bg-surface-hover border border-border'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${shared ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-sm text-text-secondary">Share with all users</span>
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
