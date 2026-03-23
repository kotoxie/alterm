import { queryAll, execute } from '../db/helpers.js';

const DEFAULTS: Record<string, string> = {
  'app.name': 'Alterm',
  'app.logo': '',
  'app.timezone': 'UTC',
  'security.session_timeout_minutes': '0',
  'security.max_failed_logins': '5',
  'security.lockout_minutes': '30',
  'security.trusted_proxies': '',
  'security.ip_rules_enabled': 'false',
  'security.ip_rules_mode': 'allowlist',
  'audit.retention_days': '90',
  'session.recording_enabled': 'false',
  'session.recording_retention_days': '90',
  'session.max_concurrent': '0',
  'ssh.font_size': '14',
  'ssh.font_family': 'Cascadia Code, Fira Code, Menlo, Monaco, Courier New, monospace',
  'ssh.scrollback': '5000',
  'ssh.cursor_style': 'block',
  'rdp.default_port': '3389',
  'rdp.default_width': '1920',
  'rdp.default_height': '1080',
};

interface SettingRow { key: string; value: string; }

export function getSetting(key: string): string {
  const rows = queryAll<SettingRow>('SELECT value FROM settings WHERE key = ?', [key]);
  return rows.length > 0 ? rows[0].value : (DEFAULTS[key] ?? '');
}

export function getAllSettings(): Record<string, string> {
  const rows = queryAll<SettingRow>('SELECT key, value FROM settings');
  const result: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export function setSetting(key: string, value: string): void {
  execute(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value],
  );
}

export function setSettings(updates: Record<string, string>): void {
  for (const [key, value] of Object.entries(updates)) setSetting(key, value);
}
