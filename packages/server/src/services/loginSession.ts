import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { execute, queryOne } from '../db/helpers.js';
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

export function isSessionRevoked(tokenHash: string): boolean {
  const row = queryOne<SessionRow>(
    'SELECT revoked FROM login_sessions WHERE token_hash = ?',
    [tokenHash],
  );
  if (!row) return false; // backward compat: sessions before this feature was added are allowed
  return row.revoked === 1;
}

export function touchSession(tokenHash: string): void {
  // Only write if last_used_at is older than 60 seconds to avoid excessive DB writes
  execute(
    `UPDATE login_sessions SET last_used_at = datetime('now')
     WHERE token_hash = ? AND revoked = 0
       AND (strftime('%s','now') - strftime('%s', last_used_at)) > 60`,
    [tokenHash],
  );
}
