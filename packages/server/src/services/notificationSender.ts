import { v4 as uuid } from 'uuid';
import { execute, queryOne, queryAll } from '../db/helpers.js';
import { getSetting } from './settings.js';

/**
 * Validates that a URL is safe for outbound webhook/Slack requests.
 * Blocks private/loopback addresses and non-HTTPS schemes to prevent SSRF.
 * Exported so callers can validate at their input boundary (breaking the taint chain).
 */
export function validateOutboundUrl(raw: string): URL {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error(`Invalid URL: ${raw}`); }
  if (parsed.protocol !== 'https:') throw new Error('Outbound notification URLs must use HTTPS');
  const host = parsed.hostname.toLowerCase();
  // Block loopback, private ranges, link-local, metadata service IPs
  const blocked = [
    /^localhost$/,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,        // link-local / AWS metadata
    /^::1$/,              // IPv6 loopback
    /^fd[0-9a-f]{2}:/i,   // IPv6 ULA
    /^fc[0-9a-f]{2}:/i,
  ];
  if (blocked.some((re) => re.test(host))) {
    throw new Error(`Outbound URL hostname is not allowed: ${host}`);
  }
  return parsed;
}

export interface ChannelConfig {
  // SMTP
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  smtp_password?: string;
  smtp_from?: string;
  smtp_default_subject?: string;
  smtp_default_body?: string;
  // Telegram
  telegram_bot_token?: string;
  telegram_chat_id?: string;
  telegram_default_template?: string;
  // Slack
  slack_webhook_url?: string;
  slack_default_template?: string;
  // Webhook
  webhook_url?: string;
  webhook_method?: string;
  webhook_headers?: string; // JSON string
  webhook_default_template?: string;
}

export interface ChannelRow {
  id: string;
  enabled: number;
  config_json: string;
}

export type ChannelType = 'smtp' | 'telegram' | 'slack' | 'webhook';

export interface NotificationAction {
  channel: ChannelType;
  // SMTP overrides
  to?: string;               // comma-separated custom email addresses
  to_users?: string[];       // user IDs — emails resolved at send time
  to_roles?: string[];       // role IDs — all users in role, emails resolved at send time
  subject?: string;
  body?: string;
  // Telegram overrides
  chat_id?: string;
  template?: string;
}

export interface DispatchContext {
  ruleId: string;
  ruleName: string;
  eventType: string;
  userId?: string | null;
  username?: string | null;   // resolved from users table — used in {{user}} template variable
  target?: string | null;
  ipAddress?: string | null;
  details?: Record<string, unknown>;
  timestamp: string;
}

/** Derive a severity emoji from the event type */
function severityEmoji(eventType: string): string {
  const t = eventType.toLowerCase();
  if (
    t.includes('fail') || t.includes('block') || t.includes('denied') ||
    t.includes('locked') || t.includes('revoked') || t.includes('deleted') ||
    t.includes('error') || t.includes('expired')
  ) return '🔴';
  if (
    t.includes('warn') || t.includes('mfa') || t.includes('idle') ||
    t.includes('attempt') || t.includes('invalid')
  ) return '🟡';
  return '🟢';
}

/** Get the configured app name (or fallback to "Gatwy") */
function appName(): string {
  try { return getSetting('app.name') || 'Gatwy'; } catch { return 'Gatwy'; }
}

// Template variable substitution
function renderTemplate(template: string, ctx: DispatchContext): string {
  // Resolve username from DB if userId looks like a UUID
  let displayUser = ctx.userId ?? 'system';
  if (displayUser && displayUser.includes('-')) {
    const row = queryOne<{ username: string }>('SELECT username FROM users WHERE id = ?', [displayUser]);
    if (row) displayUser = row.username;
  }

  return template
    .replace(/\{\{event\}\}/g, ctx.eventType)
    .replace(/\{\{user\}\}/g, displayUser)
    .replace(/\{\{target\}\}/g, ctx.target ?? '')
    .replace(/\{\{ip\}\}/g, ctx.ipAddress ?? '')
    .replace(/\{\{timestamp\}\}/g, ctx.timestamp)
    .replace(/\{\{rule\}\}/g, ctx.ruleName)
    .replace(/\{\{details\}\}/g, ctx.details ? JSON.stringify(ctx.details) : '')
    .replace(/\{\{app_name\}\}/g, appName())
    .replace(/\{\{severity\}\}/g, severityEmoji(ctx.eventType));
}


