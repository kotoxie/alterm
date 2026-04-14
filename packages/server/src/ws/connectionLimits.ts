/**
 * Per-user and global connection limit enforcement (H2 security fix).
 * Each WS proxy calls acquire() before opening a new session and release() on teardown.
 */

const perUser = new Map<string, number>();
let globalCount = 0;

const MAX_PER_USER = 10;
const MAX_GLOBAL = 500;

export function acquireConnection(userId: string): { allowed: boolean; reason?: string } {
  if (globalCount >= MAX_GLOBAL) {
    return { allowed: false, reason: 'Server connection limit reached. Please try again later.' };
  }
  const userCount = perUser.get(userId) ?? 0;
  if (userCount >= MAX_PER_USER) {
    return { allowed: false, reason: `Maximum ${MAX_PER_USER} concurrent connections per user.` };
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
