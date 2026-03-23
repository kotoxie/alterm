import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import { queryAll, queryOne } from '../db/helpers.js';
import { authRequired } from '../middleware/auth.js';

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

// GET /:id/recording — stream asciicast file
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

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(session.recording_path).pipe(res);
});

export default router;
