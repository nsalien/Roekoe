/**
 * A D1-shaped wrapper around sql.js (SQLite compiled to wasm), so the real API
 * (functions/api/[[path]].ts) and core/d1.ts run unchanged in the browser.
 *
 * Only the surface core/d1.ts uses is implemented: prepare/bind/first/all/run,
 * batch and exec. The tests do the same with node:sqlite (see
 * tests/d1-partial-load.test.mts); this is that shim for the browser.
 */

import type { Database as SqlDatabase, SqlValue } from 'sql.js';

function toSql(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  return String(v);
}

class Statement {
  private params: SqlValue[] = [];
  constructor(private sql: SqlDatabase, readonly query: string) {}

  bind(...args: unknown[]): Statement {
    this.params = args.map(toSql);
    return this;
  }

  private rows(): Record<string, SqlValue>[] {
    const stmt = this.sql.prepare(this.query);
    try {
      stmt.bind(this.params);
      const out: Record<string, SqlValue>[] = [];
      while (stmt.step()) out.push(stmt.getAsObject());
      return out;
    } finally {
      stmt.free();
    }
  }

  async first(column?: string): Promise<any> {
    const row = this.rows()[0];
    if (!row) return null;
    return column ? row[column] ?? null : row;
  }

  async all(): Promise<{ results: any[]; success: true; meta: { changes: number } }> {
    return { results: this.rows(), success: true, meta: { changes: 0 } };
  }

  runSync(): { success: true; meta: { changes: number } } {
    this.sql.run(this.query, this.params);
    return { success: true, meta: { changes: this.sql.getRowsModified() } };
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    return this.runSync();
  }
}

export class DemoD1 {
  constructor(readonly sql: SqlDatabase) {}

  prepare(query: string): Statement {
    return new Statement(this.sql, query);
  }

  /** D1 runs a batch as one transaction; so do we. */
  async batch(stmts: Statement[]): Promise<{ success: true; meta: { changes: number } }[]> {
    this.sql.run('BEGIN');
    try {
      const out = stmts.map((s) => s.runSync());
      this.sql.run('COMMIT');
      return out;
    } catch (err) {
      this.sql.run('ROLLBACK');
      throw err;
    }
  }

  async exec(query: string): Promise<{ count: number }> {
    this.sql.exec(query);
    return { count: 1 };
  }
}
