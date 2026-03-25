import net from 'net';
import tls from 'tls';
import type { IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type https from 'https';
import { isSessionRevoked } from '../services/loginSession.js';
import { registerWs, unregisterWs } from './wsRegistry.js';
import { redeemWsTicket } from '../services/wsTicket.js';
import { queryOne } from '../db/helpers.js';
import { decrypt } from '../services/encryption.js';
import { logAudit } from '../services/audit.js';
import { resolveClientIp } from '../services/ip.js';
import { v4 as uuid } from 'uuid';

interface ConnectionRow {
  id: string;
  host: string;
  port: number;
  protocol: string;
  username: string | null;
  encrypted_password: string | null;
  name: string;
}

export function setupRdpProxy(server: https.Server): void {
  const wss = new WebSocketServer({ noServer: true });
  const wssRaw = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || '', `https://${req.headers.host}`);

    if (url.pathname === '/ws/rdp') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else if (url.pathname === '/ws/rdp-raw') {
      wssRaw.handleUpgrade(req, socket, head, (ws) => {
        wssRaw.emit('connection', ws, req);
      });
    }
  });

  // ── DER helpers ──────────────────────────────────────────────────────────────
  function derLen(n: number): Buffer {
    if (n < 0x80) return Buffer.from([n]);
    if (n < 0x100) return Buffer.from([0x81, n]);
    return Buffer.from([0x82, (n >> 8) & 0xff, n & 0xff]);
  }
  function derTlv(tag: number, content: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
  }
  function derInt(value: number): Buffer {
    let hex = value.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    let b = Buffer.from(hex, 'hex');
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0x00]), b]);
    return derTlv(0x02, b);
  }
  function derUtf8(str: string): Buffer { return derTlv(0x0c, Buffer.from(str, 'utf8')); }
  function derOctet(b: Buffer): Buffer { return derTlv(0x04, b); }
  function derSeq(b: Buffer): Buffer { return derTlv(0x30, b); }
  function derCtx(n: number, b: Buffer): Buffer { return derTlv(0xa0 | n, b); }

  function readDerLen(buf: Buffer, off: number): { value: number; bytesRead: number } {
    const first = buf[off];
    if (first < 0x80) return { value: first, bytesRead: 1 };
    const nb = first & 0x7f;
    let v = 0;
    for (let i = 0; i < nb; i++) v = (v << 8) | buf[off + 1 + i];
    return { value: v, bytesRead: 1 + nb };
  }

  /** Extract the X.224 CR OCTET STRING from an RDCleanPath request DER PDU (field [6]). */
  function extractX224CR(pdu: Buffer): Buffer {
    let off = 0;
    if (pdu[off++] !== 0x30) throw new Error('Expected SEQUENCE');
    const outer = readDerLen(pdu, off);
    off += outer.bytesRead;
    const end = off + outer.value;
    while (off < end) {
      const tag = pdu[off++];
      const fl = readDerLen(pdu, off);
      off += fl.bytesRead;
      const fc = pdu.slice(off, off + fl.value);
      off += fl.value;
      if (tag === 0xa6) {
        let i = 0;
        if (fc[i++] !== 0x04) throw new Error('Expected OCTET STRING in [6]');
        const il = readDerLen(fc, i);
        i += il.bytesRead;
        return fc.slice(i, i + il.value);
      }
    }
    throw new Error('Field [6] (x224_connection_pdu) not found');
  }

  function encodeRDCleanPathResponse(x224cc: Buffer, serverAddr: string, certDers: Buffer[]): Buffer {
    const certContent = certDers.length > 0
      ? Buffer.concat(certDers.map(c => derOctet(c)))
      : Buffer.alloc(0);
    return derSeq(Buffer.concat([
      derCtx(0, derInt(3390)),
      derCtx(6, derOctet(x224cc)),
      derCtx(7, derSeq(certContent)),
      derCtx(9, derUtf8(serverAddr)),
    ]));
  }

  function encodeRDCleanPathError(): Buffer {
    return derSeq(Buffer.concat([
      derCtx(0, derInt(3390)),
      derCtx(1, derSeq(derCtx(0, derInt(1)))),
    ]));
  }

  /**
   * Read one complete TPKT/X.224 PDU from a socket (length from bytes [2-3]).
   * Any leftover bytes are re-emitted as a 'data' event.
   */
  function readX224Pdu(sock: net.Socket): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let buf = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length < 4) return;
        const total = (buf[2] << 8) | buf[3];
        if (buf.length < total) return;
        sock.removeListener('data', onData);
        sock.removeListener('error', onErr);
        sock.removeListener('close', onClose);
        const pdu = buf.slice(0, total);
        const leftover = buf.slice(total);
        if (leftover.length > 0) setImmediate(() => sock.emit('data', leftover));
        resolve(pdu);
      };
      const onErr = (e: Error) => reject(e);
      const onClose = () => reject(new Error('Socket closed before X.224 PDU'));
      sock.on('data', onData);
      sock.once('error', onErr);
      sock.once('close', onClose);
    });
  }

  /**
   * Open a throw-away TCP connection to grab the RDP host's TLS certificate chain.
   * Does X.224 handshake, then upgrades to TLS to read the cert. Never throws.
   */
  function peekServerCerts(host: string, port: number, x224cr: Buffer): Promise<Buffer[]> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (certs: Buffer[]) => { if (!done) { done = true; resolve(certs); } };

      // 10-second hard timeout for the entire cert peek
      const hardTimeout = setTimeout(() => {
        sock.destroy();
        finish([]);
      }, 10000);

      const sock = net.connect(port, host);
      sock.once('connect', () => {
        sock.write(x224cr);
      });
      sock.once('error', () => {
        clearTimeout(hardTimeout);
        finish([]);
      });

      readX224Pdu(sock)
        .then((x224cc) => {
          const tlsSock = tls.connect({
            socket: sock,
            rejectUnauthorized: false,
            host,
            checkServerIdentity: () => undefined,
          });
          const tlsTimeout = setTimeout(() => {
            tlsSock.destroy();
            clearTimeout(hardTimeout);
            finish([]);
          }, 8000);
          tlsSock.once('secureConnect', () => {
            clearTimeout(tlsTimeout);
            clearTimeout(hardTimeout);
            const certs: Buffer[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let c: any = tlsSock.getPeerCertificate(true);
            const seen = new Set<string>();
            while (c && c.raw) {
              const key = (c.raw as Buffer).toString('hex');
              if (seen.has(key)) break;
              seen.add(key);
              certs.push(Buffer.from(c.raw as Buffer));
              c = c.issuerCertificate;
            }
            tlsSock.destroy();
            finish(certs);
          });
          tlsSock.once('error', () => {
            clearTimeout(tlsTimeout);
            clearTimeout(hardTimeout);
            sock.destroy();
            finish([]);
          });
        })
        .catch(() => {
          clearTimeout(hardTimeout);
          sock.destroy();
          finish([]);
        });
    });
  }

  // ── RDCleanPath proxy for IronRDP ─────────────────────────────────────────────
  wssRaw.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '', `https://${req.headers.host}`);
    const ticketId = url.searchParams.get('ticket');
    const connectionId = url.searchParams.get('connectionId');
    const clientIp = resolveClientIp(req);

    if (!ticketId || !connectionId) { ws.close(4001, 'Missing ticket or connectionId'); return; }

    const ticketData = redeemWsTicket(ticketId);
    if (!ticketData) { ws.close(4001, 'Invalid or expired ticket'); return; }
    const { userId, tokenHash } = ticketData;

    if (isSessionRevoked(tokenHash)) { ws.close(4001, 'Session revoked'); return; }
    registerWs(tokenHash, ws);
    ws.once('close', () => unregisterWs(tokenHash, ws));

    const conn = queryOne<ConnectionRow>(
      'SELECT * FROM connections WHERE id = ? AND user_id = ?',
      [connectionId, userId],
    );
    if (!conn || conn.protocol !== 'rdp') { ws.close(4002, 'Connection not found or not RDP'); return; }

    const sessionId = uuid();
    // RDP has no recording support — sessions are tracked via audit trail only
    logAudit({ userId, eventType: 'session.rdp.connect',
      target: `${conn.host}:${conn.port}`,
      details: { connectionId, sessionId, connectionName: conn.name }, ipAddress: clientIp });

    let tunnel: net.Socket | null = null;
    let tlsTunnel: tls.TLSSocket | null = null;
    const cleanup = () => {
      if (tlsTunnel) { try { tlsTunnel.destroy(); } catch { /**/ } tlsTunnel = null; }
      if (tunnel) { try { tunnel.destroy(); } catch { /**/ } tunnel = null; }
    };

    // First WebSocket message = RDCleanPath request DER
    ws.once('message', (data: Buffer | string) => {
      const rdcp = typeof data === 'string' ? Buffer.from(data) : (data as Buffer);
      let x224cr: Buffer;
      try { x224cr = extractX224CR(rdcp); }
      catch (e) {
        console.error('[rdp] parse error:', e);
        if (ws.readyState === WebSocket.OPEN) { ws.send(encodeRDCleanPathError()); ws.close(4004, 'Bad PDU'); }
        return;
      }

      // Open TCP tunnel, do X.224 handshake, then upgrade to TLS.
      // IronRDP sends raw CredSSP/RDP bytes through the WebSocket; the proxy
      // wraps them in TLS when talking to the actual RDP host.  The server cert
      // is captured from the TLS handshake and sent back in the RDCleanPath
      // response so IronRDP can compute CredSSP channel bindings.
      tunnel = net.connect(conn.port, conn.host, () => tunnel!.write(x224cr));

      readX224Pdu(tunnel)
        .then((x224cc) => {
          if (ws.readyState !== WebSocket.OPEN) { cleanup(); return; }

          // Upgrade the raw TCP socket to TLS (Node.js/OpenSSL acts as TLS client)
          tlsTunnel = tls.connect({
            socket: tunnel!,
            rejectUnauthorized: false,
            host: conn.host,
            checkServerIdentity: () => undefined,
          });

          tlsTunnel.once('secureConnect', () => {
            // Capture server cert chain for IronRDP's CredSSP channel bindings
            const certs: Buffer[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let c: any = tlsTunnel!.getPeerCertificate(true);
            const seen = new Set<string>();
            while (c && c.raw) {
              const key = (c.raw as Buffer).toString('hex');
              if (seen.has(key)) break;
              seen.add(key);
              certs.push(Buffer.from(c.raw as Buffer));
              c = c.issuerCertificate;
            }
            if (ws.readyState !== WebSocket.OPEN) { cleanup(); return; }

            ws.send(encodeRDCleanPathResponse(x224cc, conn.host, certs));

            const t = tlsTunnel!;

            // TLS → WebSocket
            t.on('data', (chunk: Buffer) => {
              if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
            });
            t.once('close', () => {
              if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'TCP closed');
            });

            // WebSocket → TLS
            ws.on('message', (msg: Buffer | string) => {
              const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg as string);
              if (!t.destroyed && t.writable) t.write(buf);
            });
          });

          tlsTunnel.once('error', (e: Error) => {
            console.error('[rdp] TLS error:', e.message);
            if (ws.readyState === WebSocket.OPEN) { ws.send(encodeRDCleanPathError()); ws.close(4003, 'TLS error'); }
            cleanup();
          });
        })
        .catch((e) => {
          console.error('[rdp] X.224 error:', e);
          if (ws.readyState === WebSocket.OPEN) { ws.send(encodeRDCleanPathError()); ws.close(4003, 'X.224 error'); }
          cleanup();
        });

      tunnel.on('error', (err: Error) => {
        console.error('[rdp] TCP error:', err.message);
        if (ws.readyState === WebSocket.OPEN) ws.close(4003, 'TCP error');
        cleanup();
      });
      // Only fire TCP close if TLS hasn't taken over yet
      tunnel.on('close', () => {
        if (!tlsTunnel && ws.readyState === WebSocket.OPEN) ws.close(1000, 'TCP closed');
      });
    });

    ws.on('close', () => {
      cleanup();
      logAudit({ userId, eventType: 'session.rdp.disconnect',
        target: `${conn.host}:${conn.port}`,
        details: { connectionId, sessionId }, ipAddress: clientIp });
    });
    ws.on('error', () => cleanup());
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '', `https://${req.headers.host}`);
    const ticketId = url.searchParams.get('ticket');
    const connectionId = url.searchParams.get('connectionId');
    const clientIp = resolveClientIp(req);

    if (!ticketId || !connectionId) {
      ws.close(4001, 'Missing ticket or connectionId');
      return;
    }

    const ticketData = redeemWsTicket(ticketId);
    if (!ticketData) { ws.close(4001, 'Invalid or expired ticket'); return; }
    const { userId, tokenHash: tokenHash2 } = ticketData;

    if (isSessionRevoked(tokenHash2)) { ws.close(4001, 'Session revoked'); return; }
    registerWs(tokenHash2, ws);
    ws.once('close', () => unregisterWs(tokenHash2, ws));

    const conn = queryOne<ConnectionRow>(
      'SELECT * FROM connections WHERE id = ? AND user_id = ?',
      [connectionId, userId],
    );

    if (!conn || conn.protocol !== 'rdp') {
      ws.close(4002, 'Connection not found or not an RDP connection');
      return;
    }

    const sessionId = uuid();
    // RDP has no recording support — sessions are tracked via audit trail only
    logAudit({
      userId,
      eventType: 'session.rdp.connect',
      target: `${conn.host}:${conn.port}`,
      details: { connectionId, sessionId, connectionName: conn.name },
      ipAddress: clientIp,
    });

    // Send connection info to the client (for IronRDP WASM to use)
    const connInfo: Record<string, unknown> = {
      type: 'connection_info',
      host: conn.host,
      port: conn.port,
    };
    if (conn.username) connInfo.username = conn.username;
    if (conn.encrypted_password) {
      try {
        connInfo.password = decrypt(conn.encrypted_password);
      } catch {
        // ignore decryption failure
      }
    }

    ws.send(JSON.stringify(connInfo));

    // Open TCP connection to the RDP target
    const tcp = net.connect(conn.port, conn.host);

    tcp.on('connect', () => {
      ws.send(JSON.stringify({ type: 'tcp_connected' }));
    });

    tcp.on('data', (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });

    tcp.on('error', (err: Error) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'tcp_error', message: err.message }));
        ws.close(4003, 'TCP connection error');
      }
    });

    tcp.on('close', () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'TCP connection closed');
      }
    });

    ws.on('message', (data: Buffer | string) => {
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'resize') return;
        } catch {
          // Not JSON, forward as-is
        }
      }
      if (tcp.writable) {
        tcp.write(typeof data === 'string' ? Buffer.from(data) : data);
      }
    });

    ws.on('close', () => {
      tcp.destroy();
      logAudit({
        userId,
        eventType: 'session.rdp.disconnect',
        target: `${conn.host}:${conn.port}`,
        details: { connectionId, sessionId },
        ipAddress: clientIp,
      });
    });

    ws.on('error', () => {
      tcp.destroy();
    });
  });
}
