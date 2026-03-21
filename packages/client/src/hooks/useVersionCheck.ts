import { useEffect, useState } from 'react';

const GITHUB_REPO = 'kotoxie/alterm';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // re-check every hour

function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPatch > bPatch;
}

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
}

export function useVersionCheck(): VersionInfo {
  const current = __APP_VERSION__;
  const [latest, setLatest] = useState<string | null>(null);
  const [releaseUrl, setReleaseUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
          { headers: { Accept: 'application/vnd.github+json' } },
        );
        if (!res.ok) return;
        const data = await res.json() as { tag_name: string; html_url: string };
        if (!cancelled) {
          setLatest(data.tag_name);
          setReleaseUrl(data.html_url);
        }
      } catch {
        // network unavailable — silently ignore
      }
    }

    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const updateAvailable = latest !== null && semverGt(latest, current);

  return { current, latest, updateAvailable, releaseUrl };
}
