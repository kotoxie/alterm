import net from 'net';
import type { Server } from 'https';
import { WebSocketServer } from 'ws';
import { queryOne, execute } from '../db/helpers.js';
import { verifyToken } from '../services/jwt.js';
import { hashToken, isSessionRevoked } from '../services/loginSession.js';
import { registerWs, unregisterWs } from './wsRegistry.js';
import { logAudit } from '../services/audit.js';
import { resolveClientIp } from '../services/ip.js';
import { v4 as uuid } from 'uuid';

export function setupVncProxy(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    if (!url.startsWith('/ws/vnc/')) return;

    // URL format: /ws/vnc/{connectionId}?token={jwt}
    const [pathname, qs] = url.split('?');
    const connectionId = pathname.slice('/ws/vnc/'.length);
    const token = new URLSearchParams(qs).get('token');

    if (!token) { socket.destroy(); return; }

    let userId: string;
    try {
      const payload = verifyToken(token);
      userId = payload.userId;
    } catch {
      socket.destroy();
      return;
    }

    const vncTokenHash = hashToken(token);
    if (isSessionRevoked(vncTokenHash)) { socket.destroy(); return; }

    const conn = queryOne<{ host: string; port: number; user_id: string; shared: number }>(
      `SELECT host, port, user_id, shared FROM connections WHERE id = ? AND (user_id = ? OR shared = 1) AND protocol = 'vnc'`,
      [connectionId, userId],
    );
    if (!conn) { socket.destroy(); return; }

    const connHost = conn.host;
    const connPort = conn.port;
    const clientIp = resolveClientIp(req);

    wss.handleUpgrade(req, socket as Parameters<typeof wss.handleUpgrade>[1], head, (ws) => {
      registerWs(vncTokenHash, ws);

      const sessionDbId = uuid();
      execute(
        `INSERT INTO sessions (id, user_id, connection_id, protocol, started_at) VALUES (?, ?, ?, 'vnc', datetime('now'))`,
        [sessionDbId, userId, connectionId],
      );
      logAudit({
        userId,
        eventType: 'session.vnc.connect',
        target: `${connHost}:${connPort || 5900}`,
        details: { connectionId, sessionId: sessionDbId },
        ipAddress: clientIp,
      });

      function teardown() {
        execute(`UPDATE sessions SET ended_at = datetime('now') WHERE id = ?`, [sessionDbId]);
        logAudit({
          userId,
          eventType: 'session.vnc.disconnect',
          target: `${connHost}:${connPort || 5900}`,
          details: { connectionId, sessionId: sessionDbId },
          ipAddress: clientIp,
        });
        unregisterWs(vncTokenHash, ws);
      }

      ws.once('close', teardown);
      const tcp = net.connect(connPort || 5900, connHost);

      tcp.on('connect', () => {
        ws.on('message', (data) => { tcp.write(data as Buffer); });
        tcp.on('data', (data) => { if (ws.readyState === 1) ws.send(data); });
        ws.on('close', () => tcp.destroy());
        tcp.on('close', () => ws.close());
        tcp.on('error', () => ws.close());
        ws.on('error', () => tcp.destroy());
      });

      tcp.on('error', (err) => {
        ws.close(1011, err.message);
      });
    });
  });
}
