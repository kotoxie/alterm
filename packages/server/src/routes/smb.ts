import { Router, type Request, type Response } from 'express';
import { queryOne } from '../db/helpers.js';
import { authRequired } from '../middleware/auth.js';
import { decrypt } from '../services/encryption.js';
import { logAudit } from '../services/audit.js';
import { logFileSessionEvent } from '../services/fileSession.js';
import { resolveClientIp } from '../services/ip.js';
import SMB2 from '@marsaud/smb2';

const router = Router();
router.use(authRequired);

interface ConnRow {
  id: string;
  host: string;
  port: number;
  username: string | null;
  encrypted_password: string | null;
  extra_config_json: string | null;
  user_id: string;
  shared: number;
}

async function getConn(connectionId: string, userId: string): Promise<ConnRow | null> {
  const conn = queryOne<ConnRow>(
    `SELECT id, host, port, username, encrypted_password, extra_config_json, user_id, shared
     FROM connections
     WHERE id = ? AND (user_id = ? OR shared = 1) AND protocol = 'smb'`,
    [connectionId, userId],
  );
  return conn ?? null;
}

function makeSmbClient(conn: ConnRow): SMB2 {
  const password = conn.encrypted_password
    ? (() => { try { return decrypt(conn.encrypted_password!); } catch { return ''; } })()
    : '';

  // Parse share name from extra_config_json
  let shareName = '';
  let domain = '';
  try {
    if (conn.extra_config_json) {
      const cfg = JSON.parse(conn.extra_config_json) as { share?: string; domain?: string };
      // Strip any leading backslashes/forward slashes the user may have typed
      shareName = (cfg.share?.trim() ?? '').replace(/^[/\\]+/, '');
      domain = cfg.domain?.trim() ?? '';
    }
  } catch { /* ignore */ }

  if (!shareName) {
    throw new Error('SMB share name is not configured. Edit the connection and enter a share name.');
  }

  // SMB2 requires \\host\share format
  const share = `\\\\${conn.host}\\${shareName}`;

  return new SMB2({
    share,
    domain,
    username: conn.username || 'guest',
    password,
    port: conn.port || 445,
    autoCloseTimeout: 5000,
  });
}

// Wrap an SMB operation so synchronous throws (e.g. from crypto) are caught too
async function smbOp<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      fn().then(resolve).catch(reject);
    } catch (e) {
      reject(e);
    }
  });
}

// POST /:connectionId/list — list directory
router.post('/:connectionId/list', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = await getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const { path: dirPath = '' } = req.body as { path?: string };
  let smb: SMB2 | null = null;

  // Log connect audit event when opening the root (initial connection)
  const isRootConnect = dirPath === '' || dirPath === '/' || dirPath === '\\';
  if (isRootConnect) {
    logAudit({
      userId,
      eventType: 'session.smb.connect',
      target: `${conn.host}:${conn.port || 445}`,
      details: { connectionId: req.params.connectionId },
      ipAddress: resolveClientIp(req),
    });
  }

  try {
    smb = makeSmbClient(conn);
    const files = await smbOp(() => smb!.readdir(dirPath, { stats: true }));
    logFileSessionEvent({ req, userId, connectionId: req.params.connectionId as string, protocol: 'smb', action: 'browse', path: dirPath || '\\', detail: { count: files.length } });
    res.json({
      files: files.map((f) => ({
        filename: f.name,
        fileAttributes: f.isDirectory() ? 0x10 : 0x00,
      })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'SMB error';
    console.error('[smb] list error:', msg);
    res.status(500).json({ error: 'Operation failed' });
  } finally {
    smb?.disconnect();
  }
});

// GET /:connectionId/download — download a file
router.get('/:connectionId/download', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = await getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  const rawName = filePath.split(/[/\\]/).pop() || 'download';
  const safeFileName = encodeURIComponent(rawName).replace(/['()]/g, encodeURIComponent);
  let smb: SMB2 | null = null;

  try {
    smb = makeSmbClient(conn);
    const stream = await smbOp(() => smb!.createReadStream(filePath));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFileName}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    stream.pipe(res);
    await new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
      res.on('finish', resolve);
      res.on('error', reject);
    });
    logFileSessionEvent({ req, userId, connectionId: req.params.connectionId as string, protocol: 'smb', action: 'download', path: filePath });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'SMB error';
    console.error('[smb] download error:', msg);
    if (!res.headersSent) res.status(500).json({ error: 'Operation failed' });
  } finally {
    smb?.disconnect();
  }
});

// POST /:connectionId/upload — upload a file
router.post('/:connectionId/upload', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = await getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  let smb: SMB2 | null = null;

  try {
    smb = makeSmbClient(conn);
    const stream = await smbOp(() => smb!.createWriteStream(filePath));
    await new Promise<void>((resolve, reject) => {
      req.pipe(stream);
      stream.on('finish', resolve);
      stream.on('error', reject);
      req.on('error', reject);
    });
    logFileSessionEvent({ req, userId, connectionId: req.params.connectionId as string, protocol: 'smb', action: 'upload', path: filePath });
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'SMB error';
    console.error('[smb] upload error:', msg);
    res.status(500).json({ error: 'Operation failed' });
  } finally {
    smb?.disconnect();
  }
});

// POST /:connectionId/mkdir — create directory
router.post('/:connectionId/mkdir', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = await getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const { path: dirPath } = req.body as { path?: string };
  if (!dirPath) { res.status(400).json({ error: 'path required' }); return; }

  let smb: SMB2 | null = null;

  try {
    smb = makeSmbClient(conn);
    await smbOp(() => smb!.mkdir(dirPath));
    logFileSessionEvent({ req, userId, connectionId: req.params.connectionId as string, protocol: 'smb', action: 'mkdir', path: dirPath });
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'SMB error';
    console.error('[smb] mkdir error:', msg);
    res.status(500).json({ error: 'Operation failed' });
  } finally {
    smb?.disconnect();
  }
});

// DELETE /:connectionId/file — delete a file
router.delete('/:connectionId/file', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = await getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  let smb: SMB2 | null = null;

  try {
    smb = makeSmbClient(conn);
    await smbOp(() => smb!.unlink(filePath));
    logFileSessionEvent({ req, userId, connectionId: req.params.connectionId as string, protocol: 'smb', action: 'delete', path: filePath });
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'SMB error';
    console.error('[smb] delete error:', msg);
    res.status(500).json({ error: 'Operation failed' });
  } finally {
    smb?.disconnect();
  }
});

export default router;
