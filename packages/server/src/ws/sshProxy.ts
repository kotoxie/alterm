import type { IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type https from 'https';
import { Client as SshClient } from 'ssh2';
import { verifyToken } from '../services/jwt.js';
import { queryOne, execute } from '../db/helpers.js';
import { decrypt } from '../services/encryption.js';
import { logAudit } from '../services/audit.js';
import { v4 as uuid } from 'uuid';

interface ConnectionRow {
  id: string; host: string; port: number; protocol: string;
  username: string | null; encrypted_password: string | null;
  private_key: string | null; name: string;
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
    const token = url.searchParams.get('token');
    const connectionId = url.searchParams.get('connectionId');
    const clientIp = req.socket.remoteAddress || 'unknown';

    if (!token || !connectionId) { ws.close(4001, 'Missing params'); return; }

    let userId: string;
    try { userId = verifyToken(token).userId; }
    catch { ws.close(4001, 'Invalid token'); return; }

    const conn = queryOne<ConnectionRow>(
      'SELECT * FROM connections WHERE id = ? AND user_id = ?',
      [connectionId, userId],
    );
    if (!conn || conn.protocol !== 'ssh') { ws.close(4002, 'Not found or not SSH'); return; }

    const sessionId = uuid();
    execute('INSERT INTO sessions (id, user_id, connection_id, protocol) VALUES (?, ?, ?, ?)',
      [sessionId, userId, connectionId, 'ssh']);
    logAudit({ userId, eventType: 'session.ssh.connect',
      target: `${conn.host}:${conn.port}`,
      details: { connectionId, sessionId, connectionName: conn.name }, ipAddress: clientIp });

    const ssh = new SshClient();
    let cols = 80, rows = 24;

    ssh.on('ready', () => {
      ws.send(JSON.stringify({ type: 'status', message: 'Connected' }));
      ssh.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'error', message: err.message }));
          ws.close(4003, 'Shell error'); return;
        }
        stream.on('data', (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        });
        stream.stderr.on('data', (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        });
        stream.on('close', () => {
          if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Shell closed');
          ssh.end();
        });
        ws.on('message', (msg: Buffer | string) => {
          try {
            const json = JSON.parse(typeof msg === 'string' ? msg : msg.toString('utf8'));
            if (json.type === 'resize') {
              cols = json.cols; rows = json.rows;
              stream.setWindow(rows, cols, 0, 0);
            } else if (json.type === 'data') {
              stream.write(json.data);
            }
          } catch {
            stream.write(msg as Buffer);
          }
        });
      });
    });

    ssh.on('error', (err: Error) => {
      console.error('[ssh] error:', err.message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
        ws.close(4003, err.message);
      }
    });

    const password = conn.encrypted_password ? (() => { try { return decrypt(conn.encrypted_password!); } catch { return undefined; } })() : undefined;
    const privateKey = conn.private_key ? (() => { try { return decrypt(conn.private_key!); } catch { return undefined; } })() : undefined;

    ssh.connect({
      host: conn.host, port: conn.port,
      username: conn.username || '',
      ...(privateKey ? { privateKey } : { password }),
      readyTimeout: 15000,
      hostVerifier: () => true,
    });

    ws.on('close', () => {
      ssh.end();
      execute("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?", [sessionId]);
      logAudit({ userId, eventType: 'session.ssh.disconnect',
        target: `${conn.host}:${conn.port}`,
        details: { connectionId, sessionId }, ipAddress: clientIp });
    });
    ws.on('error', () => ssh.end());
  });
}
