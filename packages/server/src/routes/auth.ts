import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { queryOne, execute } from '../db/helpers.js';
import { signToken, verifyToken } from '../services/jwt.js';
import { logAudit } from '../services/audit.js';
import { getSetting } from '../services/settings.js';

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

  const maxFailed = parseInt(getSetting('security.max_failed_logins'), 10) || 5;
  const lockoutMinutes = parseInt(getSetting('security.lockout_minutes'), 10) || 30;

  const user = queryOne<UserRow>('SELECT * FROM users WHERE username = ?', [username]);

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

  const token = signToken({ userId: user.id, username: user.username, role: user.role });

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