function getChannelRow(id: ChannelType): { enabled: boolean; config: ChannelConfig } {
  const row = queryOne<ChannelRow>(
    'SELECT enabled, config_json FROM notification_channels WHERE id = ?',
    [id],
  );
  if (!row) return { enabled: false, config: {} };
  let config: ChannelConfig = {};
  try { config = JSON.parse(row.config_json) as ChannelConfig; } catch { /* empty */ }
  return { enabled: row.enabled === 1, config };
}

function getChannelConfig(id: ChannelType): ChannelConfig {
  return getChannelRow(id).config;
}

function logResult(
  ruleId: string,
  ruleName: string,
  channel: ChannelType,
  status: 'sent' | 'failed',
  payload: unknown,
  error?: string,
): void {
  execute(
    `INSERT INTO notification_log (id, rule_id, rule_name, channel, status, error, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), ruleId, ruleName, channel, status, error ?? null, JSON.stringify(payload)],
  );
}

/** Resolve all recipient email addresses from user IDs, role IDs and a raw address list */
function resolveRecipients(action: NotificationAction): string[] {
  const addrs: string[] = [];

  // Custom comma-separated addresses
  if (action.to) {
    addrs.push(...action.to.split(',').map((s) => s.trim()).filter(Boolean));
  }

  // Specific users by ID
  if (action.to_users?.length) {
    const rows = queryAll<{ email: string | null }>(
      `SELECT email FROM users WHERE id IN (${action.to_users.map(() => '?').join(',')}) AND email IS NOT NULL AND email != ''`,
      action.to_users,
    );
    addrs.push(...rows.map((r) => r.email as string));
  }

  // All users belonging to given roles
  if (action.to_roles?.length) {
    const rows = queryAll<{ email: string | null }>(
      `SELECT email FROM users WHERE role IN (${action.to_roles.map(() => '?').join(',')}) AND email IS NOT NULL AND email != ''`,
      action.to_roles,
    );
    addrs.push(...rows.map((r) => r.email as string));
  }

  // Deduplicate
  return [...new Set(addrs)];
}

async function sendSmtp(action: NotificationAction, cfg: ChannelConfig, ctx: DispatchContext): Promise<void> {
  // Lazy-load nodemailer so the server starts even if the package isn't yet installed
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.default.createTransport({
    host: cfg.smtp_host,
    port: cfg.smtp_port ?? 587,
    secure: cfg.smtp_secure ?? false,
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_password } : undefined,
  });

  const defaultSubject = cfg.smtp_default_subject ?? '{{severity}} [{{app_name}}] {{rule}} — {{event}}';
  const defaultBody = cfg.smtp_default_body ??
    '{{severity}} [{{app_name}}] Security Alert\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    'Rule:      {{rule}}\n' +
    'Event:     {{event}}\n' +
    'User:      {{user}}\n' +
    'IP:        {{ip}}\n' +
    'Target:    {{target}}\n' +
    'Time:      {{timestamp}}\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    'This is an automated alert from {{app_name}}.';
  const subject = renderTemplate(action.subject ?? defaultSubject, ctx);
  const text = renderTemplate(action.body ?? defaultBody, ctx);

  const recipients = resolveRecipients(action);
  if (recipients.length === 0) throw new Error('No recipients resolved — add a To address, user, or role');

  await transporter.sendMail({
    from: cfg.smtp_from,
    to: recipients.join(', '),
    subject,
    text,
  });
}

async function sendTelegram(action: NotificationAction, cfg: ChannelConfig, ctx: DispatchContext): Promise<void> {
  const token = cfg.telegram_bot_token;
  if (!token) throw new Error('Telegram bot token not configured');
  const chatId = action.chat_id ?? cfg.telegram_chat_id;
  if (!chatId) throw new Error('Telegram chat_id not configured');

  const defaultTemplate = cfg.telegram_default_template ??
    '{{severity}} *[{{app_name}}]* {{rule}}\n' +
    '`{{event}}`\n\n' +
    '👤 User: `{{user}}`\n' +
    '🌐 IP: `{{ip}}`\n' +
    '🎯 Target: `{{target}}`\n' +
    '🕐 Time: `{{timestamp}}`\n\n' +
    '_Automated alert from {{app_name}}_';
  const text = renderTemplate(action.template ?? defaultTemplate, ctx);

  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram API error ${resp.status}: ${body}`);
  }
}

