import { Router, type Request, type Response } from 'express';
import { authRequired } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { getAllSettings, getSetting, setSettings } from '../services/settings.js';
import { encrypt } from '../services/encryption.js';

const router = Router();
router.use(authRequired);

// GET / — return all settings (admin only)
router.get('/', (req: Request, res: Response) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  const settings = getAllSettings();
  res.json({ settings });
});

// GET /public — return non-sensitive settings for all authenticated users
router.get('/public', (_req: Request, res: Response) => {
  const PUBLIC_KEYS = [
    'app.name',
    'app.logo',
    'health_monitor.enabled',
    'ssh.font_family',
    'ssh.font_size',
    'ssh.cursor_style',
    'ssh.cursor_blink',
    'ssh.theme',
    'ssh.scrollback',
    'auth.oidc_enabled',
    'auth.oidc_button_label',
    'auth.ldap_enabled',
    'auth.local_enabled',
    'security.idle_timeout_minutes',
  ];
  const settings: Record<string, string> = {};
  for (const key of PUBLIC_KEYS) {
    settings[key] = getSetting(key);
  }
  res.json({ settings });
});

// PUT / — update settings (admin only)
router.put('/', (req: Request, res: Response) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  const updates = req.body as Record<string, string>;
  if (typeof updates !== 'object' || Array.isArray(updates) || updates === null) {
    res.status(400).json({ error: 'Body must be a JSON object of key-value pairs' });
    return;
  }

  // Fields that must be encrypted before storage
  const ENCRYPTED_FIELDS = ['auth.ldap_bind_password', 'auth.oidc_client_secret'];
  const UNCHANGED_SENTINEL = '__unchanged__';

  // Capture before values for audit diff
  const before: Record<string, string> = {};
  for (const key of Object.keys(updates)) before[key] = getSetting(key);

  const processedUpdates: Record<string, string> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value === UNCHANGED_SENTINEL) continue;
    if (ENCRYPTED_FIELDS.includes(key) && value) {
      processedUpdates[key] = encrypt(value);
    } else {
      processedUpdates[key] = value;
    }
  }

  setSettings(processedUpdates);

  logAudit({
    userId: req.user!.userId,
    eventType: 'settings.updated',
    details: { before, after: processedUpdates },
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

export default router;
