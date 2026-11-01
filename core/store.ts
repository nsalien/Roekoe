/**
 * Runtime-neutral store abstraction.
 *
 * The game engine works against this tiny interface: it reads/mutates an
 * in-memory `Database` object and never talks to a real datastore directly.
 * Concrete implementations (a D1-backed store for Cloudflare, or an in-memory
 * one for tests) load the world, let the engine mutate it synchronously, then
 * persist it. This is what lets the exact same game logic run on the Workers
 * runtime and in a plain Node test.
 */

import type { Database } from './schema.js';

export interface Store {
  /** The in-memory world. Mutate it, then the caller persists. */
  readonly data: Database;
  /** Run a function against the world and return its result. */
  mutate<T>(fn: (db: Database) => T): T;
}

/** A simple in-memory store, handy for tests and as a base for adapters. */
export class MemoryStore implements Store {
  constructor(private db: Database) {}
  get data(): Database {
    return this.db;
  }
  mutate<T>(fn: (db: Database) => T): T {
    return fn(this.db);
  }
}

/** Collision-resistant id helper used across the codebase. */
export function newId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
