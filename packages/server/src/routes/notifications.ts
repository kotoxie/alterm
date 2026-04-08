import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import { authRequired, requirePermission } from '../middleware/auth.js';
import { queryAll, queryOne, execute, getChanges } from '../db/helpers.js';
import { sendTestNotification, type ChannelType, type ChannelRow } from '../services/notificationSender.js';
import { logAudit } from '../services/audit.js';
import { getSetting, setSetting } from '../services/settings.js';

const router = Router();
router.use(authRequired);
router.use(requirePermission('settings.notifications'));

// ─── Recipients (users + roles for rule builder UI) ──────────────────────────

router.get('/recipients', (_req: Request, res: Response) => {
  const users = queryAll<{ id: string; username: string; display_name: string | null; email: string | null; role: string }>(
    `SELECT id, username, display_name, email, role FROM users ORDER BY username`,
    [],
  );
  const roles = queryAll<{ id: string; name: string }>(
    `SELECT id, name FROM roles ORDER BY name`,
    [],
  );
  res.json({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      email: u.email,
      role: u.role,
      hasEmail: !!u.email,
    })),
    roles: roles.map((r) => ({ id: r.id, name: r.name })),
  });
});

// ─── Channels ────────────────────────────────────────────────────────────────

router.get('/channels', (_req: Request, res: Response) => {
  const rows = queryAll<ChannelRow>('SELECT id, enabled, config_json FROM notification_channels', []);
  const channels = rows.map((r) => {
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(r.config_json) as Record<string, unknown>; } catch { /* empty */ }
    // Mask secrets
    if (cfg.smtp_password) cfg.smtp_password = '••••••••';
    if (cfg.telegram_bot_token) cfg.telegram_bot_token = '••••••••';
    if (cfg.slack_webhook_url) cfg.slack_webhook_url = '••••••••';
    return { id: r.id, enabled: r.enabled === 1, config: cfg };
  });
  res.json({ channels });
});

router.put('/channels/:type', (req: Request, res: Response) => {
  const { type } = req.params as { type: string };
  const validTypes: ChannelType[] = ['smtp', 'telegram', 'slack', 'webhook'];
  if (!validTypes.includes(type as ChannelType)) {
    res.status(400).json({ error: 'Invalid channel type' });
    return;
  }

  const { enabled, config: newCfg } = req.body as { enabled?: boolean; config?: Record<string, unknown> };

  // Load existing config to preserve masked secrets
  const row = queryOne<ChannelRow>('SELECT enabled, config_json FROM notification_channels WHERE id = ?', [type]);
  let existing: Record<string, unknown> = {};
  try { existing = row ? JSON.parse(row.config_json) as Record<string, unknown> : {}; } catch { /* empty */ }

  // Merge: keep existing value if new value is the mask placeholder
  const merged: Record<string, unknown> = { ...existing };
  if (newCfg) {
    for (const [k, v] of Object.entries(newCfg)) {
      if (v !== '••••••••') merged[k] = v;
    }
  }

  // Build change details for audit (mask secrets)
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const prevEnabled = row ? row.enabled === 1 : false;
  if (enabled !== undefined && enabled !== prevEnabled) {
    changes.enabled = { from: prevEnabled, to: enabled };
  }
  if (newCfg) {
    for (const [k, v] of Object.entries(newCfg)) {
      if (v === '••••••••') continue; // masked — not a real change
      const prev = existing[k];
      if (prev !== v) {
        const isSecret = /password|token|secret|webhook_url/i.test(k);
        changes[k] = {
          from: isSecret && prev ? '••••••••' : prev ?? null,
          to: isSecret ? '••••••••' : v,
        };
      }
    }
  }

  execute(
    `UPDATE notification_channels SET enabled = ?, config_json = ?, updated_at = datetime('now') WHERE id = ?`,
    [enabled ? 1 : 0, JSON.stringify(merged), type],
  );

  logAudit({
    userId: req.user!.userId,
    eventType: 'settings.notifications_channel_updated',
    target: type,
    details: Object.keys(changes).length > 0 ? { changes } : undefined,
    ipAddress: req.ip,
  });

  res.json({ ok: true });
});

