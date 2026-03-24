import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import express from 'express';
import { queryAll, queryOne, execute } from '../db/helpers.js';
import { authRequired, adminRequired } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { getSetting } from '../services/settings.js';
import { config } from '../config.js';

const router = Router();
router.use(authRequired);

interface SessionRow {
  id: string;
  user_id: string;
  connection_id: string;
  protocol: string;
  started_at: string;
  ended_at: string | null;
  recording_path: string | null;
  connection_name: string | null;
  username: string | null;
}

// GET / — list sessions (admin sees all, user sees own)
router.get('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const isAdmin = req.user!.role === 'admin';
  const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit as string || '50', 10)));
  const offset = (page - 1) * limit;

  const whereClause = isAdmin ? '' : 'WHERE s.user_id = ?';
  const params: unknown[] = isAdmin ? [limit, offset] : [userId, limit, offset];

  const sessions = queryAll<SessionRow>(
    `SELECT s.id, s.user_id, s.connection_id, s.protocol, s.started_at, s.ended_at, s.recording_path,
            c.name AS connection_name, u.username
     FROM sessions s
     LEFT JOIN connections c ON c.id = s.connection_id
     LEFT JOIN users u ON u.id = s.user_id
     ${whereClause}
     ORDER BY s.started_at DESC
     LIMIT ? OFFSET ?`,
    params,
  );

  res.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      userId: s.user_id,
      protocol: s.protocol,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      hasRecording: !!s.recording_path && fs.existsSync(s.recording_path),
      connectionName: s.connection_name,
      username: s.username,
    })),
    page,
    limit,
  });
});

// DELETE / — purge all session history and recordings (admin only)
router.delete('/', adminRequired, (req: Request, res: Response) => {
  const userId = req.user!.userId;

  // Collect all recording file paths before deleting rows
  const rows = queryAll<{ recording_path: string | null }>('SELECT recording_path FROM sessions', []);
  const totalSessions = rows.length;

  // Delete recording files from disk
  let deletedRecordings = 0;
  for (const row of rows) {
    if (row.recording_path && fs.existsSync(row.recording_path)) {
      try { fs.unlinkSync(row.recording_path); deletedRecordings++; } catch { /* ignore */ }
    }
  }

  // Delete all session rows
  execute('DELETE FROM sessions', []);

  logAudit({
    userId,
    eventType: 'admin.sessions.purge',
    target: 'all',
    details: { deletedSessions: totalSessions, deletedRecordings },
    ipAddress: req.ip,
  });

  res.json({ ok: true, deletedSessions: totalSessions, deletedRecordings });
});

// GET /:id/recording — stream recording file (.cast or .webm)
router.get('/:id/recording', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const isAdmin = req.user!.role === 'admin';
  const { id } = req.params;

  const session = queryOne<{ recording_path: string | null; user_id: string }>(
    'SELECT recording_path, user_id FROM sessions WHERE id = ?',
    [id],
  );

  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  if (!isAdmin && session.user_id !== userId) { res.status(403).json({ error: 'Forbidden' }); return; }
  if (!session.recording_path || !fs.existsSync(session.recording_path)) {
    res.status(404).json({ error: 'Recording not found' }); return;
  }

  const isWebm = session.recording_path.endsWith('.webm');
  res.setHeader('Content-Type', isWebm ? 'video/webm' : 'text/plain');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(session.recording_path).pipe(res);
});

// POST /rdp-session — create a session row for an RDP recording and return sessionId
router.post('/rdp-session', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { connectionId } = req.body as { connectionId?: string };
  if (!connectionId) { res.status(400).json({ error: 'connectionId required' }); return; }

  const conn = queryOne<{ id: string; recording_enabled: number }>(
    'SELECT id, recording_enabled FROM connections WHERE id = ? AND (user_id = ? OR shared = 1)',
    [connectionId, userId],
  );
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const globalRecording = getSetting('session.recording_enabled') === 'true';
  const shouldRecord = globalRecording && conn.recording_enabled === 1;

  if (!shouldRecord) {
    res.json({ sessionId: null, shouldRecord: false });
    return;
  }

  const sessionId = uuid();
  execute(
    'INSERT INTO sessions (id, user_id, connection_id, protocol) VALUES (?, ?, ?, ?)',
    [sessionId, userId, connectionId, 'rdp'],
  );
  res.json({ sessionId, shouldRecord: true });
});

// POST /:id/recording/chunk — append a binary WebM chunk to the recording file
router.post('/:id/recording/chunk', express.raw({ type: '*/*', limit: '10mb' }), (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const isAdmin = req.user!.role === 'admin';
  const { id } = req.params;

  const session = queryOne<{ recording_path: string | null; user_id: string }>(
    'SELECT recording_path, user_id FROM sessions WHERE id = ?',
    [id],
  );
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  if (!isAdmin && session.user_id !== userId) { res.status(403).json({ error: 'Forbidden' }); return; }

  let filePath = session.recording_path;
  if (!filePath) {
    fs.mkdirSync(config.recordingsDir, { recursive: true });
    filePath = path.join(config.recordingsDir, `${id}.webm`);
    execute('UPDATE sessions SET recording_path = ? WHERE id = ?', [filePath, id]);
  }

  try {
    fs.appendFileSync(filePath, req.body as Buffer);
  } catch {
    res.status(500).json({ error: 'Failed to write chunk' }); return;
  }
  res.json({ ok: true });
});

// POST /:id/recording/finalize — mark RDP session as ended
router.post('/:id/recording/finalize', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const isAdmin = req.user!.role === 'admin';
  const { id } = req.params;

  const session = queryOne<{ user_id: string }>(
    'SELECT user_id FROM sessions WHERE id = ?',
    [id],
  );
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  if (!isAdmin && session.user_id !== userId) { res.status(403).json({ error: 'Forbidden' }); return; }

  execute("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?", [id]);
  res.json({ ok: true });
});

// GET /storage — return total bytes used by all recording files (admin only)
router.get('/storage', adminRequired, (_req: Request, res: Response) => {
  let totalBytes = 0;
  if (fs.existsSync(config.recordingsDir)) {
    for (const f of fs.readdirSync(config.recordingsDir)) {
      try {
        const stat = fs.statSync(path.join(config.recordingsDir, f));
        if (stat.isFile()) totalBytes += stat.size;
      } catch { /* ignore */ }
    }
  }
  res.json({ bytes: totalBytes });
});

export default router;
