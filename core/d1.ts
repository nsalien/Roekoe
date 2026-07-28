/**
 * D1-backed store.
 *
 * Loads the entire (small) world into an in-memory `Database` so the existing
 * synchronous game engine can run against it untouched, then persists only the
 * rows that actually changed. Because we diff per-row, two players acting on
 * different pigeons/lofts in the same instant don't overwrite each other.
 *
 * The world is tiny (a handful of players + bots), so loading it per request is
 * cheap. If it ever grows, this file is the single place to make persistence
 * smarter.
 */

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type {
  BreedingPair,
  Database,
  Flight,
  Loft,
  Pigeon,
  User,
} from './schema.js';
import { emptyDatabase } from './schema.js';
import type { Store } from './store.js';

const b = (v: unknown) => (v ? 1 : 0);

function rowToUser(r: any): User {
  return {
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    isAdmin: !!r.is_admin,
    isBot: !!r.is_bot,
    createdAt: r.created_at,
  };
}
function rowToLoft(r: any): Loft {
  return {
    userId: r.user_id,
    name: r.name,
    money: r.money,
    food: r.food,
    feedRation: r.feed_ration,
    capacity: r.capacity,
    seasonPoints: r.season_points,
    totalWins: r.total_wins,
    isBot: !!r.is_bot,
  };
}
function rowToPigeon(r: any): Pigeon {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    sex: r.sex,
    birthWeek: r.birth_week,
    speed: r.speed,
    endurance: r.endurance,
    orientation: r.orientation,
    form: r.form,
    health: r.health,
    experience: r.experience,
    sireId: r.sire_id,
    damId: r.dam_id,
    forSale: !!r.for_sale,
    price: r.price,
    createdAtWeek: r.created_at_week,
    retired: !!r.retired,
  };
}
function rowToBreeding(r: any): BreedingPair {
  return {
    id: r.id,
    ownerId: r.owner_id,
    sireId: r.sire_id,
    damId: r.dam_id,
    hatchWeek: r.hatch_week,
    createdAtWeek: r.created_at_week,
  };
}
function rowToFlight(r: any): Flight {
  return {
    id: r.id,
    week: r.week,
    templateKey: r.template_key,
    name: r.name,
    type: r.type,
    distanceKm: r.distance_km,
    entryFee: r.entry_fee,
    status: r.status,
    entries: JSON.parse(r.entries || '[]'),
    weather: r.weather,
    weatherFactor: r.weather_factor,
    results: JSON.parse(r.results || '[]'),
    createdAt: r.created_at,
  };
}

export class D1Store implements Store {
  private constructor(
    private readonly db: D1Database,
    private readonly world: Database,
    private readonly snapshots: Record<string, Map<string, string>>,
    private readonly worldExisted: boolean,
  ) {}

  get data(): Database {
    return this.world;
  }

  mutate<T>(fn: (db: Database) => T): T {
    return fn(this.world);
  }

  static async load(db: D1Database): Promise<D1Store> {
    const worldRow = (await db.prepare('SELECT * FROM world WHERE id = 1').first()) as any;
    const dbObj = emptyDatabase();
    let worldExisted = false;
    if (worldRow) {
      worldExisted = true;
      dbObj.world = {
        currentWeek: worldRow.current_week,
        seasonYear: worldRow.season_year,
        seeded: !!worldRow.seeded,
      };
    }

    const [users, lofts, pigeons, breeding, flights] = await Promise.all([
      db.prepare('SELECT * FROM users').all(),
      db.prepare('SELECT * FROM lofts').all(),
      db.prepare('SELECT * FROM pigeons').all(),
      db.prepare('SELECT * FROM breeding_pairs').all(),
      db.prepare('SELECT * FROM flights').all(),
    ]);

    dbObj.users = (users.results as any[]).map(rowToUser);
    dbObj.lofts = (lofts.results as any[]).map(rowToLoft);
    dbObj.pigeons = (pigeons.results as any[]).map(rowToPigeon);
    dbObj.breedingPairs = (breeding.results as any[]).map(rowToBreeding);
    dbObj.flights = (flights.results as any[]).map(rowToFlight);

    const snapshots: Record<string, Map<string, string>> = {
      users: snapshot(dbObj.users, (u) => u.id),
      lofts: snapshot(dbObj.lofts, (l) => l.userId),
      pigeons: snapshot(dbObj.pigeons, (p) => p.id),
      breedingPairs: snapshot(dbObj.breedingPairs, (bp) => bp.id),
      flights: snapshot(dbObj.flights, (f) => f.id),
    };

    return new D1Store(db, dbObj, snapshots, worldExisted);
  }

