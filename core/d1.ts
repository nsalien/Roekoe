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
  Auction,
  BreedingPair,
  Database,
  Flight,
  Loft,
  Notification,
  Pigeon,
  Trade,
  User,
} from './schema.js';
import { emptyDatabase, emptyStats } from './schema.js';
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
    infirmaryCapacity: r.infirmary_capacity ?? 4,
    medicatedFood: !!r.medicated_food,
    doctors: r.doctors ?? 0,
    physios: r.physios ?? 0,
    xp: r.xp ?? 0,
    level: r.level ?? 1,
    stats: r.stats ? { ...emptyStats(), ...JSON.parse(r.stats) } : emptyStats(),
    badges: r.badges ? JSON.parse(r.badges) : [],
    missions: r.missions ? JSON.parse(r.missions) : [],
    missionsDay: r.missions_day ?? '',
    streak: r.streak ?? 0,
    pendingEvent: r.pending_event ? JSON.parse(r.pending_event) : null,
    sponsorId: r.sponsor_id || null,
    sponsorSince: r.sponsor_since ?? '',
    sponsorsSigned: r.sponsors_signed ? JSON.parse(r.sponsors_signed) : [],
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
    libido: r.libido ?? 50,
    form: r.form,
    health: r.health,
    experience: r.experience,
    sireId: r.sire_id,
    damId: r.dam_id,
    forSale: !!r.for_sale,
    price: r.price,
    createdAtWeek: r.created_at_week,
    retired: !!r.retired,
    ailment: r.ailment ? JSON.parse(r.ailment) : null,
    inInfirmary: !!r.in_infirmary,
    races: r.races ?? 0,
    everAiled: !!r.ever_ailed,
  };
}
function rowToBreeding(r: any): BreedingPair {
  return {
    id: r.id,
    ownerId: r.owner_id,
    sireId: r.sire_id,
    damId: r.dam_id,
    hatchWeek: r.hatch_week,
    hatchAt: r.hatch_at ?? '',
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
    fromCity: r.from_city ?? '',
    toCity: r.to_city ?? '',
    startAt: r.start_at ?? '',
    status: r.status,
    entries: JSON.parse(r.entries || '[]'),
    sim: JSON.parse(r.sim || '[]'),
    weather: r.weather,
    weatherFactor: r.weather_factor,
    results: JSON.parse(r.results || '[]'),
    recap: r.recap ?? '',
    createdAt: r.created_at,
  };
}
function rowToNotification(r: any): Notification {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    flightId: r.flight_id ?? null,
    createdAt: r.created_at,
    read: !!r.read,
  };
}
function rowToAuction(r: any): Auction {
  return {
    id: r.id,
    templateKey: r.template_key,
    pigeonId: r.pigeon_id,
    startAt: r.start_at,
    endAt: r.end_at,
    minBid: r.min_bid,
    minIncrement: r.min_increment,
    currentBid: r.current_bid,
    currentBidderId: r.current_bidder_id ?? null,
    currentBidderName: r.current_bidder_name ?? null,
    status: r.status,
  };
}
function rowToTrade(r: any): Trade {
  return {
    id: r.id,
    pigeonId: r.pigeon_id,
    pigeonName: r.pigeon_name,
    sellerId: r.seller_id,
    sellerName: r.seller_name,
    buyerId: r.buyer_id,
    buyerName: r.buyer_name,
    price: r.price,
    at: r.at,
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
        dataVersion: worldRow.data_version ?? 0,
        lastDailyTick: worldRow.last_daily_tick ?? '',
        lastShelterSpawn: worldRow.last_shelter_spawn ?? '',
      };
    }

    const [users, lofts, pigeons, breeding, flights, notifications, trades, auctions] = await Promise.all([
      db.prepare('SELECT * FROM users').all(),
      db.prepare('SELECT * FROM lofts').all(),
      db.prepare('SELECT * FROM pigeons').all(),
      db.prepare('SELECT * FROM breeding_pairs').all(),
      db.prepare('SELECT * FROM flights').all(),
      db.prepare('SELECT * FROM notifications').all(),
      db.prepare('SELECT * FROM trades').all(),
      db.prepare('SELECT * FROM auctions').all(),
    ]);

    dbObj.users = (users.results as any[]).map(rowToUser);
    dbObj.lofts = (lofts.results as any[]).map(rowToLoft);
    dbObj.pigeons = (pigeons.results as any[]).map(rowToPigeon);
    dbObj.breedingPairs = (breeding.results as any[]).map(rowToBreeding);
    dbObj.flights = (flights.results as any[]).map(rowToFlight);
    dbObj.notifications = (notifications.results as any[]).map(rowToNotification);
    dbObj.trades = (trades.results as any[]).map(rowToTrade);
    dbObj.auctions = (auctions.results as any[]).map(rowToAuction);

    const snapshots: Record<string, Map<string, string>> = {
      users: snapshot(dbObj.users, (u) => u.id),
      lofts: snapshot(dbObj.lofts, (l) => l.userId),
      pigeons: snapshot(dbObj.pigeons, (p) => p.id),
      breedingPairs: snapshot(dbObj.breedingPairs, (bp) => bp.id),
      flights: snapshot(dbObj.flights, (f) => f.id),
      notifications: snapshot(dbObj.notifications, (nt) => nt.id),
      trades: snapshot(dbObj.trades, (t) => t.id),
      auctions: snapshot(dbObj.auctions, (a) => a.id),
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
        db.prepare('INSERT INTO world (id, current_week, season_year, seeded, data_version, last_daily_tick, last_shelter_spawn, version) VALUES (1, ?, ?, ?, ?, ?, ?, 1)')
          .bind(wd.currentWeek, wd.seasonYear, b(wd.seeded), wd.dataVersion ?? 0, wd.lastDailyTick ?? '', wd.lastShelterSpawn ?? ''),
      );
    } else {
      stmts.push(
        db.prepare('UPDATE world SET current_week = ?, season_year = ?, seeded = ?, data_version = ?, last_daily_tick = ?, last_shelter_spawn = ?, version = version + 1 WHERE id = 1')
          .bind(wd.currentWeek, wd.seasonYear, b(wd.seeded), wd.dataVersion ?? 0, wd.lastDailyTick ?? '', wd.lastShelterSpawn ?? ''),
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
          'INSERT OR REPLACE INTO lofts (user_id, name, money, food, feed_ration, capacity, season_points, total_wins, is_bot, infirmary_capacity, medicated_food, doctors, physios, xp, level, stats, badges, missions, missions_day, streak, pending_event, sponsor_id, sponsor_since, sponsors_signed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          l.userId, l.name, l.money, l.food, l.feedRation, l.capacity, l.seasonPoints, l.totalWins, b(l.isBot),
          l.infirmaryCapacity, b(l.medicatedFood), l.doctors, l.physios,
          l.xp, l.level, JSON.stringify(l.stats), JSON.stringify(l.badges),
          JSON.stringify(l.missions ?? []), l.missionsDay ?? '', l.streak ?? 0,
          l.pendingEvent ? JSON.stringify(l.pendingEvent) : '',
          l.sponsorId ?? null, l.sponsorSince ?? '', JSON.stringify(l.sponsorsSigned ?? []),
        ),
      del: (id) => db.prepare('DELETE FROM lofts WHERE user_id = ?').bind(id),
      stmts,
    });

    diff(this.snapshots.pigeons, w.pigeons, (p) => p.id, {
      upsert: (p) =>
        db.prepare(
          'INSERT OR REPLACE INTO pigeons (id, owner_id, name, sex, birth_week, speed, endurance, orientation, libido, form, health, experience, sire_id, dam_id, for_sale, price, created_at_week, retired, ailment, in_infirmary, races, ever_ailed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          p.id, p.ownerId, p.name, p.sex, p.birthWeek, p.speed, p.endurance, p.orientation, p.libido, p.form, p.health,
          p.experience, p.sireId, p.damId, b(p.forSale), p.price, p.createdAtWeek, b(p.retired),
          p.ailment ? JSON.stringify(p.ailment) : '', b(p.inInfirmary), p.races, b(p.everAiled),
        ),
      del: (id) => db.prepare('DELETE FROM pigeons WHERE id = ?').bind(id),
      stmts,
    });

    diff(this.snapshots.breedingPairs, w.breedingPairs, (bp) => bp.id, {
      upsert: (bp) =>
        db.prepare(
          'INSERT OR REPLACE INTO breeding_pairs (id, owner_id, sire_id, dam_id, hatch_week, hatch_at, created_at_week) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).bind(bp.id, bp.ownerId, bp.sireId, bp.damId, bp.hatchWeek, bp.hatchAt, bp.createdAtWeek),
      del: (id) => db.prepare('DELETE FROM breeding_pairs WHERE id = ?').bind(id),
      stmts,
    });

    diff(this.snapshots.flights, w.flights, (f) => f.id, {
      upsert: (f) =>
        db.prepare(
          'INSERT OR REPLACE INTO flights (id, week, template_key, name, type, distance_km, entry_fee, from_city, to_city, start_at, status, entries, sim, weather, weather_factor, results, recap, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          f.id, f.week, f.templateKey, f.name, f.type, f.distanceKm, f.entryFee,
          f.fromCity, f.toCity, f.startAt, f.status,
          JSON.stringify(f.entries), JSON.stringify(f.sim), f.weather, f.weatherFactor,
          JSON.stringify(f.results), f.recap, f.createdAt,
        ),
      del: (id) => db.prepare('DELETE FROM flights WHERE id = ?').bind(id),
      stmts,
    });

    diff(this.snapshots.notifications, w.notifications, (nt) => nt.id, {
      upsert: (nt) =>
        db.prepare(
          'INSERT OR REPLACE INTO notifications (id, user_id, kind, title, body, flight_id, created_at, read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(nt.id, nt.userId, nt.kind, nt.title, nt.body, nt.flightId, nt.createdAt, b(nt.read)),
      del: (id) => db.prepare('DELETE FROM notifications WHERE id = ?').bind(id),
      stmts,
    });

    diff(this.snapshots.trades, w.trades, (t) => t.id, {
      upsert: (t) =>
        db.prepare(
          'INSERT OR REPLACE INTO trades (id, pigeon_id, pigeon_name, seller_id, seller_name, buyer_id, buyer_name, price, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(t.id, t.pigeonId, t.pigeonName, t.sellerId, t.sellerName, t.buyerId, t.buyerName, t.price, t.at),
      del: (id) => db.prepare('DELETE FROM trades WHERE id = ?').bind(id),
      stmts,
    });

    diff(this.snapshots.auctions, w.auctions, (a) => a.id, {
      upsert: (a) =>
        db.prepare(
          'INSERT OR REPLACE INTO auctions (id, template_key, pigeon_id, start_at, end_at, min_bid, min_increment, current_bid, current_bidder_id, current_bidder_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(a.id, a.templateKey, a.pigeonId, a.startAt, a.endAt, a.minBid, a.minIncrement, a.currentBid, a.currentBidderId, a.currentBidderName, a.status),
      del: (id) => db.prepare('DELETE FROM auctions WHERE id = ?').bind(id),
      stmts,
    });

    if (stmts.length > 0) await db.batch(stmts);
  }
}

/**
 * Idempotent schema top-up. The base tables come from migrations/0001; this
 * adds columns introduced later so existing databases upgrade themselves on
 * deploy (no manual SQL needed). Safe to call on every cold start.
 */
export async function ensureSchema(db: D1Database): Promise<void> {
  const alters = [
    "ALTER TABLE flights ADD COLUMN from_city TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE flights ADD COLUMN to_city TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE flights ADD COLUMN start_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE flights ADD COLUMN sim TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE flights ADD COLUMN recap TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE world ADD COLUMN data_version INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE world ADD COLUMN last_daily_tick TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE breeding_pairs ADD COLUMN hatch_at TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE pigeons ADD COLUMN libido REAL NOT NULL DEFAULT 50',
    "ALTER TABLE pigeons ADD COLUMN ailment TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE pigeons ADD COLUMN in_infirmary INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE lofts ADD COLUMN infirmary_capacity INTEGER NOT NULL DEFAULT 4',
    'ALTER TABLE lofts ADD COLUMN medicated_food INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE lofts ADD COLUMN doctors INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE lofts ADD COLUMN physios INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE lofts ADD COLUMN xp INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE lofts ADD COLUMN level INTEGER NOT NULL DEFAULT 1',
    "ALTER TABLE lofts ADD COLUMN stats TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE lofts ADD COLUMN badges TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE pigeons ADD COLUMN races INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pigeons ADD COLUMN ever_ailed INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE lofts ADD COLUMN missions TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE lofts ADD COLUMN missions_day TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE lofts ADD COLUMN streak INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE lofts ADD COLUMN pending_event TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE lofts ADD COLUMN sponsor_id TEXT",
    "ALTER TABLE lofts ADD COLUMN sponsor_since TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE lofts ADD COLUMN sponsors_signed TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE world ADD COLUMN last_shelter_spawn TEXT NOT NULL DEFAULT ''",
  ];
  for (const sql of alters) {
    try {
      await db.exec(sql);
    } catch {
      // Column already exists — nothing to do.
    }
  }
  // Notifications inbox (introduced with real-time results). Create if missing.
  try {
    await db.exec(
      'CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, flight_id TEXT, created_at TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0)',
    );
  } catch {
    // Already exists.
  }
  try {
    await db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id)');
  } catch {
    // Already exists.
  }
  // Market buy/sell history (introduced with the player-only market).
  try {
    await db.exec(
      'CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, pigeon_id TEXT NOT NULL, pigeon_name TEXT NOT NULL, seller_id TEXT NOT NULL, seller_name TEXT NOT NULL, buyer_id TEXT NOT NULL, buyer_name TEXT NOT NULL, price INTEGER NOT NULL, at TEXT NOT NULL)',
    );
  } catch {
    // Already exists.
  }
  // Weekly auctions.
  try {
    await db.exec(
      'CREATE TABLE IF NOT EXISTS auctions (id TEXT PRIMARY KEY, template_key TEXT NOT NULL, pigeon_id TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL, min_bid INTEGER NOT NULL, min_increment INTEGER NOT NULL, current_bid INTEGER NOT NULL DEFAULT 0, current_bidder_id TEXT, current_bidder_name TEXT, status TEXT NOT NULL)',
    );
  } catch {
    // Already exists.
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
