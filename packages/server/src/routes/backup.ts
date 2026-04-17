import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { requirePermission } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { createBackup, restoreBackup, getRecordingsSizeInfo } from '../services/backup.js';
import { getDb, restoreDbFromBytes } from '../db/index.js';
import { config } from '../config.js';

const router = Router();

// GET /size — return estimated backup size breakdown
router.get('/size', requirePermission('settings.backup'), (_req: Request, res: Response) => {
  try {
    const dbSize = Buffer.from(getDb().export()).length;
    const { recordingsSize, recordingCount } = getRecordingsSizeInfo();
    res.json({ dbSize, recordingsSize, recordingCount });
  } catch (e) {
    res.status(500).json({ error: `Size check failed: ${(e as Error).message}` });
  }
});

// POST /export — create and download encrypted backup
router.post('/export', requirePermission('settings.backup'), (req: Request, res: Response) => {
  const { password, includeRecordings = false } = req.body as { password?: string; includeRecordings?: boolean };
  if (!password || password.length < 8) {
    res.status(400).json({ error: 'Backup password must be at least 8 characters' });
    return;
  }
  try {
    const dbBytes = Buffer.from(getDb().export());
    const backupBuf = createBackup(password, dbBytes, includeRecordings);
    const filename = `gatwy-backup-${new Date().toISOString().slice(0, 10)}.geb`;
    logAudit({
      userId: req.user!.userId,
      eventType: 'admin.backup.export',
      target: filename,
      details: { sizeBytes: backupBuf.length, includeRecordings },
      ipAddress: req.ip,
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', backupBuf.length);
    res.end(backupBuf);
  } catch (e) {
    res.status(500).json({ error: `Backup failed: ${(e as Error).message}` });
  }
});

// POST /import — restore system from encrypted backup
// Body: raw .geb binary. Password in X-Backup-Password header.
router.post('/import', requirePermission('settings.backup'), (req: Request, res: Response) => {
  const password = req.headers['x-backup-password'] as string | undefined;
  if (!password) {
    res.status(400).json({ error: 'X-Backup-Password header required' });
    return;
  }
  const data = req.body as Buffer;
  if (!Buffer.isBuffer(data) || data.length < 100) {
    res.status(400).json({ error: 'Valid backup file required' });
    return;
  }
  try {
    const restored = restoreBackup(data, password);

    // Restore recordings — sanitize filenames to prevent path traversal (C2)
    fs.mkdirSync(config.recordingsDir, { recursive: true });
    for (const f of fs.readdirSync(config.recordingsDir)) {
      try { fs.unlinkSync(path.join(config.recordingsDir, f)); } catch { /* ignore */ }
    }
    for (const rec of restored.recordings) {
      const safeName = path.basename(rec.name);
      if (!safeName || !/^[\w.\-]+$/.test(safeName)) {
        console.warn(`[backup] Skipping recording with invalid filename: ${rec.name}`);
        continue;
      }
      fs.writeFileSync(path.join(config.recordingsDir, safeName), rec.data);
    }

    // Hot-swap the database (last, so the audit log above isn't lost)
    restoreDbFromBytes(restored.dbBytes);

    res.json({
      ok: true,
      message: 'Backup restored successfully. Please reload the page.',
      recordingsRestored: restored.recordings.length,
    });
  } catch (e) {
    const msg = (e as Error).message;
    // Use 422 (not 401) for wrong password — 401 can trigger browser auth dialogs
    const status = msg.includes('Invalid backup password') || msg.includes('corrupted') ? 422 : 400;
    res.status(status).json({ error: msg });
  }
});

export default router;
