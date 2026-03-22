/**
 * Registry of active WebSocket connections keyed by token hash.
 * Used to forcibly close open sessions when a login session is revoked.
 */
import type WebSocket from 'ws';

const registry = new Map<string, Set<WebSocket>>();

export function registerWs(tokenHash: string, ws: WebSocket): void {
  if (!registry.has(tokenHash)) registry.set(tokenHash, new Set());
  registry.get(tokenHash)!.add(ws);
}

export function unregisterWs(tokenHash: string, ws: WebSocket): void {
  const set = registry.get(tokenHash);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) registry.delete(tokenHash);
}

/** Close all open WebSocket connections for a given token hash (4001 = session revoked). */
export function closeSessionConnections(tokenHash: string): void {
  const set = registry.get(tokenHash);
  if (!set) return;
  for (const ws of set) {
    try { ws.close(4001, 'Session revoked'); } catch { /* ignore */ }
  }
  registry.delete(tokenHash);
}
