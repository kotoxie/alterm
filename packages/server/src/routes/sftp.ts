import { Router, type Request, type Response } from 'express';
import { Client as SshClient } from 'ssh2';
import type { SFTPWrapper } from 'ssh2';
import crypto from 'crypto';
import { queryOne, execute } from '../db/helpers.js';
import { authRequired, requirePermission } from '../middleware/auth.js';
import { decrypt } from '../services/encryption.js';
import { logAudit } from '../services/audit.js';
import { logFileSessionEvent } from '../services/fileSession.js';
import { resolveClientIp } from '../services/ip.js';

const router = Router();
router.use(authRequired);
router.use(requirePermission('protocols.ssh'));

interface ConnRow {
  id: string;
  host: string;
  port: number;
  username: string | null;
  encrypted_password: string | null;
  private_key: string | null;
  user_id: string;
  shared: number;
  host_fingerprint: string | null;
}

function getConn(connectionId: string, userId: string, role: string): ConnRow | null {
  return queryOne<ConnRow>(
    `SELECT id, host, port, username, encrypted_password, private_key, user_id, shared, host_fingerprint
     FROM connections
     WHERE id = ? AND (user_id = ? OR shared = 1 OR id IN (SELECT cs.connection_id FROM connection_shares cs WHERE (cs.share_type = 'user' AND cs.target_id = ?) OR (cs.share_type = 'role' AND cs.target_id = ?))) AND protocol IN ('sftp', 'ssh')`,
    [connectionId, userId, userId, role],
  ) ?? null;
}

function connectSftp(conn: ConnRow): Promise<{ ssh: SshClient; sftp: SFTPWrapper }> {
  return new Promise((resolve, reject) => {
    const ssh = new SshClient();
    const password = conn.encrypted_password
      ? (() => { try { return decrypt(conn.encrypted_password!); } catch { return undefined; } })()
      : undefined;
    const privateKey = conn.private_key
      ? (() => { try { return decrypt(conn.private_key!); } catch { return undefined; } })()
      : undefined;

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
      ...(privateKey ? { privateKey } : { password }),
      readyTimeout: 10000,
      hostVerifier: (key: Buffer) => {
        const fingerprint = crypto.createHash('sha256').update(key).digest('hex');
        if (conn.host_fingerprint) {
          return conn.host_fingerprint === fingerprint;
        }
        execute('UPDATE connections SET host_fingerprint = ? WHERE id = ?', [fingerprint, conn.id]);
        return true;
      },
    });
  });
}

// POST /:connectionId/list — list directory
router.post('/:connectionId/list', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId, req.user!.role);
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

    const entries = await new Promise<{ filename: string; fileAttributes: number; size?: number }[]>((resolve, reject) => {
      sftp.readdir(dirPath || '/', (err, list) => {
        if (err) { reject(err); return; }
        resolve(
          list.map((entry) => ({
            filename: entry.filename,
            fileAttributes: entry.attrs.isDirectory() ? 0x10 : 0x00,
            size: entry.attrs.isDirectory() ? undefined : (entry.attrs.size ?? undefined),
          })),
        );
      });
    });

    logFileSessionEvent({ req, userId, connectionId: req.params.connectionId as string, protocol: 'sftp', action: 'browse', path: dirPath || '/', detail: { count: entries.length } });
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
  const conn = getConn(req.params.connectionId as string, userId, req.user!.role);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  const rawName = filePath.split('/').pop() || 'download';
  // Encode filename per RFC 5987 to prevent header injection
  const safeFileName = encodeURIComponent(rawName).replace(/['()]/g, encodeURIComponent);
  let ssh: SshClient | null = null;

  try {
    const result = await connectSftp(conn);
    ssh = result.ssh;
    const { sftp } = result;

    const stream = sftp.createReadStream(filePath);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFileName}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    stream.pipe(res);

    await new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
      res.on('finish', resolve);
      res.on('error', reject);
    });
    logFileSessionEvent({ req, userId, connectionId: req.params.connectionId as string, protocol: 'sftp', action: 'download', path: filePath });
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
  const conn = getConn(req.params.connectionId as string, userId, req.user!.role);
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

    logFileSessionEvent({ req, userId, connectionId: req.params.connectionId as string, protocol: 'sftp', action: 'upload', path: filePath });
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
  const conn = getConn(req.params.connectionId as string, userId, req.user!.role);
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

    logFileSessionEvent({ req, userId, connectionId: req.params.connectionId as string, protocol: 'sftp', action: 'mkdir', path: dirPath });
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'SFTP error';
    console.error('[sftp] mkdir error:', msg);
    res.status(500).json({ error: msg });
  } finally {
    ssh?.end();
  }
});

