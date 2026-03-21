import { useEffect, useState, useCallback } from 'react';

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // re-check every 15 minutes

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  refresh: () => void;
}

export function useVersionCheck(): VersionInfo {
  const current = __APP_VERSION__;
  const [latest, setLatest] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [releaseUrl, setReleaseUrl] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/version');
      if (!res.ok) return;
      const data = await res.json() as {
        current: string;
        latest: string | null;
        updateAvailable: boolean;
        releaseUrl: string | null;
      };
      setLatest(data.latest);
      setUpdateAvailable(data.updateAvailable);
      setReleaseUrl(data.releaseUrl);
    } catch {
      // network unavailable — silently ignore
    }
  }, []);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
    check();
  }, [check]);

  useEffect(() => {
    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [check]);

  return { current, latest, updateAvailable, releaseUrl, refresh };
}
