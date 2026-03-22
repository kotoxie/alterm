import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '../services/jwt.js';
import { isSessionRevoked, touchSession } from '../services/loginSession.js';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload & { tokenHash?: string };
    }
  }
}

export function authRequired(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const payload = verifyToken(token);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    if (isSessionRevoked(tokenHash)) {
      res.status(401).json({ error: 'Session has been revoked' });
      return;
    }

    touchSession(tokenHash);
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
