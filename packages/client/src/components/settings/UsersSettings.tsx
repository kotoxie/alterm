import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../hooks/useAuth';

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-yellow-500',
  'bg-red-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function getAvatarColor(username: string) {
  return AVATAR_COLORS[hashStr(username) % AVATAR_COLORS.length];
}

function initials(displayName: string) {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return displayName.slice(0, 2).toUpperCase();
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: string;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export function UsersSettings() {
  const { token, user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create user form
  const [showCreate, setShowCreate] = useState(false);
  const [createUsername, setCreateUsername] = useState('');
  const [createDisplayName, setCreateDisplayName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<'user' | 'admin'>('user');
  const [createMsg, setCreateMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);

  // Per-row messages
  const [rowMsgs, setRowMsgs] = useState<Record<string, { type: 'success' | 'error'; text: string }>>({});

  async function loadUsers() {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/users', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        setUsers(d.users);
      } else {
        setError('Failed to load users.');
      }
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, [token]);

  function setRowMsg(id: string, msg: { type: 'success' | 'error'; text: string }) {
    setRowMsgs((prev) => ({ ...prev, [id]: msg }));
    setTimeout(() => setRowMsgs((prev) => { const n = { ...prev }; delete n[id]; return n; }), 3000);
  }

  async function handleRoleChange(userId: string, newRole: string) {
    if (!token) return;
    const res = await fetch(`/api/v1/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u));
      setRowMsg(userId, { type: 'success', text: 'Role updated.' });
    } else {
      const d = await res.json();
      setRowMsg(userId, { type: 'error', text: d.error || 'Failed.' });
    }
  }

  async function handleUnlock(userId: string) {
    if (!token) return;
    const res = await fetch(`/api/v1/users/${userId}/unlock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, lockedUntil: null, failedLoginCount: 0 } : u));
      setRowMsg(userId, { type: 'success', text: 'User unlocked.' });
    } else {
      const d = await res.json();
      setRowMsg(userId, { type: 'error', text: d.error || 'Failed.' });
    }
  }

  async function handleDelete(userId: string, username: string) {
    if (!token) return;
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/v1/users/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } else {
      const d = await res.json();
      setRowMsg(userId, { type: 'error', text: d.error || 'Failed.' });
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setCreating(true);
    setCreateMsg(null);
    try {
      const res = await fetch('/api/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          username: createUsername,
          password: createPassword,
          displayName: createDisplayName,
          email: createEmail || null,
          role: createRole,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        setUsers((prev) => [...prev, d]);
        setCreateMsg({ type: 'success', text: 'User created.' });
        setCreateUsername('');
        setCreateDisplayName('');
        setCreateEmail('');
        setCreatePassword('');
        setCreateRole('user');
        setShowCreate(false);
      } else {
        const d = await res.json();
        setCreateMsg({ type: 'error', text: d.error || 'Failed to create user.' });
      }
    } catch {
      setCreateMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <p className="text-text-secondary text-sm">Loading users...</p>;
  if (error) return <p className="text-red-500 text-sm">{error}</p>;

  function isLocked(u: UserRow) {
    return !!u.lockedUntil && new Date(u.lockedUntil) > new Date();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary">Users</h2>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="px-3 py-1.5 bg-accent text-white rounded hover:bg-accent-hover text-sm font-medium"
        >
          {showCreate ? 'Cancel' : '+ Create User'}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreateUser} className="bg-surface-alt border border-border rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">New User</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Username</label>
              <input type="text" required value={createUsername} onChange={(e) => setCreateUsername(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Display Name</label>
              <input type="text" required value={createDisplayName} onChange={(e) => setCreateDisplayName(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Email</label>
              <input type="email" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Password</label>
              <input type="password" required value={createPassword} onChange={(e) => setCreatePassword(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">Role</label>
              <select value={createRole} onChange={(e) => setCreateRole(e.target.value as 'user' | 'admin')}
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm">
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          {createMsg && <p className={`text-sm ${createMsg.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>{createMsg.text}</p>}
          <button type="submit" disabled={creating}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium">
            {creating ? 'Creating...' : 'Create User'}
          </button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 pr-4 text-text-secondary font-medium">User</th>
              <th className="pb-2 pr-4 text-text-secondary font-medium">Email</th>
              <th className="pb-2 pr-4 text-text-secondary font-medium">Role</th>
              <th className="pb-2 pr-4 text-text-secondary font-medium">Status</th>
              <th className="pb-2 pr-4 text-text-secondary font-medium">Last Login</th>
              <th className="pb-2 text-text-secondary font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const locked = isLocked(u);
              const isSelf = u.id === currentUser?.id;
              const rowMsg = rowMsgs[u.id];
              return (
                <tr key={u.id} className="border-b border-border last:border-b-0">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-full ${getAvatarColor(u.username)} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                        {initials(u.displayName)}
                      </div>
                      <div>
                        <div className="text-text-primary font-medium">{u.displayName}</div>
                        <div className="text-text-secondary text-xs">{u.username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-text-secondary">{u.email ?? '—'}</td>
                  <td className="py-3 pr-4">
                    <select
                      value={u.role}
                      disabled={isSelf}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className="px-2 py-1 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-1 focus:ring-accent text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="py-3 pr-4">
                    {locked ? (
                      <span className="px-2 py-0.5 rounded text-xs bg-red-500/15 text-red-400 font-medium">Locked</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs bg-green-500/15 text-green-400 font-medium">Active</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary text-xs">{formatDate(u.lastLoginAt)}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {rowMsg && (
                        <span className={`text-xs ${rowMsg.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                          {rowMsg.text}
                        </span>
                      )}
                      {locked && (
                        <button
                          onClick={() => handleUnlock(u.id)}
                          className="px-2 py-1 text-xs bg-surface-hover border border-border rounded hover:bg-surface text-text-primary"
                        >
                          Unlock
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(u.id, u.username)}
                        disabled={isSelf}
                        className="px-2 py-1 text-xs border border-red-500/30 rounded text-red-400 hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {users.length === 0 && <p className="text-text-secondary text-sm py-4 text-center">No users found.</p>}
      </div>
    </div>
  );
}
