import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '../services/jwt.js';
import { checkAndTouchSession } from '../services/loginSession.js';
import { roleHasPermission, type PermissionKey } from '../services/permissions.js';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload & { tokenHash?: string };
    }
  }
}

export function authRequired(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const bearerToken = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const cookieToken = req.cookies?.['alterm_token'] as string | undefined;
  const token = bearerToken ?? cookieToken ?? null;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const payload = verifyToken(token);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const isHeartbeat = req.query['heartbeat'] === '1';
    const sessionStatus = checkAndTouchSession(tokenHash, isHeartbeat);
    if (sessionStatus === 'revoked') {
      res.status(401).json({ error: 'Session has been revoked' });
      return;
    }
    if (sessionStatus === 'idle_expired') {
      res.status(401).json({ error: 'Session expired due to inactivity' });
      return;
    }

    req.user = { ...payload, tokenHash };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function adminRequired(req: Request, res: Response, next: NextFunction): void {
  authRequired(req, res, () => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  });
}

/**
 * Middleware factory: require that the authenticated user's role includes
 * the given permission key(s). Accepts a single key or an array (any match → pass).
 */
export function requirePermission(...perms: PermissionKey[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    authRequired(req, res, () => {
      const role = req.user?.role;
      if (!role) { res.status(403).json({ error: 'Forbidden' }); return; }
      const has = perms.some(p => roleHasPermission(role, p));
      if (!has) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }
      next();
    });
  };
}

/**
 * Inline permission check — useful inside handlers where middleware isn't enough.
 * Returns true if the user's role has the permission.
 */
export function userCan(req: Request, perm: PermissionKey): boolean {
  return !!req.user && roleHasPermission(req.user.role, perm);
}
