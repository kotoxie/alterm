import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { queryOne, execute } from '../db/helpers.js';
import { signToken, verifyToken, signMfaToken, verifyMfaToken } from '../services/jwt.js';
import { logAudit } from '../services/audit.js';
import { getSetting } from '../services/settings.js';
import { createLoginSession, hashToken } from '../services/loginSession.js';
import { authRequired } from '../middleware/auth.js';
import { authenticator } from 'otplib';
import { parseUA } from '../services/ua.js';
import { issueWsTicket } from '../services/wsTicket.js';

// ── IP-based rate limiting for login ──────────────────────────────────────────
interface IpRecord { count: number; resetAt: number; }
const ipLoginAttempts = new Map<string, IpRecord>();
const IP_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const IP_RATE_MAX = 30; // max login attempts per IP per window

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const rec = ipLoginAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    ipLoginAttempts.set(ip, { count: 1, resetAt: now + IP_RATE_WINDOW_MS });
    return true;
  }
  rec.count += 1;
  return rec.count <= IP_RATE_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of ipLoginAttempts) {
    if (now > rec.resetAt) ipLoginAttempts.delete(ip);
  }
}, IP_RATE_WINDOW_MS);

const TRUSTED_DEVICE_COOKIE = 'alterm_trusted_device';
const TRUSTED_DEVICE_DAYS = 30;

function isTrustedDevice(req: Request, userId: string): boolean {
  const cookieVal: string | undefined = req.cookies?.[TRUSTED_DEVICE_COOKIE];
  if (!cookieVal) return false;
  const hash = hashToken(cookieVal);
  const row = queryOne<{ id: string; expires_at: string }>(
    `SELECT id, expires_at FROM trusted_devices WHERE token_hash = ? AND user_id = ?`,
    [hash, userId],
  );
  if (!row) return false;
  // Check expiry
  const expiry = new Date(row.expires_at.replace(' ', 'T') + 'Z');
  if (expiry < new Date()) {
    execute('DELETE FROM trusted_devices WHERE id = ?', [row.id]);
    return false;
  }
  return true;
}