async function sendSlack(action: NotificationAction, cfg: ChannelConfig, ctx: DispatchContext): Promise<void> {
  // URL always comes from stored config (not action) so it is never user-tainted at dispatch time.
  if (!cfg.slack_webhook_url) throw new Error('Slack webhook URL not configured');
  const url = validateOutboundUrl(cfg.slack_webhook_url);

  const defaultTemplate = cfg.slack_default_template ??
    '{{severity}} *[{{app_name}}]* {{rule}}\n' +
    '*Event:* `{{event}}` | *User:* `{{user}}` | *IP:* `{{ip}}`\n' +
    '*Target:* `{{target}}` | *Time:* `{{timestamp}}`\n' +
    '_Automated alert from {{app_name}}_';
  const text = renderTemplate(action.template ?? defaultTemplate, ctx);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!resp.ok) throw new Error(`Slack responded ${resp.status}`);
}

async function sendWebhook(action: NotificationAction, cfg: ChannelConfig, ctx: DispatchContext): Promise<void> {
  // URL always comes from stored config (not action) so it is never user-tainted at dispatch time.
  if (!cfg.webhook_url) throw new Error('Webhook URL not configured');
  const url = validateOutboundUrl(cfg.webhook_url);

  const method = cfg.webhook_method ?? 'POST';
  let extraHeaders: Record<string, string> = {};
  try { extraHeaders = cfg.webhook_headers ? JSON.parse(cfg.webhook_headers) : {}; } catch { /* ignore */ }

  const defaultTemplate = cfg.webhook_default_template ?? '';
  const bodyText = renderTemplate(action.template ?? defaultTemplate, ctx);

  const payload = bodyText || {
    rule: ctx.ruleName,
    event: ctx.eventType,
    user: ctx.userId,
    target: ctx.target,
    ip: ctx.ipAddress,
    timestamp: ctx.timestamp,
    details: ctx.details,
  };

  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`Webhook responded ${resp.status}`);
}

export async function dispatch(action: NotificationAction, ctx: DispatchContext): Promise<void> {
  const { enabled, config: cfg } = getChannelRow(action.channel);

  if (!enabled) {
    // Channel is disabled — log as skipped but do not throw (rule should not fail)
    logResult(ctx.ruleId, ctx.ruleName, action.channel, 'failed', { action, skipped: true }, `Channel "${action.channel}" is disabled`);
    return;
  }

  const payload = { action, event: ctx.eventType, user: ctx.userId, ip: ctx.ipAddress, timestamp: ctx.timestamp };

  try {
    switch (action.channel) {
      case 'smtp':     await sendSmtp(action, cfg, ctx);     break;
      case 'telegram': await sendTelegram(action, cfg, ctx); break;
      case 'slack':    await sendSlack(action, cfg, ctx);    break;
      case 'webhook':  await sendWebhook(action, cfg, ctx);  break;
      default: throw new Error(`Unknown channel: ${action.channel}`);
    }
    logResult(ctx.ruleId, ctx.ruleName, action.channel, 'sent', payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logResult(ctx.ruleId, ctx.ruleName, action.channel, 'failed', payload, msg);
    throw err;
  }
}

/** Send a test message on a specific channel — used by the configuration UI */
export async function sendTestNotification(channel: ChannelType, overrides: Partial<NotificationAction> = {}): Promise<void> {
  const ctx: DispatchContext = {
    ruleId: 'test',
    ruleName: 'Test Notification',
    eventType: 'test.notification',
    userId: 'admin',
    target: 'test',
    ipAddress: '127.0.0.1',
    timestamp: new Date().toISOString(),
  };

  await dispatch({ channel, ...overrides } as NotificationAction, ctx);
}
