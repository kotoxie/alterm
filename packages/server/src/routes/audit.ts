import { Router, type Request, type Response } from 'express';
import { queryAll, queryOne } from '../db/helpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();
router.use(authRequired);

interface AuditRow {
  id: string;
  user_id: string | null;
  event_type: string;
  target: string | null;
  details_json: string | null;
  ip_address: string | null;
  timestamp: string;
  username: string | null;
  display_name: string | null;
}

// GET / — paginated audit log with filters
router.get('/', (req: Request, res: Response) => {
  const isAdmin = req.user!.role === 'admin';
  const currentUserId = req.user!.userId;

  const search = typeof req.query.search === 'string' ? req.query.search : '';
  const eventType = typeof req.query.eventType === 'string' ? req.query.eventType : '';
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  const page = Math.max(1, parseInt(typeof req.query.page === 'string' ? req.query.page : '1', 10) || 1);
  const rawLimit = parseInt(typeof req.query.limit === 'string' ? req.query.limit : '50', 10) || 50;
  const limit = Math.min(200, Math.max(1, rawLimit));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];

  // Non-admins only see their own logs
  if (!isAdmin) {
    conditions.push('a.user_id = ?');
    params.push(currentUserId);
  } else if (userId) {
    conditions.push('a.user_id = ?');
    params.push(userId);
  }

  if (eventType) {
    conditions.push('a.event_type = ?');
    params.push(eventType);
  }

  if (from) {
    conditions.push('a.timestamp >= ?');
    params.push(from);
  }

  if (to) {
    conditions.push('a.timestamp <= ?');
    params.push(to);
  }

  if (search) {
    conditions.push(
      '(a.event_type LIKE ? OR a.target LIKE ? OR a.details_json LIKE ? OR u.username LIKE ?)',
    );
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = queryOne<{ total: number }>(
    `SELECT COUNT(*) as total FROM audit_log a
     LEFT JOIN users u ON a.user_id = u.id
     ${where}`,
    params,
  );

  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const rows = queryAll<AuditRow>(
    `SELECT a.id, a.user_id, a.event_type, a.target, a.details_json, a.ip_address, a.timestamp,
            u.username, u.display_name
     FROM audit_log a
     LEFT JOIN users u ON a.user_id = u.id
     ${where}
     ORDER BY a.timestamp DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  res.json({
    entries: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      eventType: r.event_type,
      target: r.target,
      details: r.details_json ? (() => { try { return JSON.parse(r.details_json!); } catch { return r.details_json; } })() : null,
      ipAddress: r.ip_address,
      timestamp: r.timestamp,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  });
});

// GET /event-types — distinct event types
router.get('/event-types', (_req: Request, res: Response) => {
  const rows = queryAll<{ event_type: string }>(
    'SELECT DISTINCT event_type FROM audit_log ORDER BY event_type ASC',
  );
  res.json({ eventTypes: rows.map((r) => r.event_type) });
});

// GET /users — admin only, distinct users with audit entries
router.get('/users', (req: Request, res: Response) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  const rows = queryAll<{ user_id: string | null; username: string | null; display_name: string | null }>(
    `SELECT DISTINCT a.user_id, u.username, u.display_name
     FROM audit_log a
     LEFT JOIN users u ON a.user_id = u.id
     WHERE a.user_id IS NOT NULL
     ORDER BY u.username ASC`,
  );

  res.json({
    users: rows.map((r) => ({
      id: r.user_id,
      username: r.username,
      displayName: r.display_name,
    })),
  });
});

export default router;
