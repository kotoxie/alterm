import { Router, type Request, type Response } from 'express';
import { authRequired } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { getAllSettings, setSettings } from '../services/settings.js';

const router = Router();
router.use(authRequired);

// GET / — return all settings
router.get('/', (_req: Request, res: Response) => {
  const settings = getAllSettings();
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

  setSettings(updates);

  logAudit({
    userId: req.user!.userId,
    eventType: 'settings.updated',
    details: { keys: Object.keys(updates) },
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

export default router;
