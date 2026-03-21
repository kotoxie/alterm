import fs from 'fs';
import path from 'path';
import { Router, type Request, type Response } from 'express';
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { config } from '../config.js';

const router = Router();
router.use(authRequired);

function connFilesDir(connectionId: string): string {
  // path.basename prevents directory traversal
  const safeId = path.basename(connectionId);
  const dir = path.join(config.filesDir, safeId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// List files for a connection
router.get('/:id/files', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const dir = connFilesDir(id);
  const entries = fs.readdirSync(dir).map((name) => {
    const st = fs.statSync(path.join(dir, name));
    return { name, size: st.size, mtime: st.mtimeMs };
  });
  res.json({
    files: entries,
    hostPath: `/app/data/files/${path.basename(id)}`,
  });
});

// Upload a file (binary body, filename in URL)
router.put(
  '/:id/files/:filename',
  express.raw({ type: '*/*', limit: '500mb' }),
  (req: Request, res: Response) => {
    const dir = connFilesDir(String(req.params.id));
    const filename = path.basename(String(req.params.filename));
    if (!filename) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }
    fs.writeFileSync(path.join(dir, filename), req.body as Buffer);
    res.json({ ok: true });
  },
);

// Download a file
router.get('/:id/files/:filename', (req: Request, res: Response) => {
  const dir = connFilesDir(String(req.params.id));
  const filename = path.basename(String(req.params.filename));
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.download(filePath, filename);
});

// Delete a file
router.delete('/:id/files/:filename', (req: Request, res: Response) => {
  const dir = connFilesDir(String(req.params.id));
  const filename = path.basename(String(req.params.filename));
  const filePath = path.join(dir, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});

export default router;
