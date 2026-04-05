import { Router, type Request, type Response } from 'express';
import { authRequired, userCan } from '../middleware/auth.js';
import { queryAll, queryOne } from '../db/helpers.js';

const router = Router();
router.use(authRequired);

interface FileSessionRow {
  id: string;
  user_id: string;
  connection_id: string;
  protocol: string;
  started_at: string;
  ended_at: string | null;
  connection_name: string | null;
  username: string | null;
  event_count: number;
}

interface FileSessionEventRow {
  id: string;
  session_id: string;
  timestamp: string;
  action: string;
  path: string;
  detail_json: string | null;
}

// GET / — list file sessions (paginated)
router.get('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const canViewAny = userCan(req, 'sessions.view_any');
  const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit as string || '50', 10)));
  const offset = (page - 1) * limit;

  const whereClause = canViewAny ? '' : 'WHERE fs.user_id = ?';
  const params: unknown[] = canViewAny ? [limit, offset] : [userId, limit, offset];

  const rows = queryAll<FileSessionRow>(
    `SELECT fs.id, fs.user_id, fs.connection_id, fs.protocol, fs.started_at, fs.ended_at,
            c.name AS connection_name, u.username,
            COUNT(fse.id) AS event_count
     FROM file_sessions fs
     LEFT JOIN connections c ON c.id = fs.connection_id
     LEFT JOIN users u ON u.id = fs.user_id
     LEFT JOIN file_session_events fse ON fse.session_id = fs.id
     ${whereClause}
     GROUP BY fs.id
     ORDER BY fs.started_at DESC
     LIMIT ? OFFSET ?`,
    params,
  );

  res.json({
    sessions: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      protocol: r.protocol,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      connectionName: r.connection_name,
      username: r.username,
      eventCount: Number(r.event_count),
    })),
    page,
    limit,
  });
});

// GET /:id/export — download all file session events as JSON or CSV
router.get('/:id/export', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const canViewAny = userCan(req, 'sessions.view_any');
  const sessionId = req.params.id as string;
  const format = ((req.query.format as string) || 'json').toLowerCase();

  interface SessionMeta {
    user_id: string;
    protocol: string;
    started_at: string;
    ended_at: string | null;
    connection_name: string | null;
    username: string | null;
  }

  const session = queryOne<SessionMeta>(
    `SELECT fs.user_id, fs.protocol, fs.started_at, fs.ended_at,
            c.name AS connection_name, u.username
     FROM file_sessions fs
     LEFT JOIN connections c ON c.id = fs.connection_id
     LEFT JOIN users u ON u.id = fs.user_id
     WHERE fs.id = ?`,
    [sessionId],
  );
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  if (!canViewAny && session.user_id !== userId) { res.status(403).json({ error: 'Forbidden' }); return; }

  const events = queryAll<FileSessionEventRow>(
    'SELECT id, session_id, timestamp, action, path, detail_json FROM file_session_events WHERE session_id = ? ORDER BY timestamp ASC',
    [sessionId],
  );

  const ts = session.started_at.replace(/[^0-9]/g, '').slice(0, 14);
  const connSlug = (session.connection_name ?? 'unknown').replace(/[^a-z0-9]/gi, '_');
  const filename = `file-activity_${connSlug}_${ts}`;

  if (format === 'csv') {
    const header = 'session_id,connection,username,protocol,session_started,session_ended,timestamp,action,path,detail\n';
    const rows = events.map((e) => {
      const detail = e.detail_json ?? '';
      return [
        sessionId,
        `"${(session.connection_name ?? '').replace(/"/g, '""')}"`,
        `"${(session.username ?? '').replace(/"/g, '""')}"`,
        session.protocol,
        session.started_at,
        session.ended_at ?? '',
        e.timestamp,
        e.action,
        `"${e.path.replace(/"/g, '""')}"`,
        `"${detail.replace(/"/g, '""')}"`,
      ].join(',');
    }).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    res.send(header + rows);
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    res.json({
      session: {
        id: sessionId,
        connectionName: session.connection_name,
        username: session.username,
        protocol: session.protocol,
        startedAt: session.started_at,
        endedAt: session.ended_at,
      },
      events: events.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        action: e.action,
        path: e.path,
        detail: e.detail_json ? (JSON.parse(e.detail_json) as Record<string, unknown>) : null,
      })),
    });
  }
});

// GET /:id/events — get events for a file session
router.get('/:id/events', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const canViewAny = userCan(req, 'sessions.view_any');
  const sessionId = req.params.id as string;

  const session = queryOne<{ user_id: string }>(
    'SELECT user_id FROM file_sessions WHERE id = ?',
    [sessionId],
  );
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  if (!canViewAny && session.user_id !== userId) { res.status(403).json({ error: 'Forbidden' }); return; }

  const events = queryAll<FileSessionEventRow>(
    'SELECT id, session_id, timestamp, action, path, detail_json FROM file_session_events WHERE session_id = ? ORDER BY timestamp ASC',
    [sessionId],
  );

  res.json({
    events: events.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      action: e.action,
      path: e.path,
      detail: e.detail_json ? (JSON.parse(e.detail_json) as Record<string, unknown>) : null,
    })),
  });
});

export default router;
