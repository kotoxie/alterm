import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  theme: string | null;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
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

  const login = useCallback(async (username: string, password: string) => {
    const { token: t, user: u } = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    localStorage.setItem('alterm-token', t);
    setToken(t);
    setUser(u);
    setNeedsSetup(false);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('alterm-token');
    setToken(null);
    setUser(null);
  }, []);

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
    <AuthContext.Provider value={{ user, token, loading, login, logout, setup, needsSetup }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
