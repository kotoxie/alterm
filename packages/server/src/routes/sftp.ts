import { Router, type Request, type Response } from 'express';
import { Client as SshClient } from 'ssh2';
import type { SFTPWrapper } from 'ssh2';
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
     WHERE id = ? AND (user_id = ? OR shared = 1) AND protocol = 'sftp'`,
    [connectionId, userId],
  ) ?? null;
}

function connectSftp(conn: ConnRow): Promise<{ ssh: SshClient; sftp: SFTPWrapper }> {
  return new Promise((resolve, reject) => {
    const ssh = new SshClient();
    const password = conn.encrypted_password
      ? (() => { try { return decrypt(conn.encrypted_password!); } catch { return ''; } })()
      : '';

    ssh.on('ready', () => {
      ssh.sftp((err, sftp) => {
        if (err) { ssh.end(); reject(err); return; }
        resolve({ ssh, sftp });
      });
    });

    ssh.on('error', (err) => reject(err));

    ssh.connect({
      host: conn.host,
      port: conn.port || 22,
      username: conn.username || 'root',
      password,
      readyTimeout: 10000,
      hostVerifier: () => true,
    });
  });
}

// POST /:connectionId/list — list directory
router.post('/:connectionId/list', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const { path: dirPath = '/' } = req.body as { path?: string };
  let ssh: SshClient | null = null;

  // Log connect audit event on root navigation (initial connection open)
  const isRootConnect = dirPath === '/' || dirPath === '' || dirPath === '.';
  if (isRootConnect) {
    logAudit({
      userId,
      eventType: 'session.sftp.connect',
      target: `${conn.host}:${conn.port || 22}`,
      details: { connectionId: req.params.connectionId },
      ipAddress: resolveClientIp(req),
    });
  }

  try {
    const result = await connectSftp(conn);
    ssh = result.ssh;
    const { sftp } = result;

    const entries = await new Promise<{ filename: string; fileAttributes: number }[]>((resolve, reject) => {
      sftp.readdir(dirPath || '/', (err, list) => {
        if (err) { reject(err); return; }
        resolve(
          list.map((entry) => ({
            filename: entry.filename,
            fileAttributes: entry.attrs.isDirectory() ? 0x10 : 0x00,
          })),
        );
      });
    });

    res.json({ files: entries });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'SFTP error';
    console.error('[sftp] list error:', msg);
    res.status(500).json({ error: msg });
  } finally {
    ssh?.end();
  }
});

// GET /:connectionId/download — download a file
router.get('/:connectionId/download', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  const fileName = filePath.split('/').pop() || 'download';
  let ssh: SshClient | null = null;

  try {
    const result = await connectSftp(conn);
    ssh = result.ssh;
    const { sftp } = result;

    const stream = sftp.createReadStream(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    stream.pipe(res);

    await new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
      res.on('finish', resolve);
      res.on('error', reject);
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'SFTP error';
    console.error('[sftp] download error:', msg);
    if (!res.headersSent) res.status(500).json({ error: msg });
  } finally {
    ssh?.end();
  }
});

// POST /:connectionId/upload — upload a file (body is raw buffer)
router.post('/:connectionId/upload', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  let ssh: SshClient | null = null;

  try {
    const result = await connectSftp(conn);
    ssh = result.ssh;
    const { sftp } = result;

    const writeStream = sftp.createWriteStream(filePath);
    await new Promise<void>((resolve, reject) => {
      req.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      req.on('error', reject);
    });

    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'SFTP error';
    console.error('[sftp] upload error:', msg);
    res.status(500).json({ error: msg });
  } finally {
    ssh?.end();
  }
});

// POST /:connectionId/mkdir — create directory
router.post('/:connectionId/mkdir', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const { path: dirPath } = req.body as { path?: string };
  if (!dirPath) { res.status(400).json({ error: 'path required' }); return; }

  let ssh: SshClient | null = null;

  try {
    const result = await connectSftp(conn);
    ssh = result.ssh;
    const { sftp } = result;

    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(dirPath, (err) => {
        if (err) { reject(err); return; }
        resolve();
      });
    });

    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'SFTP error';
    console.error('[sftp] mkdir error:', msg);
    res.status(500).json({ error: msg });
  } finally {
    ssh?.end();
  }
});

// DELETE /:connectionId/file — delete a file
router.delete('/:connectionId/file', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  let ssh: SshClient | null = null;

  try {
    const result = await connectSftp(conn);
    ssh = result.ssh;
    const { sftp } = result;

    await new Promise<void>((resolve, reject) => {
      sftp.unlink(filePath, (err) => {
        if (err) { reject(err); return; }
        resolve();
      });
    });

    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'SFTP error';
    console.error('[sftp] delete error:', msg);
    res.status(500).json({ error: msg });
  } finally {
    ssh?.end();
  }
});

export default router;