  /** Write back only what changed. */
  async persist(): Promise<void> {
    const db = this.db;
    const w = this.world;
    const stmts: D1PreparedStatement[] = [];

    const wd = w.world;
    if (!this.worldExisted) {
      stmts.push(
        db.prepare('INSERT INTO world (id, current_week, season_year, seeded, version) VALUES (1, ?, ?, ?, 1)')
          .bind(wd.currentWeek, wd.seasonYear, b(wd.seeded)),
      );
    } else {
      stmts.push(
        db.prepare('UPDATE world SET current_week = ?, season_year = ?, seeded = ?, version = version + 1 WHERE id = 1')
          .bind(wd.currentWeek, wd.seasonYear, b(wd.seeded)),
      );
    }

    diff(this.snapshots.users, w.users, (u) => u.id, {
      upsert: (u) =>
        db.prepare(
          'INSERT OR REPLACE INTO users (id, username, password_hash, is_admin, is_bot, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(u.id, u.username, u.passwordHash, b(u.isAdmin), b(u.isBot), u.createdAt),
      del: (id) => db.prepare('DELETE FROM users WHERE id = ?').bind(id),
      stmts,
    });

    diff(this.snapshots.lofts, w.lofts, (l) => l.userId, {
      upsert: (l) =>
        db.prepare(
          'INSERT OR REPLACE INTO lofts (user_id, name, money, food, feed_ration, capacity, season_points, total_wins, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(l.userId, l.name, l.money, l.food, l.feedRation, l.capacity, l.seasonPoints, l.totalWins, b(l.isBot)),
      del: (id) => db.prepare('DELETE FROM lofts WHERE user_id = ?').bind(id),
      stmts,
    });

    diff(this.snapshots.pigeons, w.pigeons, (p) => p.id, {
      upsert: (p) =>
        db.prepare(
          'INSERT OR REPLACE INTO pigeons (id, owner_id, name, sex, birth_week, speed, endurance, orientation, form, health, experience, sire_id, dam_id, for_sale, price, created_at_week, retired) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          p.id, p.ownerId, p.name, p.sex, p.birthWeek, p.speed, p.endurance, p.orientation, p.form, p.health,
          p.experience, p.sireId, p.damId, b(p.forSale), p.price, p.createdAtWeek, b(p.retired),
        ),
      del: (id) => db.prepare('DELETE FROM pigeons WHERE id = ?').bind(id),
      stmts,
    });

    diff(this.snapshots.breedingPairs, w.breedingPairs, (bp) => bp.id, {
      upsert: (bp) =>
        db.prepare(
          'INSERT OR REPLACE INTO breeding_pairs (id, owner_id, sire_id, dam_id, hatch_week, created_at_week) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(bp.id, bp.ownerId, bp.sireId, bp.damId, bp.hatchWeek, bp.createdAtWeek),
      del: (id) => db.prepare('DELETE FROM breeding_pairs WHERE id = ?').bind(id),
      stmts,
    });

    diff(this.snapshots.flights, w.flights, (f) => f.id, {
      upsert: (f) =>
        db.prepare(
          'INSERT OR REPLACE INTO flights (id, week, template_key, name, type, distance_km, entry_fee, status, entries, weather, weather_factor, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          f.id, f.week, f.templateKey, f.name, f.type, f.distanceKm, f.entryFee, f.status,
          JSON.stringify(f.entries), f.weather, f.weatherFactor, JSON.stringify(f.results), f.createdAt,
        ),
      del: (id) => db.prepare('DELETE FROM flights WHERE id = ?').bind(id),
      stmts,
    });

    if (stmts.length > 0) await db.batch(stmts);
  }
}

function snapshot<T>(items: T[], key: (t: T) => string): Map<string, string> {
  const m = new Map<string, string>();
  for (const it of items) m.set(key(it), JSON.stringify(it));
  return m;
}

function diff<T>(
  snap: Map<string, string>,
  current: T[],
  key: (t: T) => string,
  ops: { upsert: (t: T) => D1PreparedStatement; del: (id: string) => D1PreparedStatement; stmts: D1PreparedStatement[] },
): void {
  const seen = new Set<string>();
  for (const it of current) {
    const id = key(it);
    seen.add(id);
    const json = JSON.stringify(it);
    if (snap.get(id) !== json) ops.stmts.push(ops.upsert(it));
  }
  for (const id of snap.keys()) {
    if (!seen.has(id)) ops.stmts.push(ops.del(id));
  }
}
