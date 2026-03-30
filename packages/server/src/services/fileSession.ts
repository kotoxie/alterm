import { v4 as uuid } from 'uuid';
import type { Request } from 'express';
import { execute } from '../db/helpers.js';

export type FileSessionAction = 'browse' | 'download' | 'upload' | 'mkdir' | 'delete' | 'rename' | 'chmod' | 'copy';

export function logFileSessionEvent(params: {
  req: Request;
  userId: string;
  connectionId: string;
  protocol: 'sftp' | 'smb' | 'ftp';
  action: FileSessionAction;
  path: string;
  detail?: Record<string, unknown>;
}): void {
  const sessionId = params.req.headers['x-file-session-id'];
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 128) return;

  try {
    execute(
      `INSERT OR IGNORE INTO file_sessions (id, user_id, connection_id, protocol) VALUES (?, ?, ?, ?)`,
      [sessionId, params.userId, params.connectionId, params.protocol],
    );
    execute(
      `UPDATE file_sessions SET ended_at = datetime('now') WHERE id = ?`,
      [sessionId],
    );
    execute(
      `INSERT INTO file_session_events (id, session_id, action, path, detail_json) VALUES (?, ?, ?, ?, ?)`,
      [uuid(), sessionId, params.action, params.path, params.detail ? JSON.stringify(params.detail) : null],
    );
  } catch (err) {
    console.error('[FileSession] Failed to log event:', err);
  }
}