// DELETE /:connectionId/file — delete a file or directory
router.delete('/:connectionId/file', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId, req.user!.role);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  let ssh: SshClient | null = null;

  try {
    const result = await connectSftp(conn);
    ssh = result.ssh;
    const { sftp } = result;

    // Check if target is a directory
    const stats = await new Promise<import('ssh2').Stats>((resolve, reject) => {
      sftp.stat(filePath, (err, s) => err ? reject(err) : resolve(s));
    });

    if (stats.isDirectory()) {
      // Use rm -rf via SSH for directories (recursive delete)
      const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
      await new Promise<void>((resolve, reject) => {
        ssh!.exec(`rm -rf ${q(filePath)}`, (err, stream) => {
          if (err) { reject(err); return; }
          let stderr = '';
          stream.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
          stream.on('close', (code: number) => {
            if (code !== 0) reject(new Error(stderr || `rm failed with code ${code}`));
            else resolve();
          });
        });
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(filePath, (err) => err ? reject(err) : resolve());
      });
    }

    logFileSessionEvent({ req, userId, connectionId: req.params.connectionId as string, protocol: 'sftp', action: 'delete', path: filePath });
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'SFTP error';
    console.error('[sftp] delete error:', msg);
    res.status(500).json({ error: msg });
  } finally {
    ssh?.end();
  }
});

// POST /:connectionId/rename — rename a file or folder
router.post('/:connectionId/rename', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId, req.user!.role);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const { oldPath, newPath } = req.body as { oldPath?: string; newPath?: string };
  if (!oldPath || !newPath) { res.status(400).json({ error: 'oldPath and newPath required' }); return; }

  let ssh: SshClient | null = null;
  try {
    const result = await connectSftp(conn);
    ssh = result.ssh;
    const { sftp } = result;
    await new Promise<void>((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => err ? reject(err) : resolve());
    });
    logFileSessionEvent({ req, userId, connectionId: req.params.connectionId as string, protocol: 'sftp', action: 'rename', path: `${oldPath} → ${newPath}` });
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'SFTP error' });
  } finally { ssh?.end(); }
});

// POST /:connectionId/stat — get file/folder info (size, permissions, timestamps)
router.post('/:connectionId/stat', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId, req.user!.role);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const { path: filePath } = req.body as { path?: string };
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  let ssh: SshClient | null = null;
  try {
    const result = await connectSftp(conn);
    ssh = result.ssh;
    const { sftp } = result;
    const stats = await new Promise<import('ssh2').Stats>((resolve, reject) => {
      sftp.stat(filePath, (err, s) => err ? reject(err) : resolve(s));
    });
    res.json({
      size: stats.size,
      mode: stats.mode,
      permissions: `0${(stats.mode & 0o7777).toString(8)}`,
      uid: stats.uid,
      gid: stats.gid,
      atime: new Date(stats.atime * 1000).toISOString(),
      mtime: new Date(stats.mtime * 1000).toISOString(),
      isDirectory: stats.isDirectory(),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'SFTP error' });
  } finally { ssh?.end(); }
});

// POST /:connectionId/chmod — change file permissions
router.post('/:connectionId/chmod', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId, req.user!.role);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const { path: filePath, mode } = req.body as { path?: string; mode?: number };
  if (!filePath || mode === undefined) { res.status(400).json({ error: 'path and mode required' }); return; }

  let ssh: SshClient | null = null;
  try {
    const result = await connectSftp(conn);
    ssh = result.ssh;
    const { sftp } = result;
    await new Promise<void>((resolve, reject) => {
      sftp.chmod(filePath, mode, (err) => err ? reject(err) : resolve());
    });
    logFileSessionEvent({ req, userId, connectionId: req.params.connectionId as string, protocol: 'sftp', action: 'chmod', path: `${filePath} → ${mode.toString(8)}` });
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'SFTP error' });
  } finally { ssh?.end(); }
});

// POST /:connectionId/copy — copy a file (server-side, uses SFTP-safe shell quoting)
router.post('/:connectionId/copy', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const conn = getConn(req.params.connectionId as string, userId, req.user!.role);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const { srcPath, destPath } = req.body as { srcPath?: string; destPath?: string };
  if (!srcPath || !destPath) { res.status(400).json({ error: 'srcPath and destPath required' }); return; }

  // Shell-safe single-quote escaping — prevents command injection via path names
  const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

  let ssh: SshClient | null = null;
  try {
    const result = await connectSftp(conn);
    ssh = result.ssh;
    // Use SSH exec for copy since SFTP has no native copy
    await new Promise<void>((resolve, reject) => {
      ssh!.exec(`cp -r ${q(srcPath)} ${q(destPath)}`, (err, stream) => {
        if (err) { reject(err); return; }
        let stderr = '';
        stream.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        stream.on('close', (code: number) => {
          if (code !== 0) reject(new Error(stderr || `cp failed with code ${code}`));
          else resolve();
        });
      });
    });
    logFileSessionEvent({ req, userId, connectionId: req.params.connectionId as string, protocol: 'sftp', action: 'copy', path: `${srcPath} → ${destPath}` });
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'SFTP error' });
  } finally { ssh?.end(); }
});

export default router;
