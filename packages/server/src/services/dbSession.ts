import { v4 as uuid } from 'uuid';
import { execute } from '../db/helpers.js';

export type DbSessionAction =
  | 'query_execute'
  | 'schema_browse'
  | 'table_inspect'
  | 'export_csv'
  | 'export_json'
  | 'query_error';

/**
 * Start a new DB session — inserts a `file_sessions` row.
 * Returns the new sessionId.
 */
export function startDbSession(
  userId: string,
  connectionId: string,
  protocol: 'postgres' | 'mysql',
): string {
  const sessionId = uuid();
  try {
    execute(
      `INSERT INTO file_sessions (id, user_id, connection_id, protocol) VALUES (?, ?, ?, ?)`,
      [sessionId, userId, connectionId, protocol],
    );
  } catch (err) {
    console.error('[DbSession] Failed to start session:', err);
  }
  return sessionId;
}

/**
 * End a DB session — sets `ended_at` on the `file_sessions` row.
 */
export function endDbSession(sessionId: string): void {
  try {
    execute(`UPDATE file_sessions SET ended_at = datetime('now') WHERE id = ?`, [sessionId]);
  } catch (err) {
    console.error('[DbSession] Failed to end session:', err);
  }
}

/**
 * Record a DB session event in `file_session_events`.
 * - `path`: context string (e.g. `database/schema/table` or `query`)
 * - `detail`: arbitrary metadata (query text, row count, duration, error, etc.)
 */
export function recordDbEvent(
  sessionId: string,
  action: DbSessionAction,
  path: string,
  detail?: Record<string, unknown>,
): void {
  try {
    execute(
      `INSERT INTO file_session_events (id, session_id, action, path, detail_json) VALUES (?, ?, ?, ?, ?)`,
      [uuid(), sessionId, action, path, detail ? JSON.stringify(detail) : null],
    );
  } catch (err) {
    console.error('[DbSession] Failed to record event:', err);
  }
}
