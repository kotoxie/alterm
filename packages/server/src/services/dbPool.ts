import pg from 'pg';
import mysql from 'mysql2/promise';
import { queryOne } from '../db/helpers.js';
import { decrypt } from './encryption.js';
import { getSetting } from './settings.js';

interface ConnRow {
  id: string;
  host: string;
  port: number;
  username: string;
  encrypted_password: string | null;
  protocol: 'postgres' | 'mysql';
  extra_config_json: string | null;
}

interface DbExtraConfig {
  defaultDatabase?: string;
  sslMode?: string;
  rowLimit?: number;
  queryTimeout?: number;
  idleTimeoutMinutes?: number;
}

export interface PoolWrapper {
  protocol: 'postgres' | 'mysql';
  pgPool?: pg.Pool;
  mysqlPool?: mysql.Pool;
  defaultDatabase: string;
  rowLimit: number;
  queryTimeoutMs: number;
  lastActivity: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const pools = new Map<string, PoolWrapper>();

function getIdleTimeoutMs(extra: DbExtraConfig): number {
  const fromExtra = extra.idleTimeoutMinutes;
  if (typeof fromExtra === 'number' && fromExtra > 0) return fromExtra * 60 * 1000;
  const global = parseInt(getSetting('db.idle_timeout_minutes') ?? '10', 10);
  return (isNaN(global) || global <= 0 ? 10 : global) * 60 * 1000;
}

function getRowLimit(extra: DbExtraConfig): number {
  if (typeof extra.rowLimit === 'number' && extra.rowLimit > 0) return extra.rowLimit;
  const global = parseInt(getSetting('db.default_row_limit') ?? '1000', 10);
  return isNaN(global) || global <= 0 ? 1000 : global;
}

function getQueryTimeoutMs(extra: DbExtraConfig): number {
  if (typeof extra.queryTimeout === 'number' && extra.queryTimeout > 0) return extra.queryTimeout;
  const global = parseInt(getSetting('db.query_timeout_ms') ?? '30000', 10);
  return isNaN(global) || global <= 0 ? 30000 : global;
}

function getMaxConnections(): number {
  const global = parseInt(getSetting('db.max_pool_connections') ?? '5', 10);
  return isNaN(global) || global <= 0 ? 5 : global;
}

function scheduleIdleRelease(connectionId: string, idleMs: number): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    releasePool(connectionId).catch(() => {});
  }, idleMs);
}

/**
 * Get (or create) a pool for the given connectionId.
 * Throws if the connection is not found or is not a DB protocol.
 */
export async function getPool(connectionId: string): Promise<PoolWrapper> {
  const existing = pools.get(connectionId);
  if (existing) {
    existing.lastActivity = Date.now();
    if (existing.idleTimer) clearTimeout(existing.idleTimer);
    const idleMs = getIdleTimeoutMs({});
    existing.idleTimer = scheduleIdleRelease(connectionId, idleMs);
    return existing;
  }

  const conn = queryOne<ConnRow>(
    `SELECT id, host, port, username, encrypted_password, protocol, extra_config_json
     FROM connections WHERE id = ?`,
    [connectionId],
  );
  if (!conn) throw new Error('Connection not found');
  if (conn.protocol !== 'postgres' && conn.protocol !== 'mysql') {
    throw new Error(`Protocol '${conn.protocol}' is not a database protocol`);
  }

  const extra: DbExtraConfig = conn.extra_config_json
    ? (() => { try { return JSON.parse(conn.extra_config_json!) as DbExtraConfig; } catch { return {}; } })()
    : {};

  if (!extra.defaultDatabase) throw new Error('defaultDatabase is required in connection config');

  const password = conn.encrypted_password
    ? (() => { try { return decrypt(conn.encrypted_password!); } catch { return ''; } })()
    : '';

  const maxConnections = getMaxConnections();
  const rowLimit = getRowLimit(extra);
  const queryTimeoutMs = getQueryTimeoutMs(extra);
  const idleMs = getIdleTimeoutMs(extra);

  let wrapper: PoolWrapper;

  if (conn.protocol === 'postgres') {
    const sslMode = extra.sslMode ?? 'disable';
    const pgPool = new pg.Pool({
      host: conn.host,
      port: conn.port,
      user: conn.username,
      password,
      database: extra.defaultDatabase,
      max: maxConnections,
      idleTimeoutMillis: idleMs,
      connectionTimeoutMillis: Math.min(queryTimeoutMs, 10000),
      ssl: sslMode === 'disable' ? false : { rejectUnauthorized: sslMode === 'verify-full' || sslMode === 'verify-ca' },
    });
    wrapper = {
      protocol: 'postgres',
      pgPool,
      defaultDatabase: extra.defaultDatabase,
      rowLimit,
      queryTimeoutMs,
      lastActivity: Date.now(),
      idleTimer: null,
    };
  } else {
    const sslMode = extra.sslMode ?? 'disable';
    const mysqlPool = mysql.createPool({
      host: conn.host,
      port: conn.port,
      user: conn.username,
      password,
      database: extra.defaultDatabase,
      connectionLimit: maxConnections,
      connectTimeout: Math.min(queryTimeoutMs, 10000),
      ssl: sslMode !== 'disable' ? { rejectUnauthorized: sslMode === 'verify-full' || sslMode === 'verify-ca' } : undefined,
      waitForConnections: true,
      queueLimit: 0,
    });
    wrapper = {
      protocol: 'mysql',
      mysqlPool,
      defaultDatabase: extra.defaultDatabase,
      rowLimit,
      queryTimeoutMs,
      lastActivity: Date.now(),
      idleTimer: null,
    };
  }

  wrapper.idleTimer = scheduleIdleRelease(connectionId, idleMs);
  pools.set(connectionId, wrapper);
  return wrapper;
}

/**
 * Gracefully end and remove a pool for the given connectionId.
 */
export async function releasePool(connectionId: string): Promise<void> {
  const wrapper = pools.get(connectionId);
  if (!wrapper) return;
  if (wrapper.idleTimer) clearTimeout(wrapper.idleTimer);
  pools.delete(connectionId);
  try {
    if (wrapper.pgPool) await wrapper.pgPool.end();
    if (wrapper.mysqlPool) await wrapper.mysqlPool.end();
  } catch {
    // best effort — pool may already be closed
  }
}

/** Check if a pool is currently active for a connection. */
export function hasPool(connectionId: string): boolean {
  return pools.has(connectionId);
}

/** Release all active pools (called on server shutdown). */
export async function releaseAllPools(): Promise<void> {
  const ids = [...pools.keys()];
  await Promise.allSettled(ids.map((id) => releasePool(id)));
}
