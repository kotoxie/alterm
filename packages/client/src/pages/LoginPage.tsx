import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';

interface ProvidersConfig {
  local: boolean;
  ldap: boolean;
  oidc: boolean;
  oidcButtonLabel: string;
}

export function LoginPage() {
  const { login, completeMfaLogin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [providers, setProviders] = useState<ProvidersConfig | null>(null);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [loginMethod, setLoginMethod] = useState<'local' | 'ldap'>('local');
  const [insecureKey, setInsecureKey] = useState(false);
  const [keyWarnDismissed, setKeyWarnDismissed] = useState(false);
  const [appName, setAppName] = useState('Alterm');
  const [appLogo, setAppLogo] = useState('');

  // MFA step
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const autoSubmittingRef = useRef(false);

  useEffect(() => {
    fetch('/api/v1/auth/providers')
      .then((r) => r.json())
      .then((d) => {
        const cfg = d as ProvidersConfig;
        setProviders(cfg);
        // If only LDAP is enabled (not local), default to ldap method
        if (!cfg.local && cfg.ldap) setLoginMethod('ldap');
      })
      .catch(() => setProviders({ local: true, ldap: false, oidc: false, oidcButtonLabel: 'Sign in with SSO' }));

    const params = new URLSearchParams(window.location.search);
    if (params.has('sso')) {
      window.history.replaceState({}, '', '/');
      window.location.reload();
    }
    if (params.has('sso_error')) {
      setSsoError(decodeURIComponent(params.get('sso_error') ?? 'SSO authentication failed'));
      window.history.replaceState({}, '', '/');
    }
  }, []);

  useEffect(() => {
    fetch('/api/v1/settings/public')
      .then(r => r.json())
      .then((d: { settings?: Record<string, string> }) => {
        if (d?.settings?.['system.insecure_key'] === 'true') setInsecureKey(true);
        if (d?.settings?.['app.name']) setAppName(d.settings['app.name']);
        if (d?.settings?.['app.logo']) setAppLogo(d.settings['app.logo']);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSsoError(null);
    setSubmitting(true);
    try {
      const effectiveMethod = loginMethod === 'ldap' || (!providers?.local && providers?.ldap) ? 'ldap' : 'local';
      if (effectiveMethod === 'ldap') {
        // Call LDAP endpoint directly
        const res = await fetch('/api/v1/auth/login/ldap', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json() as { token?: string; user?: { id: string; username: string; displayName: string; role: 'admin' | 'user'; theme: string | null }; error?: string };
        if (!res.ok) throw new Error(data.error || 'Login failed');
        // Reload to pick up cookie-based auth
        window.location.reload();
      } else {
        const result = await login(username, password);
        if (result.mfaRequired && result.mfaToken) {
          setMfaToken(result.mfaToken);
          setMfaRequired(true);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSsoLogin() {
    try {
      const res = await fetch('/api/v1/auth/oidc/authorize', { credentials: 'include' });
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error ?? 'SSO initialization failed');
      }
    } catch {
      setError('SSO initialization failed');
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
      setMfaCode('');
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

  const showLocalForm = providers === null || providers.local || (!providers.local && !providers.oidc);
  const showLdapForm = providers?.ldap ?? false;
  const showPasswordForm = showLocalForm || showLdapForm;
  const showMethodSelector = showLocalForm && showLdapForm;

  if (mfaRequired) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface">
        <div className="w-full max-w-md p-8 bg-surface-alt rounded-lg border border-border">
          <div className="text-center mb-8">
            {appLogo ? (
              <img src={appLogo} alt={appName} className="h-12 w-auto max-w-[180px] object-contain mx-auto mb-2" />
            ) : (
              <h1 className="text-3xl font-bold text-text-primary">{appName}</h1>
            )}
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
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-hidden focus:ring-2 focus:ring-accent text-center text-xl tracking-widest disabled:opacity-60"
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
      {insecureKey && !keyWarnDismissed && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-red-700 text-white px-4 py-3 flex items-start gap-3 shadow-lg">
          <span className="text-xl shrink-0 mt-0.5">⚠</span>
          <div className="flex-1 text-sm">
            <span className="font-bold">Security Warning: </span>
            ALTERM_ENCRYPTION_KEY is not set. Encryption key is stored alongside encrypted data.
            Set this environment variable for production use.{' '}
            <a href="https://github.com/kotoxie/alterm#encryption" target="_blank" rel="noreferrer" className="underline opacity-80 hover:opacity-100">Learn more</a>
          </div>
          <button onClick={() => setKeyWarnDismissed(true)} className="shrink-0 text-white/70 hover:text-white text-2xl leading-none mt-[-2px]">×</button>
        </div>
      )}
      <div className="w-full max-w-md p-8 bg-surface-alt rounded-lg border border-border">
        <div className="text-center mb-8">
          {appLogo ? (
            <img src={appLogo} alt={appName} className="h-12 w-auto max-w-[180px] object-contain mx-auto mb-2" />
          ) : (
            <h1 className="text-3xl font-bold text-text-primary">{appName}</h1>
          )}
          <p className="text-text-secondary mt-2">Sign in to continue</p>
        </div>

        {(ssoError || error) && (
          <p className="text-red-500 text-sm mb-4">{ssoError || error}</p>
        )}

        {showPasswordForm && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {showMethodSelector && (
              <div className="flex gap-2 p-1 bg-surface rounded border border-border">
                <button
                  type="button"
                  onClick={() => setLoginMethod('local')}
                  className={`flex-1 py-1.5 text-sm rounded transition-colors ${loginMethod === 'local' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  Local
                </button>
                <button
                  type="button"
                  onClick={() => setLoginMethod('ldap')}
                  className={`flex-1 py-1.5 text-sm rounded transition-colors ${loginMethod === 'ldap' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  LDAP Directory
                </button>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
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
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-hidden focus:ring-2 focus:ring-accent"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2 px-4 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 font-medium"
            >
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}

        {/* SSO Button */}
        {providers?.oidc && (
          <div>
            {showPasswordForm && (
              <div className="relative flex items-center my-4">
                <div className="grow border-t border-border" />
                <span className="shrink mx-4 text-xs text-text-secondary">or</span>
                <div className="grow border-t border-border" />
              </div>
            )}
            <button
              type="button"
              onClick={handleSsoLogin}
              className="w-full py-2 px-4 border border-border rounded text-text-primary hover:bg-surface-hover flex items-center justify-center gap-2 font-medium"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
              </svg>
              {providers.oidcButtonLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
