import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';

type Settings = Record<string, string>;

const DEFAULTS: Settings = {
  'app.name': 'Alterm',
  'ssh.font_size': '14',
  'ssh.font_family': 'Cascadia Code, Fira Code, Menlo, Monaco, Courier New, monospace',
  'ssh.scrollback': '5000',
  'ssh.cursor_style': 'block',
};

let cache: Settings | null = null;
const subs = new Set<() => void>();

export function invalidateSettings() {
  cache = null;
  subs.forEach((f) => f());
}

export function useSettings() {
  const { token } = useAuth();
  const [settings, setSettings] = useState<Settings>(cache ?? DEFAULTS);
  const [loading, setLoading] = useState(!cache);

  const fetch_ = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/v1/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        cache = d.settings;
        setSettings(d.settings);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!cache) fetch_();
    else setSettings(cache);
    subs.add(fetch_);
    return () => {
      subs.delete(fetch_);
    };
  }, [fetch_]);

  return { settings, loading, refresh: fetch_ };
}
