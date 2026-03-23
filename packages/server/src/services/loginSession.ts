import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { execute, queryOne } from '../db/helpers.js';
import { getSetting } from './settings.js';
import { parseUA } from './ua.js';
import type { Request } from 'express';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeIp(raw: string | undefined): string {
  if (!raw) return 'Unknown';
  // Strip IPv4-mapped IPv6 prefix (e.g. "::ffff:192.168.1.1" → "192.168.1.1")
  return raw.replace(/^::ffff:/i, '');
}

export function createLoginSession(req: Request, userId: string, token: string): void {
  const { browser, os } = parseUA(req.headers['user-agent']);
  const rawIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip;
  const ip = normalizeIp(rawIp);
  execute(
    `INSERT INTO login_sessions (id, user_id, token_hash, browser, os, ip_address) VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), userId, hashToken(token), browser, os, ip],
  );
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  browser: string | null;
  os: string | null;
  ip_address: string | null;
  created_at: string;
  last_used_at: string;
  revoked: number;
}

export type SessionCheckResult = 'ok' | 'revoked' | 'idle_expired' | 'not_found';

/**
 * Single DB round-trip: checks revocation, enforces idle timeout, and touches last_used_at.
 * Returns the reason if the session should be rejected, or 'ok' to proceed.
 */
export function checkAndTouchSession(tokenHash: string): SessionCheckResult {
  const row = queryOne<SessionRow>(
    'SELECT revoked, last_used_at FROM login_sessions WHERE token_hash = ?',
    [tokenHash],
  );

  // Backward compat: sessions created before login_sessions feature are allowed
  if (!row) return 'not_found';

  if (row.revoked === 1) return 'revoked';

  // Enforce idle timeout if configured
  const idleMinutes = parseInt(getSetting('security.idle_timeout_minutes') ?? '0', 10);
  if (idleMinutes > 0) {
    const lastUsed = new Date(row.last_used_at.replace(' ', 'T') + 'Z').getTime();
    const idleMs = idleMinutes * 60 * 1000;
    if (Date.now() - lastUsed > idleMs) {
      // Revoke the session so subsequent checks are instant
      execute('UPDATE login_sessions SET revoked = 1 WHERE token_hash = ?', [tokenHash]);
      return 'idle_expired';
    }
  }

  // Touch last_used_at — throttled to once per 60 seconds to avoid excessive DB writes
  execute(
    `UPDATE login_sessions SET last_used_at = datetime('now')
     WHERE token_hash = ? AND revoked = 0
       AND (strftime('%s','now') - strftime('%s', last_used_at)) > 60`,
    [tokenHash],
  );

  return 'ok';
}

/** Keep for WebSocket callers that only need a revocation check (no touch needed) */
export function isSessionRevoked(tokenHash: string): boolean {
  const row = queryOne<SessionRow>(
    'SELECT revoked, last_used_at FROM login_sessions WHERE token_hash = ?',
    [tokenHash],
  );
  if (!row) return false;
  if (row.revoked === 1) return true;

  // Also enforce idle timeout in WS checks
  const idleMinutes = parseInt(getSetting('security.idle_timeout_minutes') ?? '0', 10);
  if (idleMinutes > 0) {
    const lastUsed = new Date(row.last_used_at.replace(' ', 'T') + 'Z').getTime();
    if (Date.now() - lastUsed > idleMinutes * 60 * 1000) {
      execute('UPDATE login_sessions SET revoked = 1 WHERE token_hash = ?', [tokenHash]);
      return true;
    }
  }

  return false;
}
