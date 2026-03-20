import { getDb } from './index.js';

/**
 * Run a SELECT query and return results as an array of objects.
 */
export function queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);

  const results: T[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push(row as T);
  }
  stmt.free();
  return results;
}

/**
 * Run a SELECT query and return the first result as an object, or undefined.
 */
export function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const db = getDb();
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);

  let result: T | undefined;
  if (stmt.step()) {
    result = stmt.getAsObject() as T;
  }
  stmt.free();
  return result;
}

/**
 * Run an INSERT/UPDATE/DELETE statement.
 */
export function execute(sql: string, params: unknown[] = []): void {
  const db = getDb();
  db.run(sql, params);
}

/**
 * Get the number of rows changed by the last statement.
 */
export function getChanges(): number {
  const db = getDb();
  const result = db.exec('SELECT changes()');
  return result.length > 0 ? (result[0].values[0][0] as number) : 0;
}
