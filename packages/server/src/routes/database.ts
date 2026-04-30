import { Router, type Request, type Response } from 'express';
import { queryOne, queryAll, execute } from '../db/helpers.js';
import { authRequired } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { roleHasPermission } from '../services/permissions.js';
import { getPool, releasePool } from '../services/dbPool.js';
import { startDbSession, endDbSession, recordDbEvent } from '../services/dbSession.js';
import { v4 as uuid } from 'uuid';

const router = Router();
router.use(authRequired);

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

interface ConnRow {
  id: string;
  protocol: 'postgres' | 'mysql';
  user_id: string;
  shared: number;
}

function canAccessWhere(): string {
  return `(c.user_id = ? OR c.shared = 1 OR c.id IN (SELECT cs.connection_id FROM connection_shares cs WHERE (cs.share_type = 'user' AND cs.target_id = ?) OR (cs.share_type = 'role' AND cs.target_id = ?)))`;
}

function getConn(connectionId: string, req: Request): ConnRow | undefined {
  return queryOne<ConnRow>(
    `SELECT c.id, c.protocol, c.user_id, c.shared FROM connections c
     WHERE c.id = ? AND c.protocol IN ('postgres','mysql') AND ${canAccessWhere()}`,
    [connectionId, req.user!.userId, req.user!.userId, req.user!.role],
  );
}

// Session state: maps connectionId → sessionId (per process — adequate for single-server deployment)
const activeSessions = new Map<string, Map<string, string>>(); // userId → connectionId → sessionId

function getUserSessions(userId: string): Map<string, string> {
  if (!activeSessions.has(userId)) activeSessions.set(userId, new Map());
  return activeSessions.get(userId)!;
}

// ──────────────────────────────────────────────────────────────────────────────
// Permission check middleware (per route, based on connection's protocol)
// ──────────────────────────────────────────────────────────────────────────────

function requireDbPermission(req: Request, res: Response, next: () => void): void {
  const conn = getConn(req.params['connectionId'] as string, req);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const role = req.user!.role;
  const perm = conn.protocol === 'postgres' ? 'protocols.postgres' : 'protocols.mysql';
  if (!roleHasPermission(role, perm)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }
  (req as Request & { dbConn: ConnRow }).dbConn = conn;
  next();
}

// ──────────────────────────────────────────────────────────────────────────────
// Session management
// ──────────────────────────────────────────────────────────────────────────────

/** POST /api/v1/db/:connectionId/connect */
router.post('/:connectionId/connect', async (req: Request, res: Response) => {
  const { connectionId } = req.params as { connectionId: string };
  const userId = req.user!.userId;

  const conn = getConn(connectionId, req);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const perm = conn.protocol === 'postgres' ? 'protocols.postgres' : 'protocols.mysql';
  if (!roleHasPermission(req.user!.role, perm)) {
    res.status(403).json({ error: 'Insufficient permissions' }); return;
  }

  try {
    const pool = await getPool(connectionId);
    const sessions = getUserSessions(userId);
    // Re-use existing session if already connected
    let sessionId = sessions.get(connectionId);
    if (!sessionId) {
      sessionId = startDbSession(userId, connectionId, conn.protocol);
      sessions.set(connectionId, sessionId);
    }
    logAudit({ userId, eventType: 'db.connect', target: connectionId, details: { protocol: conn.protocol } });
    res.json({ sessionId, defaultDatabase: pool.defaultDatabase, protocol: pool.protocol, rowLimit: pool.rowLimit });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[db] connect error:', message);
    res.status(500).json({ error: `Failed to connect: ${message}` });
  }
});