router.post('/channels/:type/test', async (req: Request, res: Response) => {
  const { type } = req.params as { type: string };
  const validTypes: ChannelType[] = ['smtp', 'telegram', 'slack', 'webhook'];
  if (!validTypes.includes(type as ChannelType)) {
    res.status(400).json({ error: 'Invalid channel type' });
    return;
  }

  const overrides = req.body as Record<string, unknown>;

  try {
    await sendTestNotification(type as ChannelType, overrides);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── Rules ───────────────────────────────────────────────────────────────────

interface RuleRow {
  id: string;
  name: string;
  enabled: number;
  event: string;
  condition_logic: string;
  conditions_json: string;
  cadence_json: string;
  actions_json: string;
  created_at: string;
  last_triggered_at: string | null;
}

router.get('/rules', (_req: Request, res: Response) => {
  const rows = queryAll<RuleRow>('SELECT * FROM notification_rules ORDER BY created_at DESC', []);
  const rules = rows.map((r) => formatRule(r));
  res.json({ rules });
});

router.post('/rules', (req: Request, res: Response) => {
  const body = req.body as {
    name?: string;
    events?: string[];
    event?: string; // legacy single-event support
    conditionLogic?: string;
    conditions?: unknown[];
    cadence?: unknown;
    actions?: unknown[];
    enabled?: boolean;
  };

  const eventsArr: string[] = body.events?.length
    ? body.events
    : body.event?.trim()
    ? [body.event.trim()]
    : [];

  if (!body.name?.trim() || eventsArr.length === 0) {
    res.status(400).json({ error: 'name and at least one event are required' });
    return;
  }

  const id = uuid();
  execute(
    `INSERT INTO notification_rules (id, name, enabled, event, condition_logic, conditions_json, cadence_json, actions_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      body.name.trim(),
      body.enabled !== false ? 1 : 0,
      JSON.stringify(eventsArr),
      body.conditionLogic === 'OR' ? 'OR' : 'AND',
      JSON.stringify(body.conditions ?? []),
      JSON.stringify(body.cadence ?? { type: 'always' }),
      JSON.stringify(body.actions ?? []),
    ],
  );

  logAudit({
    userId: req.user!.userId,
    eventType: 'settings.notification_rule_created',
    target: body.name,
    ipAddress: req.ip,
  });

  const rule = queryOne<RuleRow>('SELECT * FROM notification_rules WHERE id = ?', [id]);
  res.status(201).json({ rule: formatRule(rule!) });
});

router.put('/rules/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const existing = queryOne<RuleRow>('SELECT * FROM notification_rules WHERE id = ?', [id]);
  if (!existing) { res.status(404).json({ error: 'Rule not found' }); return; }

  const body = req.body as {
    name?: string;
    events?: string[];
    event?: string; // legacy
    conditionLogic?: string;
    conditions?: unknown[];
    cadence?: unknown;
    actions?: unknown[];
    enabled?: boolean;
  };

  // Resolve events: new array field > legacy single field > keep existing
  let eventsArr: string[];
  if (body.events?.length) {
    eventsArr = body.events;
  } else if (body.event?.trim()) {
    eventsArr = [body.event.trim()];
  } else {
    // Keep existing
    const raw = (existing.event ?? '*').trimStart();
    eventsArr = raw.startsWith('[') ? (JSON.parse(raw) as string[]) : [raw];
  }

  // Build before/after diff for audit
  const newName = body.name?.trim() ?? existing.name;
  const newConditionLogic = body.conditionLogic === 'OR' ? 'OR' : 'AND';
  const newConditions = body.conditions ?? safeJson(existing.conditions_json, []);
  const newCadence = body.cadence ?? safeJson(existing.cadence_json, { type: 'always' });
  const newActions = body.actions ?? safeJson(existing.actions_json, []);

  execute(
    `UPDATE notification_rules SET
       name = ?, enabled = ?, event = ?, condition_logic = ?,
       conditions_json = ?, cadence_json = ?, actions_json = ?
     WHERE id = ?`,
    [
      newName,
      body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
      JSON.stringify(eventsArr),
      newConditionLogic,
      JSON.stringify(newConditions),
      JSON.stringify(newCadence),
      JSON.stringify(newActions),
      id,
    ],
  );

  // Compute change details
  const existingEvents = (() => {
    const r = (existing.event ?? '*').trimStart();
    return r.startsWith('[') ? safeJson<string[]>(r, [r]) : [r];
  })();
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (newName !== existing.name) changes.name = { from: existing.name, to: newName };
  if (JSON.stringify(eventsArr) !== JSON.stringify(existingEvents)) changes.events = { from: existingEvents, to: eventsArr };
  if (newConditionLogic !== existing.condition_logic) changes.conditionLogic = { from: existing.condition_logic, to: newConditionLogic };
  if (JSON.stringify(newConditions) !== existing.conditions_json) changes.conditions = { from: safeJson(existing.conditions_json, []), to: newConditions };
  if (JSON.stringify(newCadence) !== existing.cadence_json) changes.cadence = { from: safeJson(existing.cadence_json, {}), to: newCadence };
  if (JSON.stringify(newActions) !== existing.actions_json) changes.actions = { from: '(previous)', to: '(updated)' };

  logAudit({
    userId: req.user!.userId,
    eventType: 'settings.notification_rule_updated',
    target: newName,
    details: Object.keys(changes).length > 0 ? { rule_id: id, changes } : { rule_id: id },
    ipAddress: req.ip,
  });

  const updated = queryOne<RuleRow>('SELECT * FROM notification_rules WHERE id = ?', [id]);
  res.json({ rule: formatRule(updated!) });
});

router.patch('/rules/:id/toggle', (req: Request, res: Response) => {
  const { id } = req.params;
  const row = queryOne<{ enabled: number; name: string }>('SELECT enabled, name FROM notification_rules WHERE id = ?', [id]);
  if (!row) { res.status(404).json({ error: 'Rule not found' }); return; }

  const newEnabled = row.enabled === 1 ? 0 : 1;
  execute('UPDATE notification_rules SET enabled = ? WHERE id = ?', [newEnabled, id]);

  logAudit({
    userId: req.user!.userId,
    eventType: newEnabled === 1 ? 'settings.notification_rule_enabled' : 'settings.notification_rule_disabled',
    target: row.name,
    details: { rule_id: id, enabled: newEnabled === 1 },
    ipAddress: req.ip,
  });

  res.json({ ok: true, enabled: newEnabled === 1 });
});

router.delete('/rules/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const row = queryOne<{ name: string }>('SELECT name FROM notification_rules WHERE id = ?', [id]);
  if (!row) { res.status(404).json({ error: 'Rule not found' }); return; }

  execute('DELETE FROM notification_rules WHERE id = ?', [id]);

  logAudit({
    userId: req.user!.userId,
    eventType: 'settings.notification_rule_deleted',
    target: row.name,
    ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// ─── Log ─────────────────────────────────────────────────────────────────────

interface LogRow {
  id: string;
  rule_id: string | null;
  rule_name: string;
  channel: string;
  status: string;
  error: string | null;
  payload_json: string | null;
  sent_at: string;
}

router.get('/log', (req: Request, res: Response) => {
  const { status, rule_id, page = '1', limit = '50' } = req.query as Record<string, string>;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status) { conditions.push('status = ?'); params.push(status); }
  if (rule_id) { conditions.push('rule_id = ?'); params.push(rule_id); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = queryAll<LogRow>(
    `SELECT * FROM notification_log ${where} ORDER BY sent_at DESC LIMIT ? OFFSET ?`,
    [...params, parseInt(limit, 10), offset],
  );

  const total = (queryOne<{ n: number }>(
    `SELECT COUNT(*) as n FROM notification_log ${where}`,
    params,
  ))?.n ?? 0;

  const entries = rows.map((r) => ({
    id: r.id,
    ruleId: r.rule_id,
    ruleName: r.rule_name,
    channel: r.channel,
    status: r.status,
    error: r.error,
    payload: r.payload_json ? safeJson(r.payload_json, null) : null,
    sentAt: r.sent_at,
  }));

  res.json({ entries, total, page: parseInt(page, 10), limit: parseInt(limit, 10) });
});

router.post('/log/:id/retry', async (req: Request, res: Response) => {
  const { id } = req.params;
  const row = queryOne<LogRow>('SELECT * FROM notification_log WHERE id = ?', [id]);
  if (!row) { res.status(404).json({ error: 'Log entry not found' }); return; }

  const payload = row.payload_json ? safeJson<{ action?: unknown }>(row.payload_json, {}) : {};
  const action = payload.action as Parameters<typeof sendTestNotification>[1] & { channel: ChannelType } | undefined;

  if (!action) { res.status(400).json({ error: 'No action payload to retry' }); return; }

  try {
    const { dispatch } = await import('../services/notificationSender.js');
    const { rule_id, rule_name, channel } = row;
    const ctx = {
      ruleId: rule_id ?? 'retry',
      ruleName: rule_name,
      eventType: 'retry',
      timestamp: new Date().toISOString(),
    };
    await dispatch({ ...action, channel: channel as ChannelType }, ctx);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── Settings (retention) ─────────────────────────────────────────────────────

router.get('/settings', (_req: Request, res: Response) => {
  const retentionDays = parseInt(getSetting('notifications.log_retention_days') ?? '90', 10);
  res.json({ retentionDays });
});

router.put('/settings', (req: Request, res: Response) => {
  const { retentionDays } = req.body as { retentionDays?: number };
  const days = parseInt(String(retentionDays ?? ''), 10);
  if (!days || days < 1) {
    res.status(400).json({ error: 'retentionDays must be a positive integer' });
    return;
  }
  const old = parseInt(getSetting('notifications.log_retention_days') ?? '90', 10);
  setSetting('notifications.log_retention_days', String(days));

  logAudit({
    userId: req.user!.userId,
    eventType: 'settings.notifications_retention_changed',
    details: { from: old, to: days },
    ipAddress: req.ip,
  });

  res.json({ ok: true, retentionDays: days });
});

// ─── Delete log entries ───────────────────────────────────────────────────────

router.delete('/log/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const row = queryOne<{ rule_name: string; channel: string }>(
    'SELECT rule_name, channel FROM notification_log WHERE id = ?', [id],
  );
  if (!row) { res.status(404).json({ error: 'Log entry not found' }); return; }

  execute('DELETE FROM notification_log WHERE id = ?', [id]);

  logAudit({
    userId: req.user!.userId,
    eventType: 'notifications.log_entry_deleted',
    target: `${row.rule_name} (${row.channel})`,
    ipAddress: req.ip,
  });

  res.json({ ok: true });
});

router.delete('/log', (req: Request, res: Response) => {
  const { status, rule_id, before } = req.query as Record<string, string>;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) { conditions.push('status = ?'); params.push(status); }
  if (rule_id) { conditions.push('rule_id = ?'); params.push(rule_id); }
  if (before) { conditions.push('sent_at < ?'); params.push(before); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  execute(`DELETE FROM notification_log ${where}`, params);
  const deleted = getChanges();

  logAudit({
    userId: req.user!.userId,
    eventType: 'notifications.log_cleared',
    details: { deleted, filters: { status: status ?? null, rule_id: rule_id ?? null, before: before ?? null } },
    ipAddress: req.ip,
  });

  res.json({ ok: true, deleted });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function formatRule(r: RuleRow) {
  // Parse events: stored as JSON array (new) or legacy single string
  let events: string[] = [];
  const raw = (r.event ?? '*').trimStart();
  if (raw.startsWith('[')) {
    try { events = JSON.parse(raw) as string[]; } catch { events = [raw]; }
  } else {
    events = [raw];
  }
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled === 1,
    events,
    conditionLogic: r.condition_logic,
    conditions: safeJson(r.conditions_json, []),
    cadence: safeJson(r.cadence_json, { type: 'always' }),
    actions: safeJson(r.actions_json, []),
    createdAt: r.created_at,
    lastTriggeredAt: r.last_triggered_at,
  };
}

export function purgeOldNotificationLogs(triggeredByUserId?: string): void {
  const days = parseInt(getSetting('notifications.log_retention_days') ?? '90', 10);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  execute('DELETE FROM notification_log WHERE sent_at < ?', [cutoff]);
  const deleted = getChanges();
  if (deleted > 0) {
    logAudit({
      userId: triggeredByUserId ?? 'system',
      eventType: 'notifications.log_purged',
      details: { deleted, retentionDays: days },
    });
  }
}

// Run purge on startup and then every 6 hours
setTimeout(() => {
  purgeOldNotificationLogs();
  setInterval(() => purgeOldNotificationLogs(), 6 * 60 * 60 * 1000);
}, 5000); // small delay to ensure DB is ready

export default router;
