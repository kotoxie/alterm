/**
 * SSH session cache — keeps ssh2 connections alive across client WebSocket
 * reconnects (e.g. browser refresh) for up to GRACE_MS milliseconds.
 */
import type { WebSocket } from 'ws';
import type { Client as SshClient, ClientChannel } from 'ssh2';
import type net from 'net';
import type { Writable } from 'stream';
import type { CommandTracker } from './commandTracker.js';

const MAX_BUFFER_BYTES = 512 * 1024; // 512 KB of terminal output kept for replay
const GRACE_MS = 120_000; // 2 minutes before tearing down an orphaned session

export interface SshCachedSession {
  ssh: SshClient;
  shellStream: ClientChannel;
  tunnelServers: net.Server[];
  outputBuffer: Buffer[];
  outputBufferBytes: number;
  ws: WebSocket | null;
  timer: NodeJS.Timeout | null;
  userId: string;
  tokenHash: string; // H4: bind session to the token that created it
  sessionDbId: string;
  connectionId: string;
  cols: number;
  rows: number;
  castFile: Writable | null;
  castStart: number;
  cmdTracker: CommandTracker | null;
}

const cache = new Map<string, SshCachedSession>();

export function storeSession(clientSessionId: string, session: SshCachedSession): void {
  cache.set(clientSessionId, session);
}

export function getSession(clientSessionId: string): SshCachedSession | undefined {
  return cache.get(clientSessionId);
}

export function removeSession(clientSessionId: string): void {
  cache.delete(clientSessionId);
}

export function appendToBuffer(session: SshCachedSession, data: Buffer): void {
  session.outputBuffer.push(data);
  session.outputBufferBytes += data.length;
  // Trim oldest chunks when buffer exceeds max
  while (session.outputBufferBytes > MAX_BUFFER_BYTES && session.outputBuffer.length > 0) {
    const removed = session.outputBuffer.shift()!;
    session.outputBufferBytes -= removed.length;
  }
}

/** Start grace-period timer; calls cleanupFn and removes from cache when it fires. */
export function startGrace(clientSessionId: string, cleanupFn: () => void): void {
  const session = cache.get(clientSessionId);
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    try { cleanupFn(); } catch { /**/ }
    cache.delete(clientSessionId);
  }, GRACE_MS);
}

/** Cancel an active grace-period timer (client reconnected). */
export function clearGrace(clientSessionId: string): void {
  const session = cache.get(clientSessionId);
  if (!session?.timer) return;
  clearTimeout(session.timer);
  session.timer = null;
}
