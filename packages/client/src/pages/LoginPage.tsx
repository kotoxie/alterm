import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';

export function LoginPage() {
  const { login, completeMfaLogin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // MFA step
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const autoSubmittingRef = useRef(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await login(username, password);
      if (result.mfaRequired && result.mfaToken) {
        setMfaToken(result.mfaToken);
        setMfaRequired(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMfaCode(code: string) {
    if (autoSubmittingRef.current) return;
    autoSubmittingRef.current = true;
    setError('');
    setSubmitting(true);
    try {
      await completeMfaLogin(mfaToken, code, trustDevice);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code');
      setMfaCode(''); // Clear so user can retry
    } finally {
      setSubmitting(false);
      autoSubmittingRef.current = false;
    }
  }

  async function handleMfaSubmit(e: FormEvent) {
    e.preventDefault();
    await submitMfaCode(mfaCode);
  }

  // Auto-submit when all 6 digits are entered
  useEffect(() => {
    if (mfaCode.length === 6 && !submitting && !autoSubmittingRef.current) {
      submitMfaCode(mfaCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mfaCode]);

  if (mfaRequired) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface">
        <div className="w-full max-w-md p-8 bg-surface-alt rounded-lg border border-border">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-text-primary">Alterm</h1>
            <p className="text-text-secondary mt-2">Two-factor authentication</p>
          </div>
          <form onSubmit={handleMfaSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Authenticator code
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoFocus
                placeholder="000000"
                disabled={submitting}
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-center text-xl tracking-widest disabled:opacity-60"
              />
              <p className="text-xs text-text-secondary mt-1">
                {submitting ? 'Verifying…' : 'Enter the 6-digit code — it submits automatically.'}
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
                className="w-4 h-4 accent-accent rounded"
              />
              <span className="text-sm text-text-secondary">Don't ask for MFA on this device for 30 days</span>
            </label>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={submitting || mfaCode.length < 6}
              className="w-full py-2 px-4 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 font-medium"
            >
              {submitting ? 'Verifying...' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => { setMfaRequired(false); setMfaCode(''); setMfaToken(''); setError(''); }}
              className="w-full py-2 px-4 border border-border rounded text-text-secondary hover:bg-surface-hover text-sm"
            >
              Back to login
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface">
      <div className="w-full max-w-md p-8 bg-surface-alt rounded-lg border border-border">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-text-primary">Alterm</h1>
          <p className="text-text-secondary mt-2">Sign in to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 px-4 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 font-medium"
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
