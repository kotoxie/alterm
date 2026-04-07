import { queryAll, execute } from '../db/helpers.js';
import type { AuditEvent } from './audit.js';
import { dispatch, type NotificationAction, type DispatchContext } from './notificationSender.js';

interface RuleRow {
  id: string;
  name: string;
  enabled: number;
  event: string;
  condition_logic: string;
  conditions_json: string;
  cadence_json: string;
  actions_json: string;
  last_triggered_at: string | null;
}

interface Condition {
  field: 'event' | 'user' | 'ip' | 'time' | 'date' | 'custom';
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'matches' | 'before' | 'after' | 'between';
  value: string;
  value2?: string; // for "between"
}

interface Cadence {
  type: 'always' | 'throttle';
  minutes?: number;
}

function getField(field: Condition['field'], event: AuditEvent, now: Date): string {
  switch (field) {
    case 'event':  return event.eventType;
    case 'user':   return event.userId ?? '';
    case 'ip':     return event.ipAddress ?? '';
    case 'time':   return `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
    case 'date':   return now.toISOString().slice(0, 10); // YYYY-MM-DD
    case 'custom': return JSON.stringify(event.details ?? {});
    default:       return '';
  }
}

function evalCondition(cond: Condition, value: string): boolean {
  const v = cond.value;
  switch (cond.operator) {
    case 'equals':       return value === v;
    case 'not_equals':   return value !== v;
    case 'contains':     return value.includes(v);
    case 'not_contains': return !value.includes(v);
    case 'starts_with':  return value.startsWith(v);
    case 'ends_with':    return value.endsWith(v);
    case 'matches':      try { return new RegExp(v).test(value); } catch { return false; }
    case 'before':       return value < v;
    case 'after':        return value > v;
    case 'between':      return value >= v && value <= (cond.value2 ?? v);
    default:             return false;
  }
}

function ruleMatches(rule: RuleRow, event: AuditEvent, now: Date): boolean {
  // Event match — supports wildcard "*" and prefix wildcards like "auth.*"
  if (rule.event !== '*') {
    const pattern = rule.event.endsWith('.*')
      ? rule.event.slice(0, -2)
      : null;
    if (pattern) {
      if (!event.eventType.startsWith(pattern + '.')) return false;
    } else {
      if (event.eventType !== rule.event) return false;
    }
  }

  // Conditions
  let conditions: Condition[] = [];
  try { conditions = JSON.parse(rule.conditions_json) as Condition[]; } catch { /* ignore */ }

  if (conditions.length === 0) return true;

  const logic = rule.condition_logic === 'OR' ? 'OR' : 'AND';
  const results = conditions.map((c) => evalCondition(c, getField(c.field, event, now)));

  return logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
}

function isCadenceAllowed(rule: RuleRow, now: Date): boolean {
  let cadence: Cadence = { type: 'always' };
  try { cadence = JSON.parse(rule.cadence_json) as Cadence; } catch { /* ignore */ }

  if (cadence.type !== 'throttle') return true;
  if (!rule.last_triggered_at) return true;

  const lastMs = new Date(rule.last_triggered_at.replace(' ', 'T') + 'Z').getTime();
  const thresholdMs = (cadence.minutes ?? 60) * 60 * 1000;
  return now.getTime() - lastMs >= thresholdMs;
}

/** Called after every logAudit() — fires matching notification rules asynchronously */
export async function evaluateRules(event: AuditEvent): Promise<void> {
  const rules = queryAll<RuleRow>(
    'SELECT * FROM notification_rules WHERE enabled = 1',
    [],
  );

  if (rules.length === 0) return;

  const now = new Date();

  for (const rule of rules) {
    if (!ruleMatches(rule, event, now)) continue;
    if (!isCadenceAllowed(rule, now)) continue;

    // Update last_triggered_at immediately to prevent duplicate fires for rapid events
    execute(
      "UPDATE notification_rules SET last_triggered_at = datetime('now') WHERE id = ?",
      [rule.id],
    );

    let actions: NotificationAction[] = [];
    try { actions = JSON.parse(rule.actions_json) as NotificationAction[]; } catch { /* ignore */ }

    const ctx: DispatchContext = {
      ruleId: rule.id,
      ruleName: rule.name,
      eventType: event.eventType,
      userId: event.userId,
      target: event.target,
      ipAddress: event.ipAddress,
      details: event.details,
      timestamp: now.toISOString(),
    };

    // Dispatch all actions in parallel, best-effort
    await Promise.allSettled(actions.map((action) => dispatch(action, ctx)));
  }
}