function setTrustedDevice(req: Request, res: Response, userId: string): void {
  const token = uuid() + uuid(); // 64-char random token
  const hash = hashToken(token);
  const ua = parseUA(req.headers['user-agent']);
  const ip = (req.ip ?? '').replace(/^::ffff:/i, '');
  const expiresDate = new Date();
  expiresDate.setDate(expiresDate.getDate() + TRUSTED_DEVICE_DAYS);
  const expiresStr = expiresDate.toISOString().replace('T', ' ').slice(0, 19);

  execute(
    `INSERT INTO trusted_devices (id, user_id, token_hash, browser, os, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), userId, hash, ua.browser, ua.os, ip, expiresStr],
  );

  res.cookie(TRUSTED_DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

const router = Router();

// In-memory tracker for non-existent usernames (resets on restart — acceptable for single-container)
interface AttemptRecord { count: number; lockedUntil: Date | null; }
const unknownAttempts = new Map<string, AttemptRecord>();

function checkUnknownLock(username: string): Date | null {
  const rec = unknownAttempts.get(username);
  if (rec?.lockedUntil && rec.lockedUntil > new Date()) return rec.lockedUntil;
  return null;
}

function recordUnknownFail(username: string, maxFailed: number, lockoutMinutes: number): void {
  const rec = unknownAttempts.get(username) ?? { count: 0, lockedUntil: null };
  rec.count += 1;
  if (rec.count >= maxFailed) {
    const until = new Date();
    until.setMinutes(until.getMinutes() + lockoutMinutes);
    rec.lockedUntil = until;
  }
  unknownAttempts.set(username, rec);
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: string;
  theme: string | null;
  failed_login_count: number;
  locked_until: string | null;
  mfa_enabled: number;
  mfa_secret: string | null;
}

// Check if setup is needed
router.get('/status', (_req: Request, res: Response) => {
  const row = queryOne<{ 'COUNT(*)': number }>('SELECT COUNT(*) FROM users');
  const count = row ? row['COUNT(*)'] : 0;
  res.json({ needsSetup: count === 0 });
});

// Initial setup — create admin
router.post('/setup', async (req: Request, res: Response) => {
  const row = queryOne<{ 'COUNT(*)': number }>('SELECT COUNT(*) FROM users');
  const count = row ? row['COUNT(*)'] : 0;
  if (count > 0) {
    res.status(400).json({ error: 'Setup already completed' });
    return;
  }

  const { username, password, displayName } = req.body;
  if (!username || !password || !displayName) {
    res.status(400).json({ error: 'Username, password, and display name are required' });
    return;
  }

  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const id = uuid();
  const passwordHash = await bcrypt.hash(password, 12);

  execute(
    'INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)',
    [id, username, passwordHash, displayName, 'admin'],
  );

  const token = signToken({ userId: id, username, role: 'admin' });
  createLoginSession(req, id, token);

  logAudit({
    userId: id,
    eventType: 'user.setup',
    target: username,
    ipAddress: req.ip,
  });

  res.json({
    token,
    user: { id, username, displayName, role: 'admin', theme: null },
  });
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  // IP-based rate limiting (guards against password spraying / distributed brute force)
  const clientIp = (req.ip ?? 'unknown').replace(/^::ffff:/i, '');
  if (!checkIpRateLimit(clientIp)) {
    res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    return;
  }

  const maxFailed = parseInt(getSetting('security.max_failed_logins'), 10) || 5;
  const lockoutMinutes = parseInt(getSetting('security.lockout_minutes'), 10) || 30;

  const user = queryOne<UserRow>('SELECT id, username, password_hash, display_name, role, theme, failed_login_count, locked_until, mfa_enabled, mfa_secret FROM users WHERE username = ?', [username]);

  if (!user) {
    // Apply lockout to unknown usernames too (in-memory, resets on restart)
    const lockedUntil = checkUnknownLock(username);
    if (lockedUntil) {
      res.status(429).json({ error: `Account locked until ${lockedUntil.toLocaleString()}` });
      return;
    }
    recordUnknownFail(username, maxFailed, lockoutMinutes);
    logAudit({
      eventType: 'auth.login_failed',
      target: username,
      details: { reason: 'user_not_found' },
      ipAddress: req.ip,
    });
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  // Check if account is locked
  // SQLite datetime() returns "YYYY-MM-DD HH:MM:SS" (space, not T) — add T+Z for correct UTC parsing
  if (user.locked_until && new Date(user.locked_until.replace(' ', 'T') + 'Z') > new Date()) {
    const until = new Date(user.locked_until.replace(' ', 'T') + 'Z').toLocaleString();
    res.status(429).json({ error: `Account locked until ${until}` });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const newCount = (user.failed_login_count ?? 0) + 1;

    if (newCount >= maxFailed) {
      execute(
        `UPDATE users SET failed_login_count = ?, locked_until = datetime('now', '+${lockoutMinutes} minutes'), updated_at = datetime('now') WHERE id = ?`,
        [newCount, user.id],
      );
    } else {
      execute(
        "UPDATE users SET failed_login_count = ?, updated_at = datetime('now') WHERE id = ?",
        [newCount, user.id],
      );
    }

    logAudit({
      userId: user.id,
      eventType: 'auth.login_failed',
      target: username,
      details: { reason: 'invalid_password', failedCount: newCount },
      ipAddress: req.ip,
    });
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  // Reset lockout on success
  execute(
    "UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [user.id],
  );

  // If MFA is enabled, check for trusted device cookie first
  if (user.mfa_enabled === 1 && !isTrustedDevice(req, user.id)) {
    const mfaToken = signMfaToken(user.id);
    res.json({ mfaRequired: true, mfaToken });
    return;
  }

  const maxSessionMinutes = parseInt(getSetting('security.max_session_minutes') ?? '0', 10);
  const token = signToken({ userId: user.id, username: user.username, role: user.role }, maxSessionMinutes || undefined);
  createLoginSession(req, user.id, token);

  logAudit({
    userId: user.id,
    eventType: 'auth.login_success',
    target: username,
    ipAddress: req.ip,
  });

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      theme: user.theme,
    },
  });
});

// POST /login/mfa — complete MFA login
router.post('/login/mfa', async (req: Request, res: Response) => {
  const { mfaToken, code, trustDevice } = req.body as { mfaToken?: string; code?: string; trustDevice?: boolean };

  if (!mfaToken || !code) {
    res.status(400).json({ error: 'mfaToken and code are required' });
    return;
  }

  let userId: string;
  try {
    const payload = verifyMfaToken(mfaToken);
    userId = payload.userId;
  } catch {
    res.status(401).json({ error: 'Invalid or expired MFA token' });
    return;
  }

  const user = queryOne<UserRow>(
    'SELECT id, username, display_name, role, theme, mfa_secret, mfa_enabled FROM users WHERE id = ?',
    [userId],
  );

  if (!user || !user.mfa_secret || user.mfa_enabled !== 1) {
    res.status(400).json({ error: 'MFA not configured for this user' });
    return;
  }

  const isValid = authenticator.verify({ token: code, secret: user.mfa_secret });
  if (!isValid) {
    res.status(401).json({ error: 'Invalid verification code' });
    return;
  }

  const maxSessionMinutes = parseInt(getSetting('security.max_session_minutes') ?? '0', 10);
  const token = signToken({ userId: user.id, username: user.username, role: user.role }, maxSessionMinutes || undefined);
  createLoginSession(req, user.id, token);

  // Set trusted device cookie if requested
  if (trustDevice) {
    setTrustedDevice(req, res, user.id);
  }

  logAudit({
    userId: user.id,
    eventType: 'auth.login_success',
    target: user.username,
    details: { mfa: true, trustedDevice: !!trustDevice },
    ipAddress: req.ip,
  });

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      theme: user.theme,
    },
  });
});

// Logout — revoke the current session token
router.post('/logout', authRequired, (req: Request, res: Response) => {
  const tokenHash = req.user!.tokenHash;
  if (tokenHash) {
    execute('UPDATE login_sessions SET revoked = 1 WHERE token_hash = ?', [tokenHash]);
  }
  logAudit({
    userId: req.user!.userId,
    eventType: 'auth.logout',
    target: req.user!.username,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

// POST /ws-ticket — issue a short-lived one-time WebSocket ticket
// Clients exchange this for the JWT token in WS URL params so the long-lived
// token never appears in server access logs.
router.post('/ws-ticket', authRequired, (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const tokenHash = req.user!.tokenHash!;
  const ticket = issueWsTicket(userId, tokenHash);
  res.json({ ticket });
});

// Get current user
router.get('/me', (req: Request, res: Response) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const payload = verifyToken(token);
    const user = queryOne<UserRow>(
      'SELECT id, username, display_name, role, theme FROM users WHERE id = ?',
      [payload.userId],
    );

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        theme: user.theme,
      },
    });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
