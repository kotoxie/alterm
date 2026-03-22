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
  completeMfaLogin: (mfaToken: string, code: string) => Promise<void>;
  logout: () => void;
  setup: (username: string, password: string, displayName: string) => Promise<void>;
  needsSetup: boolean | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('alterm-token'));
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { needsSetup: ns } = await apiFetch('/auth/status');
        setNeedsSetup(ns);
        if (!ns && token) {
          const { user: u } = await apiFetch('/auth/me', {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          });
          setUser(u);
        }
      } catch {
        setToken(null);
        localStorage.removeItem('alterm-token');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }) as { token?: string; user?: User; mfaRequired?: boolean; mfaToken?: string };

    if (data.mfaRequired) {
      return { mfaRequired: true, mfaToken: data.mfaToken };
    }

    const t = data.token!;
    const u = data.user!;
    localStorage.setItem('alterm-token', t);
    setToken(t);
    setUser(u);
    setNeedsSetup(false);
    return {};
  }, []);

  const completeMfaLogin = useCallback(async (mfaToken: string, code: string) => {
    const { token: t, user: u } = await apiFetch('/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, code }),
    }) as { token: string; user: User };
    localStorage.setItem('alterm-token', t);
    setToken(t);
    setUser(u);
    setNeedsSetup(false);
  }, []);

  const logout = useCallback(() => {
    const t = localStorage.getItem('alterm-token');
    localStorage.removeItem('alterm-token');
    setToken(null);
    setUser(null);
    // Revoke the session on the server (fire-and-forget — UI clears immediately)
    if (t) {
      fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      }).catch(() => { /* ignore network errors on logout */ });
    }
  }, []);

  // Kick the user out when any fetch returns 401 (e.g. session revoked remotely)
  useEffect(() => {
    if (!token) return;
    const handler = () => {
      // Only act if we still have a stored token (avoid double-logout)
      if (localStorage.getItem('alterm-token')) logout();
    };
    window.addEventListener('alterm:unauthorized', handler);
    return () => window.removeEventListener('alterm:unauthorized', handler);
  }, [token, logout]);

  // Heartbeat: ping /auth/me every 30 s so idle sessions are kicked out promptly
  useEffect(() => {
    if (!token) return;
    const check = async () => {
      try {
        await fetch('/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        // 401 is handled by the global fetch interceptor above
      } catch { /* network error — ignore, don't log out */ }
    };
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [token]);

  const setup = useCallback(async (username: string, password: string, displayName: string) => {
    const { token: t, user: u } = await apiFetch('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName }),
    });
    localStorage.setItem('alterm-token', t);
    setToken(t);
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
