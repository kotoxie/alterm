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
import { getSetting } from './services/settings.js';
import authRoutes from './routes/auth.js';
import connectionRoutes from './routes/connections.js';
import healthRoutes from './routes/health.js';
import settingsRoutes from './routes/settings.js';
import profileRoutes from './routes/profile.js';
import usersRoutes from './routes/users.js';
import auditRoutes from './routes/audit.js';
import versionRoutes from './routes/version.js';

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

  // Trust proxy — lets req.ip reflect X-Forwarded-For from reverse proxies
  const trustedProxies = getSetting('security.trusted_proxies').trim();
  if (trustedProxies === 'true' || trustedProxies === '*') {
    app.set('trust proxy', true);
  } else if (trustedProxies) {
    app.set('trust proxy', trustedProxies.split(',').map((s) => s.trim()).filter(Boolean));
  }
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        connectSrc: ["'self'", "wss:", "ws:", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  }));
  app.use(express.json());
  app.use(cookieParser());

  // API routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/connections', connectionRoutes);
  app.use('/api/v1/settings', settingsRoutes);
  app.use('/api/v1/profile', profileRoutes);
  app.use('/api/v1/users', usersRoutes);
  app.use('/api/v1/audit', auditRoutes);
  app.use('/api/v1/version', versionRoutes);
  app.use('/health', healthRoutes);

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
