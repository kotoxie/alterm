import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { queryOne, execute } from '../db/helpers.js';
import { authRequired } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(authRequired);

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  avatar_text: string | null;
  role: string;
  password_hash: string;
}

// GET / — return own profile
router.get('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const user = queryOne<UserRow>(
    'SELECT id, username, display_name, email, avatar_text, role FROM users WHERE id = ?',
    [userId],
  );

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email,
    avatarText: user.avatar_text,
    role: user.role,
  });
});

// PUT / — update displayName, email, avatarText
router.put('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { displayName, email, avatarText } = req.body as {
    displayName?: string;
    email?: string;
    avatarText?: string;
  };

  const updates: string[] = [];
  const params: unknown[] = [];

  if (displayName !== undefined) { updates.push('display_name = ?'); params.push(displayName); }
  if (email !== undefined) { updates.push('email = ?'); params.push(email || null); }
  if (avatarText !== undefined) { updates.push('avatar_text = ?'); params.push(avatarText || null); }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  // Capture before values for audit diff
  const currentUser = queryOne<UserRow>(
    'SELECT display_name, email, avatar_text FROM users WHERE id = ?', [userId],
  );
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  if (displayName !== undefined) { before.displayName = currentUser?.display_name ?? null; after.displayName = displayName; }
  if (email !== undefined) { before.email = currentUser?.email ?? null; after.email = email || null; }
  if (avatarText !== undefined) { before.avatarText = currentUser?.avatar_text ?? null; after.avatarText = avatarText || null; }

  updates.push("updated_at = datetime('now')");
  params.push(userId);

  execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

  logAudit({
    userId,
    eventType: 'profile.updated',
    details: { before, after },
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

// PUT /password — change password
router.put('/password', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword are required' });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters' });
    return;
  }

  const user = queryOne<UserRow>('SELECT id, password_hash FROM users WHERE id = ?', [userId]);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    res.status(400).json({ error: 'Current password is incorrect' });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  execute("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", [newHash, userId]);

  logAudit({
    userId,
    eventType: 'auth.password_changed',
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

export default router;
