import https from 'https';
import fs from 'fs';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { initDb, persistDb } from './db/index.js';
import { initJwt } from './services/jwt.js';
import { initEncryption } from './services/encryption.js';
import { ensureTlsCerts } from './services/tls.js';
import { setupRdpProxy } from './ws/rdpProxy.js';
import { setupSshProxy } from './ws/sshProxy.js';
import { setupVncProxy } from './ws/vncProxy.js';
import { getSetting } from './services/settings.js';
import authRoutes from './routes/auth.js';
import connectionRoutes from './routes/connections.js';
import healthRoutes from './routes/health.js';
import settingsRoutes from './routes/settings.js';
import profileRoutes from './routes/profile.js';
import loginSessionsRoutes from './routes/loginSessions.js';
import usersRoutes from './routes/users.js';
import auditRoutes from './routes/audit.js';
import versionRoutes from './routes/version.js';
import sessionsRoutes from './routes/sessions.js';
import smbRoutes from './routes/smb.js';
import sftpRoutes from './routes/sftp.js';
import ftpRoutes from './routes/ftp.js';

async function main() {
  // Ensure data directories
  for (const dir of [config.dataDir, config.certsDir, config.recordingsDir, config.logsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Initialize services
  console.log('[Alterm] Initializing...');
  await initDb();
  initJwt();
  initEncryption();

  const { cert, key } = ensureTlsCerts();

  // Express app
  const app = express();

  // Trust proxy — dynamically evaluated per request so UI changes take effect
  // without a container restart.
  app.set('trust proxy', (ip: string) => {
    // Node.js reports IPv4 clients as ::ffff:x.x.x.x on dual-stack sockets.
    // Strip the IPv6-mapped prefix so configured entries like "192.168.1.1"
    // or "192.168.1.0/24" match correctly.
    const addr = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    const val = getSetting('security.trusted_proxies').trim();
    if (!val || val === 'false') return false;
    if (val === 'true' || val === '*') return true;
    const entries = val.split(',').map((s) => s.trim()).filter(Boolean);
    return entries.some((entry) => {
      if (entry.includes('/')) {
        // CIDR match (IPv4 only)
        try {
          const [range, bitsStr] = entry.split('/');
          const bits = parseInt(bitsStr, 10);
          if (bits < 0 || bits > 32) return false;
          const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
          const toNum = (s: string) =>
            s.split('.').reduce((acc, o) => ((acc << 8) + parseInt(o, 10)) >>> 0, 0) >>> 0;
          return (toNum(addr) & mask) === (toNum(range) & mask);
        } catch { return false; }
      }
      return entry === addr;
    });
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        connectSrc: ["'self'", "wss:", "ws:", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
      },
    },
  }));
  app.use('/api/v1/smb/:connectionId/upload', express.raw({ limit: '100mb', type: '*/*' }));
  app.use('/api/v1/sftp/:connectionId/upload', express.raw({ limit: '100mb', type: '*/*' }));
  app.use('/api/v1/ftp/:connectionId/upload', express.raw({ limit: '100mb', type: '*/*' }));
  app.use(express.json());
  app.use(cookieParser());

  // API routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/connections', connectionRoutes);
  app.use('/api/v1/settings', settingsRoutes);
  app.use('/api/v1/profile/login-sessions', loginSessionsRoutes);
  app.use('/api/v1/profile', profileRoutes);
  app.use('/api/v1/users', usersRoutes);
  app.use('/api/v1/audit', auditRoutes);
  app.use('/api/v1/version', versionRoutes);
  app.use('/api/v1/sessions', sessionsRoutes);
  app.use('/api/v1/smb', smbRoutes);
  app.use('/api/v1/sftp', sftpRoutes);
  app.use('/api/v1/ftp', ftpRoutes);
  app.use('/health', healthRoutes);

  // Global JSON error handler — prevents Express from returning HTML 500 pages
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Alterm] Unhandled error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // Serve frontend static files
  const clientDir = config.clientDir;
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.json({ message: 'Alterm API is running. Frontend not built yet.' });
    });
  }

  // HTTPS server
  const server = https.createServer({ cert, key }, app);

  // WebSocket proxies
  setupRdpProxy(server);
  setupSshProxy(server);
  setupVncProxy(server);

  // Graceful shutdown
  function shutdown() {
    console.log('\n[Alterm] Shutting down gracefully...');
    persistDb();
    server.close(() => {
      console.log('[Alterm] Server closed.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start
  server.listen(config.port, () => {
    console.log(`[Alterm] Running on https://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('[Alterm] Fatal error:', err);
  process.exit(1);
});
