/**
 * Per-user and global connection limit enforcement (H2 security fix).
 * Each WS proxy calls acquire() before opening a new session and release() on teardown.
 */
import { getSetting } from '../services/settings.js';

const perUser = new Map<string, number>();
let globalCount = 0;

const DEFAULT_MAX_PER_USER = 10;
const MAX_GLOBAL = 500;

function getMaxPerUser(): number {
  const v = parseInt(getSetting('security.max_connections_per_user'), 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_PER_USER;
}

export function acquireConnection(userId: string): { allowed: boolean; reason?: string } {
  if (globalCount >= MAX_GLOBAL) {
    return { allowed: false, reason: 'Server connection limit reached. Please try again later.' };
  }
  const maxPerUser = getMaxPerUser();
  const userCount = perUser.get(userId) ?? 0;
  if (userCount >= maxPerUser) {
    return { allowed: false, reason: `Maximum ${maxPerUser} concurrent connections per user.` };
  }
  perUser.set(userId, userCount + 1);
  globalCount++;
  return { allowed: true };
}

export function releaseConnection(userId: string): void {
  const userCount = perUser.get(userId) ?? 0;
  if (userCount <= 1) {
    perUser.delete(userId);
  } else {
    perUser.set(userId, userCount - 1);
  }
  globalCount = Math.max(0, globalCount - 1);
}
