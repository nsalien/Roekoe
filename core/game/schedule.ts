/**
 * Real-time flight scheduling and lifecycle.
 *
 * Flights are placed on a calendar at real wall-clock times (Europe/Brussels).
 * Bots auto-enter as soon as a flight is created. On every request the API
 * calls `advanceRealtime`, which:
 *   - keeps the next few days of flights on the calendar,
 *   - starts flights whose time has come (freezing the simulation), and
 *   - finalizes flights once every bird is home (awarding points + prizes).
 *
 * Because start/finish are derived purely from timestamps, no background worker
 * is needed — it all happens lazily when someone loads the game.
 */

import {
  HOME_CITY,
  RACE_RELEASES,
  REAL_SCHEDULE,
  SCHEDULE_HORIZON_DAYS,
  TIMEZONE,
  type RaceRelease,
} from '../config/gameConfig.js';
import type { Database, Flight } from '../schema.js';
import { newId } from '../store.js';
import { applyFlightEffects, finalizeFlight, flightTotalSeconds, startLiveFlight, type Entry } from './flight.js';
import { generatePigeonName, isLegacyName } from './names.js';
import { canRace, talent } from './pigeon.js';
import { ownerName } from './engine.js';

// --- Time-zone helpers -----------------------------------------------------

interface Parts { y: number; m: number; d: number; }

function tzDateParts(tz: string, atMs: number): Parts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(atMs))) map[p.type] = p.value;
  return { y: +map.year, m: +map.month, d: +map.day };
}

/** Milliseconds `tz` is ahead of UTC at the given instant. */
function tzOffsetMs(tz: string, atMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(atMs))) map[p.type] = p.value;
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  return asUTC - atMs;
}

/** Convert a wall-clock time in `tz` to a UTC epoch millisecond value. */
function wallToUtcMs(tz: string, y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  return guess - tzOffsetMs(tz, guess);
}

// --- Scheduling ------------------------------------------------------------

function makeRealtimeFlight(templateKey: string, release: RaceRelease, startMs: number, week: number): Flight {
  return {
    id: newId('flt'),
    week,
    templateKey,
    name: release.name,
    type: release.type,
    distanceKm: release.distanceKm,
    entryFee: release.entryFee,
    fromCity: release.city,
    toCity: HOME_CITY,
    startAt: new Date(startMs).toISOString(),
    status: 'scheduled',
    entries: [],
    sim: [],
    weather: '',
    weatherFactor: 1,
    results: [],
    createdAt: new Date().toISOString(),
  };
}

/** Each bot enters its 1-2 best rested birds into a freshly-created flight. */
function botsEnterFlight(db: Database, flight: Flight): void {
  const week = db.world.currentWeek;
  const day = flight.startAt.slice(0, 10); // one race per bird per day
  const committed = new Set<string>(
    db.flights
      .filter((f) => f.status !== 'completed' && f.startAt.slice(0, 10) === day)
      .flatMap((f) => f.entries.map((e) => e.pigeonId)),
  );
  for (const loft of db.lofts.filter((l) => l.isBot)) {
    if (loft.money < flight.entryFee) continue;
    if (flight.entries.some((e) => e.ownerId === loft.userId)) continue;
    const eligible = db.pigeons
      .filter((p) => p.ownerId === loft.userId && canRace(p, week) && p.form > 45 && !committed.has(p.id))
      .sort((a, b) => talent(b) + b.form - (talent(a) + a.form));
    const n = 1 + Math.floor(Math.random() * 2); // 1-2 birds
    for (const p of eligible.slice(0, n)) {
      if (loft.money < flight.entryFee) break;
      flight.entries.push({ pigeonId: p.id, ownerId: loft.userId });
      committed.add(p.id);
      loft.money -= flight.entryFee;
    }
  }
}

/** Keep the next few days of flights on the calendar (idempotent). */
export function ensureFlightsScheduled(db: Database, nowMs: number): void {
  const today = tzDateParts(TIMEZONE, nowMs);
  const todayUtcMidnight = Date.UTC(today.y, today.m - 1, today.d);

  for (let off = 0; off <= SCHEDULE_HORIZON_DAYS; off++) {
    const dayMid = new Date(todayUtcMidnight + off * 86400000);
    const y = dayMid.getUTCFullYear();
    const m = dayMid.getUTCMonth() + 1;
    const d = dayMid.getUTCDate();
    const weekday = dayMid.getUTCDay(); // 0=Sun..6=Sat

    for (const slot of REAL_SCHEDULE) {
      if (slot.weekday !== null && slot.weekday !== weekday) continue;
      const startMs = wallToUtcMs(TIMEZONE, y, m, d, slot.hour, slot.minute);
      // Skip flights that are already well past their live window.
      if (startMs < nowMs - 2 * 3600 * 1000) continue;
      const templateKey = `${slot.key}:${y}-${m}-${d}`;
      if (db.flights.some((f) => f.templateKey === templateKey)) continue;

      const release = RACE_RELEASES[slot.releaseKey];
      const flight = makeRealtimeFlight(templateKey, release, startMs, db.world.currentWeek);
      db.flights.push(flight);
      botsEnterFlight(db, flight);
    }
  }
}

/** Start flights whose time has come and finalize flights that are over. */
export function tickFlights(db: Database, nowMs: number): void {
  for (const flight of db.flights) {
    const startMs = flight.startAt ? Date.parse(flight.startAt) : NaN;

    if (flight.status === 'scheduled' && !Number.isNaN(startMs) && nowMs >= startMs) {
      const entries: Entry[] = [];
      for (const e of flight.entries) {
        const pigeon = db.pigeons.find((p) => p.id === e.pigeonId);
        if (!pigeon || pigeon.retired) continue;
        entries.push({ pigeon, ownerName: ownerName(db, pigeon.ownerId) });
      }
      if (entries.length === 0) {
        flight.status = 'completed';
        flight.weather = 'Afgelast (geen deelnemers)';
        flight.results = [];
        continue;
      }
      startLiveFlight(flight, entries, flight.week);
    }

    if (flight.status === 'live' && !Number.isNaN(startMs)) {
      const total = flightTotalSeconds(flight);
      if (nowMs >= startMs + total * 1000) {
        const sim = finalizeFlight(flight);
        applyFlightEffects(sim, db.pigeons, db.lofts);
      }
    }
  }
}

/** One-time data fixes (guarded by world.dataVersion). */
function runDataMigrations(db: Database): void {
  if ((db.world.dataVersion ?? 0) < 1) {
    // Give every existing bird a funny name.
    for (const p of db.pigeons) {
      if (isLegacyName(p.name)) {
        p.name = generatePigeonName({ speed: p.speed, endurance: p.endurance, orientation: p.orientation });
      }
    }
    // Drop leftover old-model scheduled flights (they had no real start time).
    db.flights = db.flights.filter((f) => !(f.status === 'scheduled' && !f.startAt));
    db.world.dataVersion = 1;
  }
}

/** Run every real-time step for the current instant. Caller persists. */
export function advanceRealtime(db: Database, nowMs: number): void {
  runDataMigrations(db);
  ensureFlightsScheduled(db, nowMs);
  tickFlights(db, nowMs);
}
