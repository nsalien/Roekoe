/**
 * Tiny JSON-file backed data store.
 *
 * For a friends-sized game (~10 players + bots) a single JSON document loaded
 * into memory is more than enough and has zero native dependencies. All game
 * logic goes through this store, so if you ever outgrow it you can swap this
 * one file for a real database (SQLite/Postgres) without touching the engine.
 *
 * Writes are debounced and serialized so overlapping requests never corrupt
 * the file.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { type Database, emptyDatabase } from './schema.js';

export class Store {
  private db: Database;
  private readonly file: string;
  private writeChain: Promise<void> = Promise.resolve();
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string) {
    const dir = isAbsolute(dataDir) ? dataDir : join(process.cwd(), dataDir);
    this.file = join(dir, 'roekoe-db.json');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (existsSync(this.file)) {
      try {
        this.db = JSON.parse(readFileSync(this.file, 'utf8')) as Database;
      } catch (err) {
        console.error('Kon database niet lezen, start met lege database:', err);
        this.db = emptyDatabase();
      }
    } else {
      this.db = emptyDatabase();
    }
  }

  /** Direct access to the in-memory document. Mutate, then call save(). */
  get data(): Database {
    return this.db;
  }

  /**
   * Read/modify the database in a callback and persist the result. Returns
   * whatever the callback returns. Keeps mutation + save together so callers
   * cannot forget to persist.
   */
  mutate<T>(fn: (db: Database) => T): T {
    const result = fn(this.db);
    this.save();
    return result;
  }

  /** Schedule a debounced write to disk. */
  save(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.dirty) this.flush();
    }, 50);
  }

  /** Force an immediate write (used on shutdown). */
  flush(): void {
    this.dirty = false;
    const snapshot = JSON.stringify(this.db, null, 2);
    // Serialize writes and use a temp-file + rename for atomicity.
    this.writeChain = this.writeChain.then(() => {
      const tmp = this.file + '.tmp';
      const dir = dirname(this.file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(tmp, snapshot);
      renameSync(tmp, this.file);
    });
  }
}

// A small id helper used across the codebase.
export function newId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
