import { useEffect, useState } from 'react';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // re-check every hour

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
}

export function useVersionCheck(): VersionInfo {
  const current = __APP_VERSION__;
  const [latest, setLatest] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [releaseUrl, setReleaseUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch('/api/v1/version');
        if (!res.ok) return;
        const data = await res.json() as {
          current: string;
          latest: string | null;
          updateAvailable: boolean;
          releaseUrl: string | null;
        };
        if (!cancelled) {
          setLatest(data.latest);
          setUpdateAvailable(data.updateAvailable);
          setReleaseUrl(data.releaseUrl);
        }
      } catch {
        // network unavailable — silently ignore
      }
    }

    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return { current, latest, updateAvailable, releaseUrl };
}
