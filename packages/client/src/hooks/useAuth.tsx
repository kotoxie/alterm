import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  theme: string | null;
}

interface LoginResult {
  mfaRequired?: boolean;
  mfaToken?: string;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  completeMfaLogin: (mfaToken: string, code: string, trustDevice?: boolean) => Promise<void>;
  logout: () => void;
  setup: (username: string, password: string, displayName: string) => Promise<void>;
  needsSetup: boolean | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { needsSetup: ns } = await apiFetch('/auth/status');
        setNeedsSetup(ns);
        if (!ns) {
          try {
            const { user: u } = await apiFetch('/auth/me');
            setUser(u);
            setToken('cookie');
          } catch {
            // Not authenticated — that's fine
          }
        }
      } catch {
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }) as { token?: string; user?: User; mfaRequired?: boolean; mfaToken?: string };

    if (data.mfaRequired) {
      return { mfaRequired: true, mfaToken: data.mfaToken };
    }

    const u = data.user!;
    setToken('cookie');
    setUser(u);
    setNeedsSetup(false);
    return {};
  }, []);

  const completeMfaLogin = useCallback(async (mfaToken: string, code: string, trustDevice?: boolean) => {
    const { user: u } = await apiFetch('/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, code, trustDevice: !!trustDevice }),
    }) as { token: string; user: User };
    setToken('cookie');
    setUser(u);
    setNeedsSetup(false);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('alterm-token');
    localStorage.removeItem('alterm-sessions');
    setToken(null);
    setUser(null);
    // Revoke the session on the server (fire-and-forget — UI clears immediately)
    fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => { /* ignore network errors on logout */ });
  }, []);

  // Kick the user out when any fetch returns 401 (e.g. session revoked remotely)
  useEffect(() => {
    if (!token) return;
    const handler = () => {
      // Only act if we still have a token (avoid double-logout)
      if (token) logout();
    };
    window.addEventListener('alterm:unauthorized', handler);
    return () => window.removeEventListener('alterm:unauthorized', handler);
  }, [token, logout]);

  // Heartbeat: ping /auth/me every 30 s so idle sessions are kicked out promptly
  useEffect(() => {
    if (!token) return;
    const check = async () => {
      try {
        await fetch('/api/v1/auth/me', { credentials: 'include' });
        // 401 is handled by the global fetch interceptor above
      } catch { /* network error — ignore, don't log out */ }
    };
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [token]);

  const setup = useCallback(async (username: string, password: string, displayName: string) => {
    const { user: u } = await apiFetch('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName }),
    });
    setToken('cookie');
    setUser(u);
    setNeedsSetup(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, completeMfaLogin, logout, setup, needsSetup }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
