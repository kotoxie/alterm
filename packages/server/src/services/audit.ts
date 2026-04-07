import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { execute } from '../db/helpers.js';
import { config } from '../config.js';

export interface AuditEvent {
  userId?: string | null;
  eventType: string;
  target?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

function normalizeIp(ip: string | undefined): string | undefined {
  return ip?.replace(/^::ffff:/i, '');
}

export function logAudit(event: AuditEvent): void {
  if (event.ipAddress) event = { ...event, ipAddress: normalizeIp(event.ipAddress) };
  try {
    execute(
      `INSERT INTO audit_log (id, user_id, event_type, target, details_json, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        event.userId ?? null,
        event.eventType,
        event.target ?? null,
        event.details ? JSON.stringify(event.details) : null,
        event.ipAddress ?? null,
      ],
    );

    // Also write to file log
    const logDir = config.logsDir;
    fs.mkdirSync(logDir, { recursive: true });
    const logLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event,
    }) + '\n';
    fs.appendFileSync(path.join(logDir, 'audit.log'), logLine);
  } catch (err) {
    console.error('[Audit] Failed to log event:', err);
  }

  // Fire notification rules asynchronously — never blocks the request
  import('./notificationRules.js').then(({ evaluateRules }) => {
    evaluateRules(event).catch((err) => {
      console.error('[Notifications] Rule evaluation error:', err);
    });
  }).catch(() => { /* module load failure — ignore */ });
}

