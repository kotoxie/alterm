import type { IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type https from 'https';
import { Client as SshClient, type ClientChannel } from 'ssh2';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { verifyToken } from '../services/jwt.js';
import { queryOne, execute } from '../db/helpers.js';
import { decrypt } from '../services/encryption.js';
import { logAudit } from '../services/audit.js';
import { config } from '../config.js';
import { getSetting } from '../services/settings.js';
import { v4 as uuid } from 'uuid';

interface ConnectionRow {
  id: string; host: string; port: number; protocol: string;
  username: string | null; encrypted_password: string | null;
  private_key: string | null; name: string;
  recording_enabled: number;
  tunnels_json: string | null;
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

    const globalRecording = getSetting('session.recording_enabled') === 'true';
    const doRecord = globalRecording && conn.recording_enabled === 1;
    let castFile: fs.WriteStream | null = null;
    let castStart = 0;

    const ssh = new SshClient();
    let cols = 80, rows = 24;
    let shellStream: ClientChannel | null = null;

    ssh.on('banner', (message: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(message));
    });

    ssh.on('ready', () => {
      ws.send(JSON.stringify({ type: 'status', message: 'Connected' }));

      if (doRecord) {
        const recordingsDir = path.join(config.dataDir, 'recordings');
        fs.mkdirSync(recordingsDir, { recursive: true });
        const castPath = path.join(recordingsDir, `${sessionId}.cast`);
        castStart = Date.now();
        castFile = fs.createWriteStream(castPath, { encoding: 'utf8' });
        const header = JSON.stringify({ version: 2, width: cols, height: rows, timestamp: Math.floor(castStart / 1000), title: conn.name });
        castFile.write(header + '\n');
        execute("UPDATE sessions SET recording_path = ? WHERE id = ?", [castPath, sessionId]);
      }

      // Register message handler BEFORE shell opens so resize messages sent
      // immediately after 'Connected' are not lost.
      ws.on('message', (msg: Buffer | string) => {
        try {
          const json = JSON.parse(typeof msg === 'string' ? msg : msg.toString('utf8'));
          if (json.type === 'resize') {
            cols = json.cols; rows = json.rows;
            if (shellStream) shellStream.setWindow(rows, cols, 0, 0);
          } else if (json.type === 'data') {
            if (shellStream) shellStream.write(json.data);
          }
        } catch {
          if (shellStream) shellStream.write(msg as Buffer);
        }
      });

      // Set up SSH tunnels (local port forwards)
      const tunnelServers: net.Server[] = [];
      interface TunnelConfig { localPort: number; remoteHost: string; remotePort: number; }
      let tunnelConfigs: TunnelConfig[] = [];
      try {
        if (conn.tunnels_json) tunnelConfigs = JSON.parse(conn.tunnels_json) as TunnelConfig[];
      } catch { /* ignore */ }

      for (const tunnel of tunnelConfigs) {
        if (!tunnel.localPort || !tunnel.remoteHost || !tunnel.remotePort) continue;
        const server = net.createServer((localSocket) => {
          ssh.forwardOut('127.0.0.1', tunnel.localPort, tunnel.remoteHost, tunnel.remotePort, (err, stream) => {
            if (err) { localSocket.destroy(); return; }
            localSocket.pipe(stream);
            stream.pipe(localSocket);
            localSocket.on('close', () => stream.destroy());
            stream.on('close', () => localSocket.destroy());
            stream.on('error', () => localSocket.destroy());
            localSocket.on('error', () => stream.destroy());
          });
        });
        server.listen(tunnel.localPort, '0.0.0.0', () => {
          // Tunnel active
        });
        server.on('error', () => { /* port in use — ignore */ });
        tunnelServers.push(server);
      }

      if (tunnelConfigs.length > 0) {
        ws.send(JSON.stringify({ type: 'tunnels', tunnels: tunnelConfigs }));
      }

      ssh.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'error', message: err.message }));
          ws.close(4003, 'Shell error'); return;
        }
        shellStream = stream;
        // Apply any resize that arrived between 'Connected' and shell open
        stream.setWindow(rows, cols, 0, 0);

        stream.on('data', (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
          if (castFile) {
            const elapsed = (Date.now() - castStart) / 1000;
            castFile.write(JSON.stringify([elapsed, 'o', data.toString('utf8')]) + '\n');
          }
        });
        stream.stderr.on('data', (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        });
        stream.on('close', () => {
          if (castFile) { castFile.end(); castFile = null; }
          if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Shell closed');
          ssh.end();
          tunnelServers.forEach((s) => s.close());
        });
      });

      ws.on('close', () => {
        if (castFile) { castFile.end(); castFile = null; }
        tunnelServers.forEach((s) => s.close());
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
