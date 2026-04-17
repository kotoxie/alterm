import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';

export function SetupPage() {
  const { setup } = useAuth();
  const [username, setUsername] = useState('admin');
  const [displayName, setDisplayName] = useState('Administrator');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await setup(username, password, displayName);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface">
      <div className="w-full max-w-md p-8 bg-surface-alt rounded-lg border border-border">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-text-primary">Gatwy</h1>
          <p className="text-text-secondary mt-2">Initial Setup — Create Admin Account</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-hidden focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-hidden focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-hidden focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-hidden focus:ring-2 focus:ring-accent"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 px-4 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 font-medium"
          >
            {submitting ? 'Creating...' : 'Create Admin Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
