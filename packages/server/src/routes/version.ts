import { Router, type Request, type Response } from 'express';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { logAudit } from '../services/audit.js';
import { getSetting } from '../services/settings.js';
import { verifyToken } from '../services/jwt.js';

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

interface FetchResult {
  entry: CacheEntry | null;
  error: string | null;
}

let cache: CacheEntry | null = null;
let lastFetchError: string | null = null;

async function fetchLatestRelease(): Promise<FetchResult> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'alterm-server' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { entry: null, error: `GitHub API returned HTTP ${res.status}` };
    const data = await res.json() as { tag_name: string; html_url: string };
    return { entry: { latest: data.tag_name, releaseUrl: data.html_url, fetchedAt: Date.now() }, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { entry: null, error: `Could not reach GitHub: ${msg}` };
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

function optionalUserId(req: Request): string | null {
  try {
    const header = req.headers.authorization;
    const token = (header?.startsWith('Bearer ') ? header.slice(7) : null) ?? req.cookies?.['alterm_token'];
    if (!token) return null;
    return verifyToken(token).userId ?? null;
  } catch {
    return null;
  }
}

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  // ?force=true bypasses the cache (used by manual refresh button)
  const force = req.query.force === 'true';

  if (force || !cache || Date.now() - cache.fetchedAt > CACHE_TTL_MS) {
    const { entry, error } = await fetchLatestRelease();
    if (entry) { cache = entry; lastFetchError = null; }
    else lastFetchError = error;
  }

  const latest = cache?.latest ?? null;
  const updateAvailable = latest !== null && semverGt(latest, CURRENT_VERSION);
  const fetchError = lastFetchError;

  // Audit log and notification event on manual checks only
  if (force) {
    const userId = optionalUserId(req);
    const ip = (req.ip ?? '').replace(/^::ffff:/i, '') || undefined;

    if (getSetting('version.audit_log_checks') !== 'false') {
      logAudit({
        userId,
        eventType: 'system.version_check',
        ipAddress: ip,
        details: {
          current: CURRENT_VERSION,
          latest: latest ?? null,
          updateAvailable,
          ...(fetchError ? { error: fetchError } : {}),
        },
      });
    }

    if (updateAvailable && getSetting('version.notify_on_update') === 'true') {
      logAudit({
        userId,
        eventType: 'system.update_available',
        target: latest ?? undefined,
        ipAddress: ip,
        details: { current: CURRENT_VERSION, latest },
      });
    }
  }

  res.json({
    current: CURRENT_VERSION,
    latest,
    updateAvailable,
    releaseUrl: updateAvailable ? (cache?.releaseUrl ?? null) : null,
    fetchError,
  });
});

export default router;
