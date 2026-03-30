import type { IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type https from 'https';
import { Client as SshClient, type ClientChannel } from 'ssh2';
import net from 'net';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { hashToken, isSessionRevoked } from '../services/loginSession.js';
import { registerWs, unregisterWs } from './wsRegistry.js';
import { queryOne, execute } from '../db/helpers.js';
import { redeemWsTicket } from '../services/wsTicket.js';
import { userHasPermission, wsCanAccess } from '../services/permissions.js';
import { decrypt, encryptRecordingStream } from '../services/encryption.js';
import { logAudit } from '../services/audit.js';
import { resolveClientIp } from '../services/ip.js';
import { config } from '../config.js';
import { getSetting } from '../services/settings.js';
import { v4 as uuid } from 'uuid';
import {
  storeSession,
  getSession,
  removeSession,
  appendToBuffer,
  startGrace,
  clearGrace,
  type SshCachedSession,
} from './sshSessionCache.js';
import { CommandTracker } from './commandTracker.js';

interface ConnectionRow {
  id: string; host: string; port: number; protocol: string;
  username: string | null; encrypted_password: string | null;
  private_key: string | null; name: string;
  recording_enabled: number;
  tunnels_json: string | null;
  host_fingerprint: string | null;
}

interface TunnelConfig { localPort: number; remoteHost: string; remotePort: number; }
interface TunnelStatus extends TunnelConfig { status: 'listening' | 'failed'; error?: string; }

function teardownSession(
  clientSessionId: string,
  session: SshCachedSession,
  userId: string,
  host: string,
  port: number,
  connectionId: string,
  sessionDbId: string,
  clientIp: string,
): void {
  if (session.castFile) { try { session.castFile.end(); } catch { /**/ } session.castFile = null; }
  if (session.cmdTracker) { try { session.cmdTracker.flush(); } catch { /**/ } session.cmdTracker = null; }
  session.tunnelServers.forEach((s) => { try { s.close(); } catch { /**/ } });
  try { session.ssh.end(); } catch { /**/ }
  execute("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?", [sessionDbId]);
  logAudit({
    userId, eventType: 'session.ssh.disconnect',
    target: `${host}:${port}`,
    details: { connectionId, sessionId: sessionDbId }, ipAddress: clientIp,
  });
  removeSession(clientSessionId);
}

function wireClientWs(
  clientSessionId: string,
  ws: WebSocket,
  userId: string,
  host: string,
  port: number,
  connectionId: string,
  sessionDbId: string,
  clientIp: string,
): void {
  ws.on('message', (msg: Buffer | string) => {
    const s = getSession(clientSessionId);
    if (!s) return;
    try {
      const json = JSON.parse(typeof msg === 'string' ? msg : msg.toString('utf8'));
      if (json.type === 'resize') {
        s.cols = json.cols; s.rows = json.rows;
        s.shellStream.setWindow(s.rows, s.cols, 0, 0);
      } else if (json.type === 'data') {
        s.shellStream.write(json.data);
        if (s.cmdTracker) s.cmdTracker.feedInput(json.data);
      }
    } catch {
      const s2 = getSession(clientSessionId);
      if (s2) s2.shellStream.write(msg as Buffer);
    }
  });
  ws.on('close', () => {
    const s = getSession(clientSessionId);
    if (s) {
      s.ws = null;
      startGrace(clientSessionId, () =>
        teardownSession(clientSessionId, s, userId, host, port, connectionId, sessionDbId, clientIp));
    }
  });
  ws.on('error', () => { const s = getSession(clientSessionId); if (s) s.ws = null; });
}

export function setupSshProxy(server: https.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || '', `https://${req.headers.host}`);
    if (url.pathname === '/ws/ssh') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    }
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '', `https://${req.headers.host}`);
    const ticketId = url.searchParams.get('ticket');
    const connectionId = url.searchParams.get('connectionId');
    const clientSessionId = url.searchParams.get('sessionId') || uuid();
    const clientIp = resolveClientIp(req);

    if (!ticketId || !connectionId) { ws.close(4001, 'Missing params'); return; }

    const ticketData = redeemWsTicket(ticketId);
    if (!ticketData) { ws.close(4001, 'Invalid or expired ticket'); return; }
    const { userId, tokenHash } = ticketData;

    if (isSessionRevoked(tokenHash)) { ws.close(4001, 'Session revoked'); return; }

    // Protocol permission check
    if (!userHasPermission(userId, 'protocols.ssh')) { ws.close(4003, 'Protocol not permitted'); return; }

    registerWs(tokenHash, ws);
    ws.once('close', () => unregisterWs(tokenHash, ws));

    // ── Reattach path ────────────────────────────────────────────────────────
    const cached = getSession(clientSessionId);
    if (cached && cached.userId === userId && cached.connectionId === connectionId) {
      clearGrace(clientSessionId);
      cached.ws = ws;
      ws.send(JSON.stringify({ type: 'status', message: 'Reattached' }));
      // Replay buffered output so the terminal catches up
      for (const chunk of cached.outputBuffer) {
        if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
      }
      wireClientWs(clientSessionId, ws, userId, '', 0, connectionId, cached.sessionDbId, clientIp);
      return;
    }

    // ── New session path ─────────────────────────────────────────────────────
    const access = wsCanAccess(userId);
    const conn = queryOne<ConnectionRow>(
      `SELECT * FROM connections WHERE id = ? AND ${access.where}`,
      [connectionId, ...access.params],
    );
    if (!conn || conn.protocol !== 'ssh') { ws.close(4002, 'Not found or not SSH'); return; }

    const sessionDbId = uuid();
    const globalRecording = getSetting('session.recording_enabled') === 'true';
    const doRecord = globalRecording && conn.recording_enabled === 1;

    // Only track in sessions table when a recording will be made
    if (doRecord) {
      execute('INSERT INTO sessions (id, user_id, connection_id, protocol) VALUES (?, ?, ?, ?)',
        [sessionDbId, userId, connectionId, 'ssh']);
    }
    logAudit({
      userId, eventType: 'session.ssh.connect',
      target: `${conn.host}:${conn.port}`,
      details: { connectionId, sessionId: sessionDbId, connectionName: conn.name }, ipAddress: clientIp,
    });
    let castFile: import('stream').Writable | null = null;
    let castStart = 0;

    const ssh = new SshClient();
    // Start with sane defaults. The client sends a resize message immediately on
    // ws.open, but wireClientWs isn't attached yet at that point — so we capture
    // it here with a temporary listener and update cols/rows before the shell opens.
    let cols = 80, rows = 24;
    ws.once('message', (msg: Buffer | string) => {
      try {
        const json = JSON.parse(typeof msg === 'string' ? msg : msg.toString('utf8'));
        if (json.type === 'resize' && json.cols > 0 && json.rows > 0) {
          cols = json.cols;
          rows = json.rows;
        }
      } catch { /* not a resize — ignore */ }
    });

    ssh.on('banner', (message: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(message));
    });

    ssh.on('ready', () => {
      ws.send(JSON.stringify({ type: 'status', message: 'Connected' }));

      if (doRecord) {
        const recordingsDir = path.join(config.dataDir, 'recordings');
        fs.mkdirSync(recordingsDir, { recursive: true });
        const castPath = path.join(recordingsDir, `${sessionDbId}.cast`);
        castStart = Date.now();
        const fileStream = fs.createWriteStream(castPath);
        const cipherStream = encryptRecordingStream();
        cipherStream.pipe(fileStream);
        castFile = cipherStream;
        const header = JSON.stringify({ version: 2, width: cols, height: rows, timestamp: Math.floor(castStart / 1000), title: conn.name });
        castFile.write(header + '\n');
        execute("UPDATE sessions SET recording_path = ? WHERE id = ?", [castPath, sessionDbId]);
      }

      const tunnelServers: net.Server[] = [];
      let tunnelConfigs: TunnelConfig[] = [];
      try {
        if (conn.tunnels_json) tunnelConfigs = JSON.parse(conn.tunnels_json) as TunnelConfig[];
      } catch { /* ignore */ }

      if (tunnelConfigs.length > 0) {
        // Set up each tunnel and collect status asynchronously, then notify the client once all are ready.
        const tunnelStatuses: TunnelStatus[] = [];
        let pending = 0;

        for (const tunnel of tunnelConfigs) {
          if (!tunnel.localPort || !tunnel.remoteHost || !tunnel.remotePort) continue;
          pending++;
          const statusEntry: TunnelStatus = { ...tunnel, status: 'listening' };
          tunnelStatuses.push(statusEntry);

          const srv = net.createServer((localSocket) => {
            const s = getSession(clientSessionId);
            if (!s) { localSocket.destroy(); return; }
            s.ssh.forwardOut('127.0.0.1', tunnel.localPort, tunnel.remoteHost, tunnel.remotePort, (err, stream) => {
              if (err) { localSocket.destroy(); return; }
              localSocket.pipe(stream); stream.pipe(localSocket);
              localSocket.on('close', () => stream.destroy());
              stream.on('close', () => localSocket.destroy());
              stream.on('error', () => localSocket.destroy());
              localSocket.on('error', () => stream.destroy());
            });
          });

          srv.once('listening', () => {
            statusEntry.status = 'listening';
            pending--;
            if (pending === 0 && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'tunnels', tunnels: tunnelStatuses }));
            }
          });

          srv.once('error', (err: NodeJS.ErrnoException) => {
            statusEntry.status = 'failed';
            statusEntry.error = err.code === 'EADDRINUSE'
              ? `Port ${tunnel.localPort} already in use`
              : (err.message ?? 'Unknown error');
            pending--;
            if (pending === 0 && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'tunnels', tunnels: tunnelStatuses }));
            }
          });

          srv.listen(tunnel.localPort, '127.0.0.1');
          tunnelServers.push(srv);
        }
      }

      ssh.shell({ term: 'xterm-256color', cols, rows }, (err, shellStream: ClientChannel) => {
        if (err) {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'error', message: err.message }));
          ws.close(4003, 'Shell error'); return;
        }

        const session: SshCachedSession = {
          ssh, shellStream, tunnelServers,
          outputBuffer: [], outputBufferBytes: 0,
          ws, timer: null,
          userId, sessionDbId, connectionId,
          cols, rows,
          castFile, castStart,
          cmdTracker: doRecord ? new CommandTracker(sessionDbId, castStart) : null,
        };
        storeSession(clientSessionId, session);
        shellStream.setWindow(rows, cols, 0, 0);

        shellStream.on('data', (data: Buffer) => {
          const s = getSession(clientSessionId);
          if (!s) return;
          appendToBuffer(s, data);
          if (s.ws?.readyState === WebSocket.OPEN) s.ws.send(data);
          const text = data.toString('utf8');
          if (s.cmdTracker) s.cmdTracker.feedOutput(text);
          if (s.castFile) {
            const elapsed = (Date.now() - s.castStart) / 1000;
            s.castFile.write(JSON.stringify([elapsed, 'o', text]) + '\n');
          }
        });
        shellStream.stderr.on('data', (data: Buffer) => {
          const s = getSession(clientSessionId);
          if (s?.ws?.readyState === WebSocket.OPEN) s.ws.send(data);
        });
        shellStream.on('close', () => {
          const s = getSession(clientSessionId);
          if (s?.ws?.readyState === WebSocket.OPEN) s.ws.close(1000, 'Shell closed');
          teardownSession(clientSessionId, session, userId, conn.host, conn.port, connectionId, sessionDbId, clientIp);
        });

        wireClientWs(clientSessionId, ws, userId, conn.host, conn.port, connectionId, sessionDbId, clientIp);
      });
    });

    ssh.on('error', (err: Error) => {
      console.error('[ssh] error:', err.message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
        ws.close(4003, err.message);
      }
    });

    const password = conn.encrypted_password
      ? (() => { try { return decrypt(conn.encrypted_password!); } catch { return undefined; } })()
      : undefined;
    const privateKey = conn.private_key
      ? (() => { try { return decrypt(conn.private_key!); } catch { return undefined; } })()
      : undefined;

    ssh.connect({
      host: conn.host, port: conn.port,
      username: conn.username || '',
      ...(privateKey ? { privateKey } : { password }),
      readyTimeout: 15000,
      hostVerifier: (key: Buffer) => {
        const fingerprint = crypto.createHash('sha256').update(key).digest('hex');
        if (conn.host_fingerprint) {
          // Verify stored fingerprint matches (prevent MITM after first connect)
          return conn.host_fingerprint === fingerprint;
        }
        // Trust On First Use: store fingerprint for future verification
        execute('UPDATE connections SET host_fingerprint = ? WHERE id = ?', [fingerprint, conn.id]);
        return true;
      },
    });
  });
}