/** POST /api/v1/db/:connectionId/disconnect */
router.post('/:connectionId/disconnect', async (req: Request, res: Response) => {
  const { connectionId } = req.params as { connectionId: string };
  const userId = req.user!.userId;

  const sessions = getUserSessions(userId);
  const sessionId = sessions.get(connectionId);
  if (sessionId) {
    endDbSession(sessionId);
    sessions.delete(connectionId);
  }
  await releasePool(connectionId);
  logAudit({ userId, eventType: 'db.disconnect', target: connectionId });
  res.json({ ok: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// Schema browsing
// ──────────────────────────────────────────────────────────────────────────────

/** GET /api/v1/db/:connectionId/databases */
router.get('/:connectionId/databases', async (req: Request, res: Response) => {
  const { connectionId } = req.params as { connectionId: string };
  const conn = getConn(connectionId, req);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }
  try {
    const pool = await getPool(connectionId);
    let databases: string[] = [];
    if (pool.protocol === 'postgres') {
      const pgClient = await pool.pgPool!.connect();
      try {
        const result = await pgClient.query(`SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`);
        databases = result.rows.map((r: { datname: string }) => r.datname);
      } finally { pgClient.release(); }
    } else {
      const [rows] = await pool.mysqlPool!.query(`SHOW DATABASES`);
      databases = (rows as Array<{ Database: string }>).map(r => r.Database);
    }
    const sessionId = getUserSessions(req.user!.userId).get(connectionId);
    if (sessionId) recordDbEvent(sessionId, 'schema_browse', 'databases');
    res.json({ databases });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** GET /api/v1/db/:connectionId/schemas?database=name */
router.get('/:connectionId/schemas', async (req: Request, res: Response) => {
  const { connectionId } = req.params as { connectionId: string };
  const conn = getConn(connectionId, req);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }
  try {
    const pool = await getPool(connectionId);
    let schemas: string[] = [];
    if (pool.protocol === 'postgres') {
      const pgClient = await pool.pgPool!.connect();
      try {
        const result = await pgClient.query(
          `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name`,
        );
        schemas = result.rows.map((r: { schema_name: string }) => r.schema_name);
      } finally { pgClient.release(); }
    } else {
      // MySQL: schemas === databases
      const [rows] = await pool.mysqlPool!.query(`SHOW DATABASES`);
      schemas = (rows as Array<{ Database: string }>).map(r => r.Database);
    }
    const sessionId = getUserSessions(req.user!.userId).get(connectionId);
    if (sessionId) recordDbEvent(sessionId, 'schema_browse', 'schemas');
    res.json({ schemas });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** GET /api/v1/db/:connectionId/tables?schema=public */
router.get('/:connectionId/tables', async (req: Request, res: Response) => {
  const { connectionId } = req.params as { connectionId: string };
  const schema = (req.query.schema as string) || 'public';
  const conn = getConn(connectionId, req);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }
  try {
    const pool = await getPool(connectionId);
    let tables: Array<{ name: string; type: string }> = [];
    if (pool.protocol === 'postgres') {
      const pgClient = await pool.pgPool!.connect();
      try {
        const result = await pgClient.query(
          `SELECT table_name, table_type FROM information_schema.tables
           WHERE table_schema = $1 ORDER BY table_name`,
          [schema],
        );
        tables = result.rows.map((r: { table_name: string; table_type: string }) => ({
          name: r.table_name,
          type: r.table_type === 'BASE TABLE' ? 'table' : 'view',
        }));
      } finally { pgClient.release(); }
    } else {
      const db = schema || pool.defaultDatabase;
      const [rows] = await pool.mysqlPool!.query(
        `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
        [db],
      );
      tables = (rows as Array<{ TABLE_NAME: string; TABLE_TYPE: string }>).map(r => ({
        name: r.TABLE_NAME,
        type: r.TABLE_TYPE === 'BASE TABLE' ? 'table' : 'view',
      }));
    }
    const sessionId = getUserSessions(req.user!.userId).get(connectionId);
    if (sessionId) recordDbEvent(sessionId, 'schema_browse', `schemas/${schema}/tables`);
    res.json({ tables });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** GET /api/v1/db/:connectionId/table/:tableName?schema=public */
router.get('/:connectionId/table/:tableName', async (req: Request, res: Response) => {
  const { connectionId, tableName } = req.params as { connectionId: string; tableName: string };
  const schema = (req.query.schema as string) || 'public';
  const conn = getConn(connectionId, req);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }
  try {
    const pool = await getPool(connectionId);
    let columns: Array<{ name: string; type: string; nullable: boolean; isPrimaryKey: boolean }> = [];
    if (pool.protocol === 'postgres') {
      const pgClient = await pool.pgPool!.connect();
      try {
        const result = await pgClient.query(
          `SELECT c.column_name, c.data_type, c.is_nullable,
                  CASE WHEN kcu.column_name IS NOT NULL THEN true ELSE false END AS is_pk
           FROM information_schema.columns c
           LEFT JOIN information_schema.key_column_usage kcu
             ON kcu.table_schema = c.table_schema AND kcu.table_name = c.table_name AND kcu.column_name = c.column_name
           LEFT JOIN information_schema.table_constraints tc
             ON tc.constraint_name = kcu.constraint_name AND tc.constraint_type = 'PRIMARY KEY'
           WHERE c.table_schema = $1 AND c.table_name = $2
           ORDER BY c.ordinal_position`,
          [schema, tableName],
        );
        columns = result.rows.map((r: { column_name: string; data_type: string; is_nullable: string; is_pk: boolean }) => ({
          name: r.column_name,
          type: r.data_type,
          nullable: r.is_nullable === 'YES',
          isPrimaryKey: !!r.is_pk,
        }));
      } finally { pgClient.release(); }
    } else {
      const db = schema || pool.defaultDatabase;
      const [rows] = await pool.mysqlPool!.query(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [db, tableName],
      );
      columns = (rows as Array<{ COLUMN_NAME: string; COLUMN_TYPE: string; IS_NULLABLE: string; COLUMN_KEY: string }>).map(r => ({
        name: r.COLUMN_NAME,
        type: r.COLUMN_TYPE,
        nullable: r.IS_NULLABLE === 'YES',
        isPrimaryKey: r.COLUMN_KEY === 'PRI',
      }));
    }
    const sessionId = getUserSessions(req.user!.userId).get(connectionId);
    if (sessionId) recordDbEvent(sessionId, 'table_inspect', `${schema}/${tableName}`);
    res.json({ tableName, schema, columns });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Query execution
// ──────────────────────────────────────────────────────────────────────────────

/** POST /api/v1/db/:connectionId/query */
router.post('/:connectionId/query', async (req: Request, res: Response) => {
  const { connectionId } = req.params as { connectionId: string };
  const userId = req.user!.userId;
  const conn = getConn(connectionId, req);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const { sql: queryText, page: rawPage } = req.body as { sql?: string; page?: number };
  if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
    res.status(400).json({ error: 'sql is required' }); return;
  }
  const pageNum = Math.max(0, Math.floor(Number(rawPage ?? 0)));

  try {
    const pool = await getPool(connectionId);
    const pageSize = pool.rowLimit;
    const offset = pageNum * pageSize;
    const startTime = Date.now();
    let columns: string[] = [];
    let rows: unknown[][] = [];
    let rowCount = 0;
    let totalRows = 0;
    let totalPages = 0;
    let error: string | undefined;
    let connectionLost = false;

    try {
      if (pool.protocol === 'postgres') {
        const pgPool = pool.pgPool!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let pgClient: any;
        try {
          pgClient = await pgPool.connect();
        } catch (connectErr) {
          error = connectErr instanceof Error ? connectErr.message : String(connectErr);
          connectionLost = true;
          throw connectErr;
        }
        try {
          await pgClient.query(`SET statement_timeout = ${pool.queryTimeoutMs}`);
          const result = await pgClient.query(queryText);
          columns = result.fields.map((f: { name: string }) => f.name);
          if (columns.length > 0) {
            // SELECT — paginate
            const allRows = result.rows as Record<string, unknown>[];
            totalRows = allRows.length;
            totalPages = Math.ceil(totalRows / pageSize) || 1;
            const pageRows = allRows.slice(offset, offset + pageSize);
            rows = pageRows.map(r => columns.map(c => r[c] ?? null));
            rowCount = totalRows;
          } else {
            // DML — affected rows
            rowCount = result.rowCount ?? 0;
          }
        } catch (queryErr) {
          error = queryErr instanceof Error ? queryErr.message : String(queryErr);
        } finally { pgClient.release(); }
      } else {
        try {
          const [result, fields] = await pool.mysqlPool!.query({ sql: queryText, timeout: pool.queryTimeoutMs });
          if (Array.isArray(result)) {
            columns = (fields as Array<{ name: string }> | undefined)?.map(f => f.name) ?? [];
            const allRows = result as Record<string, unknown>[];
            totalRows = allRows.length;
            totalPages = Math.ceil(totalRows / pageSize) || 1;
            const pageRows = allRows.slice(offset, offset + pageSize);
            rows = pageRows.map(r => columns.map(c => r[c] ?? null));
            rowCount = totalRows;
          } else {
            const res2 = result as { affectedRows?: number };
            rowCount = res2.affectedRows ?? 0;
          }
        } catch (mysqlErr) {
          error = mysqlErr instanceof Error ? mysqlErr.message : String(mysqlErr);
          const code = (mysqlErr as NodeJS.ErrnoException).code ?? '';
          if (code.startsWith('E') || code.startsWith('PROTOCOL')) connectionLost = true;
        }
      }
    } catch { /* connection-level error already recorded above */ }

    const durationMs = Date.now() - startTime;

    if (!connectionLost) {
      execute(
        `INSERT INTO db_query_history (id, user_id, connection_id, query_text, row_count, duration_ms, error, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [uuid(), userId, connectionId, queryText.slice(0, 10000), error ? null : rowCount, durationMs, error ?? null],
      );
      const sessionId = getUserSessions(userId).get(connectionId);
      if (sessionId) {
        recordDbEvent(
          sessionId,
          error ? 'query_error' : 'query_execute',
          'query',
          { queryPreview: queryText.slice(0, 200), rowCount, durationMs, error },
        );
      }
    }

    if (connectionLost) {
      await releasePool(connectionId);
      res.status(503).json({ error, connectionLost: true });
      return;
    }

    if (error) {
      res.status(400).json({ error, durationMs });
      return;
    }

    res.json({ columns, rows, rowCount, totalRows, page: pageNum, pageSize, totalPages, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Query history
// ──────────────────────────────────────────────────────────────────────────────

/** GET /api/v1/db/:connectionId/history */
router.get('/:connectionId/history', (req: Request, res: Response) => {
  const { connectionId } = req.params as { connectionId: string };
  const userId = req.user!.userId;
  const conn = getConn(connectionId, req);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const limit = Math.min(parseInt(req.query.limit as string ?? '100', 10) || 100, 500);
  const history = queryAll<{
    id: string;
    query_text: string;
    row_count: number | null;
    duration_ms: number | null;
    error: string | null;
    executed_at: string;
  }>(
    `SELECT id, query_text, row_count, duration_ms, error, executed_at
     FROM db_query_history WHERE user_id = ? AND connection_id = ?
     ORDER BY executed_at DESC LIMIT ?`,
    [userId, connectionId, limit],
  );
  res.json({ history });
});

/** DELETE /api/v1/db/:connectionId/history */
router.delete('/:connectionId/history', (req: Request, res: Response) => {
  const { connectionId } = req.params as { connectionId: string };
  const userId = req.user!.userId;
  const conn = getConn(connectionId, req);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  execute(`DELETE FROM db_query_history WHERE user_id = ? AND connection_id = ?`, [userId, connectionId]);
  res.json({ ok: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────────────────────────────────────

/** POST /api/v1/db/:connectionId/export */
router.post('/:connectionId/export', async (req: Request, res: Response) => {
  const { connectionId } = req.params as { connectionId: string };
  const userId = req.user!.userId;
  const conn = getConn(connectionId, req);
  if (!conn) { res.status(404).json({ error: 'Connection not found' }); return; }

  const { sql: queryText, format } = req.body as { sql?: string; format?: string };
  if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
    res.status(400).json({ error: 'sql is required' }); return;
  }
  const fmt = format === 'json' ? 'json' : 'csv';

  try {
    const pool = await getPool(connectionId);
    let columns: string[] = [];
    let rows: unknown[][] = [];

    if (pool.protocol === 'postgres') {
      const pgClient = await pool.pgPool!.connect();
      try {
        await pgClient.query(`SET statement_timeout = ${pool.queryTimeoutMs}`);
        const result = await pgClient.query(queryText);
        columns = result.fields.map((f: { name: string }) => f.name);
        rows = result.rows.map((r: Record<string, unknown>) => columns.map(c => r[c] ?? null));
      } finally { pgClient.release(); }
    } else {
      const [result, fields] = await pool.mysqlPool!.query({ sql: queryText, timeout: pool.queryTimeoutMs });
      if (Array.isArray(result)) {
        columns = (fields as Array<{ name: string }> | undefined)?.map(f => f.name) ?? [];
        rows = (result as unknown[]).map(r => columns.map(c => (r as Record<string, unknown>)[c] ?? null));
      }
    }

    const sessionId = getUserSessions(userId).get(connectionId);
    if (sessionId) {
      recordDbEvent(sessionId, fmt === 'json' ? 'export_json' : 'export_csv', 'export', {
        rowCount: rows.length,
        format: fmt,
      });
    }

    if (fmt === 'json') {
      const jsonRows = rows.map(row => {
        const obj: Record<string, unknown> = {};
        columns.forEach((c, i) => { obj[c] = row[i]; });
        return obj;
      });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="export.json"`);
      res.send(JSON.stringify(jsonRows, null, 2));
    } else {
      const escape = (v: unknown): string => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const lines = [columns.join(','), ...rows.map(r => r.map(escape).join(','))];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="export.csv"`);
      res.send(lines.join('\n'));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
