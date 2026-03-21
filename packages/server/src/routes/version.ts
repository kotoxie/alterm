import { Router, type Request, type Response } from 'express';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Read version from root package.json at startup
const rootPkg = require(path.resolve(__dirname, '../../../../package.json')) as { version: string };
const CURRENT_VERSION: string = rootPkg.version;

const GITHUB_REPO = 'kotoxie/alterm';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry {
  latest: string;
  releaseUrl: string;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

async function fetchLatestRelease(): Promise<CacheEntry | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'alterm-server' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { tag_name: string; html_url: string };
    return { latest: data.tag_name, releaseUrl: data.html_url, fetchedAt: Date.now() };
  } catch {
    return null;
  }
}

function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPatch > bPatch;
}

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  // ?force=true bypasses the cache (used by manual refresh button)
  const force = req.query.force === 'true';

  if (force || !cache || Date.now() - cache.fetchedAt > CACHE_TTL_MS) {
    const fresh = await fetchLatestRelease();
    if (fresh) cache = fresh;
  }

  const latest = cache?.latest ?? null;
  const updateAvailable = latest !== null && semverGt(latest, CURRENT_VERSION);

  res.json({
    current: CURRENT_VERSION,
    latest,
    updateAvailable,
    releaseUrl: updateAvailable ? (cache?.releaseUrl ?? null) : null,
  });
});

export default router;
