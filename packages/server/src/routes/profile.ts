import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { queryOne, execute } from '../db/helpers.js';
import { authRequired } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { getSetting } from '../services/settings.js';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';

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
  mfa_enabled: number;
  mfa_secret: string | null;
  ssh_prefs_json: string | null;
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

// GET /ssh-prefs — return user's SSH prefs merged with global defaults
router.get('/ssh-prefs', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const user = queryOne<UserRow>('SELECT ssh_prefs_json FROM users WHERE id = ?', [userId]);
  const json = user?.ssh_prefs_json ?? null;
  const userPrefs = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  const globalDefaults = {
    fontFamily: getSetting('ssh.font_family'),
    fontSize: getSetting('ssh.font_size'),
    cursorStyle: getSetting('ssh.cursor_style'),
    cursorBlink: getSetting('ssh.cursor_blink') !== 'false',
    theme: getSetting('ssh.theme') || 'vscode-dark',
    scrollback: getSetting('ssh.scrollback'),
  };
  res.json({ ...globalDefaults, ...userPrefs });
});

// PUT /ssh-prefs — save user's SSH prefs
router.put('/ssh-prefs', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const prefs = req.body as Record<string, unknown>;
  execute('UPDATE users SET ssh_prefs_json = ? WHERE id = ?', [JSON.stringify(prefs), userId]);
  res.json({ ok: true });
});

// DELETE /ssh-prefs — reset user's SSH prefs to global defaults
router.delete('/ssh-prefs', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  execute('UPDATE users SET ssh_prefs_json = NULL WHERE id = ?', [userId]);
  res.json({ ok: true });
});

// GET /mfa/status — return MFA enabled state
router.get('/mfa/status', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const user = queryOne<UserRow>('SELECT mfa_enabled FROM users WHERE id = ?', [userId]);
  res.json({ enabled: user?.mfa_enabled === 1 });
});

// POST /mfa/setup — generate TOTP secret and QR code
router.post('/mfa/setup', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const user = queryOne<UserRow>('SELECT username FROM users WHERE id = ?', [userId]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const secret = authenticator.generateSecret();
  const appName = getSetting('app.name') || 'Alterm';
  // Label format: "Alterm (+username)" so users can identify the account in their authenticator app
  const otpUri = authenticator.keyuri(`${appName} (+${user.username})`, appName, secret);
  const qrDataUrl = await QRCode.toDataURL(otpUri);

  execute('UPDATE users SET mfa_secret = ? WHERE id = ?', [secret, userId]);
  res.json({ secret, qrDataUrl });
});

// POST /mfa/verify — verify TOTP and enable MFA
router.post('/mfa/verify', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { token } = req.body as { token?: string };
  if (!token) { res.status(400).json({ error: 'token is required' }); return; }

  const user = queryOne<UserRow>('SELECT mfa_secret FROM users WHERE id = ?', [userId]);
  const secret = user?.mfa_secret;
  if (!secret) { res.status(400).json({ error: 'MFA setup not started' }); return; }

  const isValid = authenticator.verify({ token, secret });
  if (!isValid) { res.status(400).json({ error: 'Invalid verification code' }); return; }

  execute('UPDATE users SET mfa_enabled = 1 WHERE id = ?', [userId]);
  res.json({ ok: true });
});

// POST /mfa/disable — disable MFA (requires current password — no TOTP needed in case it was lost)
router.post('/mfa/disable', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { password } = req.body as { password?: string };
  if (!password) { res.status(400).json({ error: 'password is required' }); return; }

  const user = queryOne<UserRow>('SELECT password_hash, mfa_enabled FROM users WHERE id = ?', [userId]);
  if (!user || user.mfa_enabled !== 1) {
    res.status(400).json({ error: 'MFA is not enabled' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) { res.status(400).json({ error: 'Incorrect password' }); return; }

  execute('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?', [userId]);
  res.json({ ok: true });
});

export default router;
