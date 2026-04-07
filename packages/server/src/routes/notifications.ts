import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import { authRequired, requirePermission } from '../middleware/auth.js';
import { queryAll, queryOne, execute } from '../db/helpers.js';
import { sendTestNotification, type ChannelType, type ChannelRow } from '../services/notificationSender.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(authRequired);
router.use(requirePermission('settings.notifications'));

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
  const row = queryOne<ChannelRow>('SELECT config_json FROM notification_channels WHERE id = ?', [type]);
  let existing: Record<string, unknown> = {};
  try { existing = row ? JSON.parse(row.config_json) as Record<string, unknown> : {}; } catch { /* empty */ }

  // Merge: keep existing value if new value is the mask placeholder
  const merged: Record<string, unknown> = { ...existing };
  if (newCfg) {
    for (const [k, v] of Object.entries(newCfg)) {
      if (v !== '••••••••') merged[k] = v;
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
  const rules = rows.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled === 1,
    event: r.event,
    conditionLogic: r.condition_logic,
    conditions: safeJson(r.conditions_json, []),
    cadence: safeJson(r.cadence_json, { type: 'always' }),
    actions: safeJson(r.actions_json, []),
    createdAt: r.created_at,
    lastTriggeredAt: r.last_triggered_at,
  }));
  res.json({ rules });
});

router.post('/rules', (req: Request, res: Response) => {
  const body = req.body as {
    name?: string;
    event?: string;
    conditionLogic?: string;
    conditions?: unknown[];
    cadence?: unknown;
    actions?: unknown[];
    enabled?: boolean;
  };

  if (!body.name?.trim() || !body.event?.trim()) {
    res.status(400).json({ error: 'name and event are required' });
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
      body.event.trim(),
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
    event?: string;
    conditionLogic?: string;
    conditions?: unknown[];
    cadence?: unknown;
    actions?: unknown[];
    enabled?: boolean;
  };

  execute(
    `UPDATE notification_rules SET
       name = ?, enabled = ?, event = ?, condition_logic = ?,
       conditions_json = ?, cadence_json = ?, actions_json = ?
     WHERE id = ?`,
    [
      body.name?.trim() ?? existing.name,
      body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
      body.event?.trim() ?? existing.event,
      body.conditionLogic === 'OR' ? 'OR' : 'AND',
      JSON.stringify(body.conditions ?? safeJson(existing.conditions_json, [])),
      JSON.stringify(body.cadence ?? safeJson(existing.cadence_json, { type: 'always' })),
      JSON.stringify(body.actions ?? safeJson(existing.actions_json, [])),
      id,
    ],
  );

  logAudit({
    userId: req.user!.userId,
    eventType: 'settings.notification_rule_updated',
    target: body.name ?? existing.name,
    ipAddress: req.ip,
  });

  const updated = queryOne<RuleRow>('SELECT * FROM notification_rules WHERE id = ?', [id]);
  res.json({ rule: formatRule(updated!) });
});

router.patch('/rules/:id/toggle', (req: Request, res: Response) => {
  const { id } = req.params;
  const row = queryOne<{ enabled: number }>('SELECT enabled FROM notification_rules WHERE id = ?', [id]);
  if (!row) { res.status(404).json({ error: 'Rule not found' }); return; }

  const newEnabled = row.enabled === 1 ? 0 : 1;
  execute('UPDATE notification_rules SET enabled = ? WHERE id = ?', [newEnabled, id]);
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function formatRule(r: RuleRow) {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled === 1,
    event: r.event,
    conditionLogic: r.condition_logic,
    conditions: safeJson(r.conditions_json, []),
    cadence: safeJson(r.cadence_json, { type: 'always' }),
    actions: safeJson(r.actions_json, []),
    createdAt: r.created_at,
    lastTriggeredAt: r.last_triggered_at,
  };
}

export default router;
