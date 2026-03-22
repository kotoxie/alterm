import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { queryAll, queryOne, execute } from '../db/helpers.js';
import { authRequired } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(authRequired);

function requireAdmin(req: Request, res: Response): boolean {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: string;
  failed_login_count: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  mfa_enabled: number;
}

// GET / — list all users
router.get('/', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const users = queryAll<UserRow>(
    `SELECT id, username, display_name, email, role, failed_login_count,
            locked_until, last_login_at, created_at, mfa_enabled
     FROM users ORDER BY created_at ASC`,
  );

  res.json({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      email: u.email,
      role: u.role,
      failedLoginCount: u.failed_login_count,
      lockedUntil: u.locked_until,
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at,
      mfaEnabled: u.mfa_enabled === 1,
    })),
  });
});

// POST / — create user
router.post('/', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const { username, password, displayName, email, role } = req.body as {
    username?: string;
    password?: string;
    displayName?: string;
    email?: string;
    role?: string;
  };

  if (!username || !password || !displayName) {
    res.status(400).json({ error: 'username, password, and displayName are required' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const validRoles = ['admin', 'user'];
  const userRole = validRoles.includes(role ?? '') ? role! : 'user';

  const existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    res.status(400).json({ error: 'Username already exists' });
    return;
  }

  const id = uuid();
  const passwordHash = await bcrypt.hash(password, 12);

  execute(
    'INSERT INTO users (id, username, password_hash, display_name, email, role) VALUES (?, ?, ?, ?, ?, ?)',
    [id, username, passwordHash, displayName, email || null, userRole],
  );

  logAudit({
    userId: req.user!.userId,
    eventType: 'user.created',
    target: username,
    details: { after: { username, displayName, email: email || null, role: userRole } },
    ipAddress: req.ip,
  });

  res.status(201).json({
    id,
    username,
    displayName,
    email: email || null,
    role: userRole,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
  });
});

// PUT /:id — update displayName, email, role
router.put('/:id', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const id = req.params.id as string;
  const { displayName, email, role } = req.body as {
    displayName?: string;
    email?: string;
    role?: string;
  };

  const user = queryOne<UserRow>(
    'SELECT id, username, display_name, email, role FROM users WHERE id = ?', [id],
  );
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (displayName !== undefined) { updates.push('display_name = ?'); params.push(displayName); }
  if (email !== undefined) { updates.push('email = ?'); params.push(email || null); }
  if (role !== undefined) {
    if (!['admin', 'user'].includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
    updates.push('role = ?');
    params.push(role);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  if (displayName !== undefined) { before.displayName = user.display_name; after.displayName = displayName; }
  if (email !== undefined) { before.email = user.email; after.email = email || null; }
  if (role !== undefined) { before.role = user.role; after.role = role; }

  updates.push("updated_at = datetime('now')");
  params.push(id);

  execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

  logAudit({
    userId: req.user!.userId,
    eventType: 'user.updated',
    target: user.username,
    details: { before, after },
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

// DELETE /:id — delete user (cannot delete self)
router.delete('/:id', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const id = req.params.id as string;

  if (id === req.user!.userId) {
    res.status(400).json({ error: 'Cannot delete your own account' });
    return;
  }

  const user = queryOne<UserRow>('SELECT id, username, display_name, email, role FROM users WHERE id = ?', [id]);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  execute('DELETE FROM users WHERE id = ?', [id]);

  logAudit({
    userId: req.user!.userId,
    eventType: 'user.deleted',
    target: user.username,
    details: { before: { username: user.username, displayName: user.display_name, email: user.email, role: user.role } },
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

// POST /:id/reset-password — admin resets a user's password
router.post('/:id/reset-password', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const id = req.params.id as string;
  const { newPassword } = req.body as { newPassword?: string };

  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters' });
    return;
  }

  const user = queryOne<UserRow>('SELECT id, username FROM users WHERE id = ?', [id]);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  execute("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", [passwordHash, id]);

  logAudit({
    userId: req.user!.userId,
    eventType: 'user.password_reset',
    target: user.username,
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

// POST /:id/unlock — reset lockout
router.post('/:id/unlock', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const id = req.params.id as string;

  const user = queryOne('SELECT id FROM users WHERE id = ?', [id]);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  execute(
    "UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?",
    [id],
  );

  logAudit({
    userId: req.user!.userId,
    eventType: 'user.unlocked',
    target: id,
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

export default router;
