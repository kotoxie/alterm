import { Router, type Request, type Response } from 'express';
import { PassThrough } from 'stream';
import * as ftp from 'basic-ftp';
import { queryOne } from '../db/helpers.js';
import { authRequired } from '../middleware/auth.js';
import { decrypt } from '../services/encryption.js';
import { logAudit } from '../services/audit.js';
import { resolveClientIp } from '../services/ip.js';

const router = Router();
router.use(authRequired);

interface ConnRow {
  id: string;
  host: string;
  port: number;
  username: string | null;
  encrypted_password: string | null;
  user_id: string;
  shared: number;
}

function getConn(connectionId: string, userId: string): ConnRow | null {
  return queryOne<ConnRow>(
    `SELECT id, host, port, username, encrypted_password, user_id, shared
     FROM connections
     WHERE id = ? AND (user_id = ? OR shared = 1) AND protocol = 'ftp'`,
    [connectionId, userId],
  ) ?? null;
}

async function makeFtpClient(conn: ConnRow): Promise<ftp.Client> {
  const password = conn.encrypted_password
    ? (() => { try { return decrypt(conn.encrypted_password!); } catch { return ''; } })()
    : '';

  const client = new ftp.Client(10000);
  await client.access({
    host: conn.host,
    port: conn.port || 21,
    user: conn.username || 'anonymous',
    password,
  });
  return client;
}

// POST /:connectionId/list — list directory
router.post('/:connectionId/list', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const { path: dirPath = '/' } = req.body as { path?: string };
  let client: ftp.Client | null = null;

  // Log connect audit event on root navigation (initial connection open)
  const isRootConnect = dirPath === '/' || dirPath === '' || dirPath === '.';
  if (isRootConnect) {
    logAudit({
      userId,
      eventType: 'session.ftp.connect',
      target: `${conn.host}:${conn.port || 21}`,
      details: { connectionId: req.params.connectionId },
      ipAddress: resolveClientIp(req),
    });
  }

  try {
    client = await makeFtpClient(conn);
    const entries = await client.list(dirPath || '/');
    res.json({
      files: entries.map((e) => ({
        filename: e.name,
        fileAttributes: e.isDirectory ? 0x10 : 0x00,
      })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'FTP error';
    console.error('[ftp] list error:', msg);
    res.status(500).json({ error: 'Operation failed' });
  } finally {
    client?.close();
  }
});

// GET /:connectionId/download — download a file
router.get('/:connectionId/download', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  const rawName = filePath.split('/').pop() || 'download';
  const safeFileName = encodeURIComponent(rawName).replace(/['()]/g, encodeURIComponent);
  let client: ftp.Client | null = null;

  try {
    client = await makeFtpClient(conn);
    const pass = new PassThrough();
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFileName}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    pass.pipe(res);
    await client.downloadTo(pass, filePath);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'FTP error';
    console.error('[ftp] download error:', msg);
    if (!res.headersSent) res.status(500).json({ error: 'Operation failed' });
  } finally {
    client?.close();
  }
});

// POST /:connectionId/upload — upload a file (body is raw buffer / req is readable)
router.post('/:connectionId/upload', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  let client: ftp.Client | null = null;

  try {
    client = await makeFtpClient(conn);
    await client.uploadFrom(req, filePath);
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'FTP error';
    console.error('[ftp] upload error:', msg);
    res.status(500).json({ error: 'Operation failed' });
  } finally {
    client?.close();
  }
});

// POST /:connectionId/mkdir — create directory
router.post('/:connectionId/mkdir', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const { path: dirPath } = req.body as { path?: string };
  if (!dirPath) { res.status(400).json({ error: 'path required' }); return; }

  let client: ftp.Client | null = null;

  try {
    client = await makeFtpClient(conn);
    await client.ensureDir(dirPath);
    // cd back to root so the connection is in a clean state before closing
    await client.cd('/');
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'FTP error';
    console.error('[ftp] mkdir error:', msg);
    res.status(500).json({ error: 'Operation failed' });
  } finally {
    client?.close();
  }
});

// DELETE /:connectionId/file — delete a file or directory
router.delete('/:connectionId/file', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  let client: ftp.Client | null = null;

  try {
    client = await makeFtpClient(conn);
    // Try as file first; if that fails, try as directory
    try {
      await client.remove(filePath);
    } catch {
      await client.removeDir(filePath);
    }
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'FTP error';
    console.error('[ftp] delete error:', msg);
    res.status(500).json({ error: 'Operation failed' });
  } finally {
    client?.close();
  }
});

export default router;
