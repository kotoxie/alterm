import initSqlJs, { type Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

let db: Database;

export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

function saveDb(): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(config.dbPath, buffer);
}

// Auto-save on a timer to avoid data loss
let saveTimer: ReturnType<typeof setInterval>;

function startAutoSave(): void {
  saveTimer = setInterval(() => {
    try { saveDb(); } catch { /* ignore */ }
  }, 5000);
}

export async function initDb(): Promise<Database> {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  const SQL = await initSqlJs();

  if (fs.existsSync(config.dbPath)) {
    const fileBuffer = fs.readFileSync(config.dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  runMigrations();
  saveDb();
  startAutoSave();

  // Save on process exit
  process.on('beforeExit', () => { try { saveDb(); } catch { /* ignore */ } });
  process.on('exit', () => { try { saveDb(); } catch { /* ignore */ } });

  return db;
}

export function persistDb(): void {
  saveDb();
}

function runMigrations() {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const result = db.exec('SELECT MAX(version) as v FROM schema_version');
  const currentVersion = result.length > 0 && result[0].values.length > 0
    ? (result[0].values[0][0] as number ?? 0)
    : 0;

  const migrations: { version: number; sql: string }[] = [
    {
      version: 1,
      sql: `
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          theme TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE connection_groups (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          parent_id TEXT REFERENCES connection_groups(id) ON DELETE CASCADE,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE connections (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          group_id TEXT REFERENCES connection_groups(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          protocol TEXT NOT NULL CHECK(protocol IN ('ssh', 'rdp', 'smb')),
          host TEXT NOT NULL,
          port INTEGER NOT NULL,
          username TEXT,
          encrypted_password TEXT,
          private_key TEXT,
          extra_config_json TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          recording_enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
          protocol TEXT NOT NULL,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          ended_at TEXT,
          recording_path TEXT
        );

        CREATE TABLE audit_log (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          event_type TEXT NOT NULL,
          target TEXT,
          details_json TEXT,
          ip_address TEXT,
          timestamp TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_connections_user ON connections(user_id);
        CREATE INDEX idx_connection_groups_user ON connection_groups(user_id);
        CREATE INDEX idx_sessions_user ON sessions(user_id);
        CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);
        CREATE INDEX idx_audit_log_user ON audit_log(user_id);
      `,
    },
    {
      version: 2,
      sql: `
        ALTER TABLE users ADD COLUMN email TEXT;
        ALTER TABLE users ADD COLUMN avatar_text TEXT;
        ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN locked_until TEXT;
        ALTER TABLE users ADD COLUMN last_login_at TEXT;

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS ip_rules (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN ('allow', 'deny')),
          cidr TEXT NOT NULL,
          description TEXT,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('app.name', 'Alterm'),
          ('app.logo', ''),
          ('security.session_timeout_minutes', '0'),
          ('security.max_failed_logins', '5'),
          ('security.lockout_minutes', '30'),
          ('security.ip_rules_enabled', 'false'),
          ('security.ip_rules_mode', 'allowlist'),
          ('audit.retention_days', '90'),
          ('session.recording_enabled', 'false'),
          ('session.recording_retention_days', '90'),
          ('session.max_concurrent', '0'),
          ('ssh.font_size', '14'),
          ('ssh.font_family', 'Cascadia Code, Fira Code, Menlo, Monaco, Courier New, monospace'),
          ('ssh.scrollback', '5000'),
          ('ssh.cursor_style', 'block'),
          ('rdp.default_port', '3389'),
          ('rdp.default_width', '1920'),
          ('rdp.default_height', '1080');
      `,
    },
    {
      version: 3,
      sql: `
        ALTER TABLE connections ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;

        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('security.idle_timeout_minutes', '0'),
          ('security.max_session_minutes', '0');
      `,
    },
    {
      version: 4,
      sql: `
        ALTER TABLE connections ADD COLUMN tunnels_json TEXT;
        INSERT OR IGNORE INTO settings (key, value) VALUES ('session.recording_path', 'recordings');
      `,
    },
  ];

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      db.run(migration.sql);
      db.run('INSERT INTO schema_version (version) VALUES (?)', [migration.version]);
      console.log(`[DB] Applied migration v${migration.version}`);
    }
  }
}
