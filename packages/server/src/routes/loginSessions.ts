import { Router, type Request, type Response } from 'express';
import { authRequired } from '../middleware/auth.js';
import { queryAll, execute } from '../db/helpers.js';

const router = Router();
router.use(authRequired);

interface SessionRow {
  id: string;
  browser: string | null;
  os: string | null;
  ip_address: string | null;
  created_at: string;
  last_used_at: string;
  token_hash: string;
}

// GET /api/v1/profile/login-sessions
router.get('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const currentHash = req.user!.tokenHash ?? '';

  const rows = queryAll<SessionRow>(
    `SELECT id, browser, os, ip_address, created_at, last_used_at, token_hash
     FROM login_sessions
     WHERE user_id = ? AND revoked = 0
     ORDER BY last_used_at DESC`,
    [userId],
  );

  const sessions = rows.map((r) => ({
    id: r.id,
    browser: r.browser ?? 'Unknown',
    os: r.os ?? 'Unknown',
    ipAddress: r.ip_address ?? 'Unknown',
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    isCurrent: r.token_hash === currentHash,
  }));

  res.json({ sessions });
});

// DELETE /api/v1/profile/login-sessions/:id  — revoke a specific session
router.delete('/:id', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;

  execute(
    `UPDATE login_sessions SET revoked = 1 WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  res.json({ ok: true });
});

// DELETE /api/v1/profile/login-sessions  — revoke all OTHER sessions
router.delete('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const currentHash = req.user!.tokenHash ?? '';

  execute(
    `UPDATE login_sessions SET revoked = 1 WHERE user_id = ? AND token_hash != ? AND revoked = 0`,
    [userId, currentHash],
  );
  res.json({ ok: true });
});

export default router;
