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
  BREEDING,
  FEED_RATIONS,
  FLIGHT_TIERS,
  FOOD_PRICE_PER_KG,
  IMPROVE_ATTR_LABEL,
  RACE_CITIES,
  REAL_SCHEDULE,
  SCHEDULE_HORIZON_DAYS,
  TIMEZONE,
  type FlightTier,
  type RaceCity,
} from '../config/gameConfig.js';
import type { Database, Flight, FlightResult } from '../schema.js';
import { newId } from '../store.js';
import { applyDayOfCare } from './economy.js';
import { breed } from './breeding.js';
import { awardBadge, awardFlightBadges, evaluateBadges } from './badges.js';
import { ensureAuctions } from './auction.js';
import { progressMissions } from './missions.js';
import {
  applyFlightEffects,
  finalizeFlight,
  flightTotalSeconds,
  generateRecap,
  startLiveFlight,
  type Entry,
  type SimulatedFlight,
} from './flight.js';
import type { WeatherResult } from './weather.js';
import { generatePigeonName, isLegacyName, isWrongGenderName } from './names.js';
import { canRace, talent } from './pigeon.js';
import { NPC_OWNER_ID, ownerName } from './engine.js';
import { bell, clamp, hashString, haversineKm, pick, randFloat, round1 } from './util.js';

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

/** The pool of cities a tier draws its start/finish from. */
function tierPool(tier: FlightTier): RaceCity[] {
  if (tier === 'regional') return RACE_CITIES.filter((c) => c.flanders);
  if (tier === 'national') return RACE_CITIES.filter((c) => c.country === 'BE');
  return RACE_CITIES; // international: anywhere
}

/** Pick a random start + finish for a tier, within its distance window. */
export function pickRoute(tier: FlightTier): { fromCity: string; toCity: string; distanceKm: number } {
  const pool = tierPool(tier);
  const { minKm, maxKm } = FLIGHT_TIERS[tier];
  let fallback: { a: RaceCity; b: RaceCity; d: number } | null = null;
  for (let i = 0; i < 60; i++) {
    const a = pick(pool);
    const b = pick(pool);
    if (a.name === b.name) continue;
    const d = haversineKm(a, b);
    if (d >= minKm && d <= maxKm) return { fromCity: a.name, toCity: b.name, distanceKm: Math.round(d) };
    if (!fallback) fallback = { a, b, d }; // any distinct pair, just in case
  }
  const f = fallback ?? { a: pool[0], b: pool[1], d: haversineKm(pool[0], pool[1]) };
  return { fromCity: f.a.name, toCity: f.b.name, distanceKm: Math.round(f.d) };
}

function makeRealtimeFlight(templateKey: string, tier: FlightTier, startMs: number, week: number): Flight {
  const cfg = FLIGHT_TIERS[tier];
  const route = pickRoute(tier);
  return {
    id: newId('flt'),
    week,
    templateKey,
    name: cfg.name,
    type: tier,
    distanceKm: route.distanceKm,
    entryFee: cfg.entryFee,
    fromCity: route.fromCity,
    toCity: route.toCity,
    startAt: new Date(startMs).toISOString(),
    status: 'scheduled',
    entries: [],
    sim: [],
    weather: '',
    weatherFactor: 1,
    results: [],
    recap: '',
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

/** Small stable hash of a calendar day, for per-day tier rotation. */
function hashDate(y: number, m: number, d: number): number {
  return (y * 372 + m * 31 + d) | 0;
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

      // Resolve the tier: fixed, or rotate deterministically by the date.
      const tier: FlightTier = slot.tier
        ?? slot.tiers![Math.abs(hashDate(y, m, d)) % slot.tiers!.length];
      const flight = makeRealtimeFlight(templateKey, tier, startMs, db.world.currentWeek);
      db.flights.push(flight);
      botsEnterFlight(db, flight);
    }
  }
}

/** Dutch ordinal-ish suffix for a placing (1e, 2e, 3e, ...). */
function ordinal(n: number): string {
  return `${n}e`;
}

function pushNotification(
  db: Database,
  userId: string,
  kind: 'result' | 'improve' | 'info' | 'health',
  title: string,
  body: string,
  flightId: string | null,
): void {
  db.notifications.push({
    id: newId('ntf'),
    userId,
    kind,
    title,
    body,
    flightId,
    createdAt: new Date().toISOString(),
    read: false,
  });
}

/** Keep each user's inbox to a sane size (newest first). */
function trimNotifications(db: Database, keepPerUser = 40): void {
  const byUser = new Map<string, number>();
  db.notifications = [...db.notifications]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .filter((nt) => {
      const seen = byUser.get(nt.userId) ?? 0;
      byUser.set(nt.userId, seen + 1);
      return seen < keepPerUser;
    });
}

/** Notify human owners of their results and any improvements after a flight. */
function emitFlightNotifications(db: Database, flight: Flight, sim: SimulatedFlight): void {
  const humanIds = new Set(db.lofts.filter((l) => !l.isBot).map((l) => l.userId));

  const byOwner = new Map<string, FlightResult[]>();
  for (const res of flight.results) {
    if (!humanIds.has(res.ownerId)) continue;
    const arr = byOwner.get(res.ownerId) ?? [];
    arr.push(res);
    byOwner.set(res.ownerId, arr);
  }
  for (const [ownerId, list] of byOwner) {
    list.sort((a, b) => a.rank - b.rank);
    const best = list[0];
    const prize = list.reduce((s, r) => s + r.prize, 0);
    const points = list.reduce((s, r) => s + r.points, 0);
    const many = list.length > 1 ? ` (${list.length} duiven ingezet)` : '';
    const title = best.rank === 1 ? `🏆 Overwinning — ${flight.name}!` : `Uitslag — ${flight.name}`;
    const money = prize > 0 ? ` en €${prize}` : '';
    const body =
      `${best.pigeonName} werd ${ordinal(best.rank)} van ${flight.results.length}${many} ` +
      `(${flight.fromCity} → ${flight.toCity}). Opbrengst: ${points} punten${money}.`;
    pushNotification(db, ownerId, 'result', title, body, flight.id);
  }

  for (const imp of sim.improvements) {
    if (!humanIds.has(imp.ownerId)) continue;
    const label = IMPROVE_ATTR_LABEL[imp.attr];
    pushNotification(
      db,
      imp.ownerId,
      'improve',
      `📈 ${imp.pigeonName} is verbeterd!`,
      `Door mee te vliegen groeide ${imp.pigeonName} in ${label} (+${imp.gain}). Deelnemen aan vluchten bouwt conditie op!`,
      flight.id,
    );
  }

  for (const inj of sim.injuries) {
    if (!humanIds.has(inj.ownerId)) continue;
    const a = inj.ailment;
    pushNotification(
      db,
      inj.ownerId,
      'health',
      `🤕 ${inj.pigeonName} raakte gekwetst`,
      `Tijdens de vlucht: ${a.name} (${a.severity}). ${a.description} Overweeg de ziekenboeg met een kinesist.`,
      flight.id,
    );
  }

  trimNotifications(db);
}

/** Start flights whose time has come and finalize flights that are over. */
export function tickFlights(db: Database, nowMs: number, weatherByFlight?: Map<string, WeatherResult>): void {
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
        flight.recap = generateRecap(flight);
        continue;
      }
      startLiveFlight(flight, entries, flight.week, weatherByFlight?.get(flight.id));
    }

    if (flight.status === 'live' && !Number.isNaN(startMs)) {
      const total = flightTotalSeconds(flight);
      if (nowMs >= startMs + total * 1000) {
        const sim = finalizeFlight(flight, db.pigeons);
        applyFlightEffects(sim, db.pigeons, db.lofts);
        emitFlightNotifications(db, flight, sim);
        awardFlightBadges(db, flight);
        // Daily-mission progress for win/podium.
        for (const ownerId of new Set(flight.results.map((r) => r.ownerId))) {
          const loft = db.lofts.find((l) => l.userId === ownerId);
          if (!loft || loft.isBot) continue;
          const mine = flight.results.filter((r) => r.ownerId === ownerId);
          const podiums = mine.filter((r) => r.rank <= 3).length;
          if (podiums > 0) progressMissions(db, loft, 'podium', podiums);
          if (mine.some((r) => r.rank === 1)) progressMissions(db, loft, 'win', 1);
        }
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
        p.name = generatePigeonName(p.sex, { speed: p.speed, endurance: p.endurance, orientation: p.orientation });
      }
    }
    // Drop leftover old-model scheduled flights (they had no real start time).
    db.flights = db.flights.filter((f) => !(f.status === 'scheduled' && !f.startAt));
    db.world.dataVersion = 1;
  }
  if ((db.world.dataVersion ?? 0) < 2) {
    // The market is now player-only: remove leftover NPC market birds.
    db.pigeons = db.pigeons.filter((p) => p.ownerId !== NPC_OWNER_ID);
    // Backfill libido for pigeons created before the attribute existed.
    for (const p of db.pigeons) {
      if (typeof p.libido !== 'number' || Number.isNaN(p.libido)) p.libido = round1(bell(20, 90));
    }
    db.world.dataVersion = 2;
  }
  if ((db.world.dataVersion ?? 0) < 3) {
    // Flights now have varied, randomised routes across three tiers. Re-route
    // any already-scheduled flight so old fixed Gent-bound races get variety.
    for (const f of db.flights) {
      if (f.status !== 'scheduled') continue;
      const tier: FlightTier = f.distanceKm > 350 ? 'international' : f.distanceKm >= 150 ? 'national' : 'regional';
      const route = pickRoute(tier);
      f.type = tier;
      f.name = FLIGHT_TIERS[tier].name;
      f.fromCity = route.fromCity;
      f.toCity = route.toCity;
      f.distanceKm = route.distanceKm;
    }
    db.world.dataVersion = 3;
  }
  if ((db.world.dataVersion ?? 0) < 4) {
    // Calendar slimmed to two flights a day. Drop scheduled flights that came
    // from slots that no longer exist; the new slots repopulate immediately.
    const valid = REAL_SCHEDULE.map((s) => `${s.key}:`);
    db.flights = db.flights.filter(
      (f) => f.status !== 'scheduled' || valid.some((p) => f.templateKey.startsWith(p)),
    );
    db.world.dataVersion = 4;
  }
  if ((db.world.dataVersion ?? 0) < 5) {
    // Older pigeons were all pinned to the libido column default (50). Give them
    // varied libido based on their conditie + energie, plus genetic noise.
    for (const p of db.pigeons) {
      if (p.libido === 50) {
        let base = p.endurance * 0.5 + p.form * 0.5 + randFloat(-18, 18);
        // The same ~12% innately-frisky minority starts with a high drive.
        const h = hashString(p.id);
        if (h % 100 < 12) base = Math.max(base, 65 + ((h >> 7) % 25));
        p.libido = round1(clamp(base, 5, 95));
      }
    }
    db.world.dataVersion = 5;
  }
  if ((db.world.dataVersion ?? 0) < 6) {
    // Give birds a first name matching their sex (no "Nancy" doffers).
    for (const p of db.pigeons) {
      if (isWrongGenderName(p.name, p.sex)) {
        p.name = generatePigeonName(p.sex, { speed: p.speed, endurance: p.endurance, orientation: p.orientation });
      }
    }
    // Refresh scheduled flight titles (drop "(Vlaanderen)"/"(België)").
    for (const f of db.flights) {
      if (f.status === 'scheduled' && FLIGHT_TIERS[f.type as FlightTier]) {
        f.name = FLIGHT_TIERS[f.type as FlightTier].name;
      }
    }
    db.world.dataVersion = 6;
  }
  if ((db.world.dataVersion ?? 0) < 7) {
    // Backfill medal + win counters and per-pigeon race counts from completed
    // flight history, so badges and the trophy tiles reflect past results.
    const raceCount = new Map<string, number>();
    for (const loft of db.lofts) {
      loft.stats.gold = 0; loft.stats.silver = 0; loft.stats.bronze = 0;
      loft.stats.regionalWins = 0; loft.stats.nationalWins = 0; loft.stats.intlWins = 0;
    }
    for (const f of db.flights) {
      if (f.status !== 'completed') continue;
      const winners = new Map<string, boolean>();
      for (const r of f.results) {
        raceCount.set(r.pigeonId, (raceCount.get(r.pigeonId) ?? 0) + 1);
        const loft = db.lofts.find((l) => l.userId === r.ownerId);
        if (!loft) continue;
        if (r.rank === 1) { loft.stats.gold += 1; winners.set(r.ownerId, true); }
        else if (r.rank === 2) loft.stats.silver += 1;
        else if (r.rank === 3) loft.stats.bronze += 1;
      }
      for (const ownerId of winners.keys()) {
        const loft = db.lofts.find((l) => l.userId === ownerId);
        if (!loft) continue;
        if (f.type === 'national') loft.stats.nationalWins += 1;
        else if (f.type === 'international') loft.stats.intlWins += 1;
        else loft.stats.regionalWins += 1; // regional + legacy 'club'
      }
    }
    for (const p of db.pigeons) p.races = raceCount.get(p.id) ?? p.races ?? 0;
    for (const loft of db.lofts) evaluateBadges(db, loft);
    db.world.dataVersion = 7;
  }
  if ((db.world.dataVersion ?? 0) < 8) {
    // Breeding hatches are now random (no fixed countdown). Reset pending pairs
    // so their (previously fixed) hatch time restarts under the new model.
    const now = new Date().toISOString();
    for (const bp of db.breedingPairs) bp.hatchAt = now;
    db.world.dataVersion = 8;
  }
}

/**
 * Flights that are due to start right now and still need their real weather
 * fetched. The API middleware prefetches weather for these (async) before the
 * synchronous tick, so a live flight can be frozen against real conditions.
 */
export function flightsAwaitingStart(db: Database, nowMs: number): Flight[] {
  return db.flights.filter((f) => {
    if (f.status !== 'scheduled' || !f.startAt) return false;
    const startMs = Date.parse(f.startAt);
    return !Number.isNaN(startMs) && nowMs >= startMs && f.entries.length > 0;
  });
}

const DAY_MS = 86400000;

/** Consume food and recover condition once per real day (with catch-up). */
export function tickDailyCare(db: Database, nowMs: number): void {
  const last = db.world.lastDailyTick ? Date.parse(db.world.lastDailyTick) : NaN;
  if (Number.isNaN(last)) {
    db.world.lastDailyTick = new Date(nowMs).toISOString();
    return;
  }
  let days = Math.floor((nowMs - last) / DAY_MS);
  if (days <= 0) return;
  days = Math.min(days, 30); // cap catch-up after a long absence

  for (let i = 0; i < days; i++) {
    for (const loft of db.lofts) {
      const owned = db.pigeons.filter((p) => p.ownerId === loft.userId && !p.retired);
      if (owned.length === 0) continue;
      // Bots restock food in real time so they don't starve between weeks.
      if (loft.isBot) {
        const need = owned.length * FEED_RATIONS[loft.feedRation].foodPerPigeon;
        if (loft.food < need * 5 && loft.money > 400) {
          const buy = Math.min(need * 20, Math.floor((loft.money - 300) / FOOD_PRICE_PER_KG));
          if (buy > 0) {
            loft.food = round1(loft.food + buy);
            loft.money -= Math.round(buy * FOOD_PRICE_PER_KG);
          }
        }
      }
      applyDayOfCare(loft, owned);
    }
  }
  db.world.lastDailyTick = new Date(last + days * DAY_MS).toISOString();
  // Catch state badges that daily recovery may have unlocked (topfit, kerngezond).
  for (const loft of db.lofts) if (!loft.isBot) evaluateBadges(db, loft);
}

/**
 * Hatch breeding pairs — unpredictably. Each check rolls a random chance based
 * on elapsed time and the parents' current libido + energie, so there is no
 * fixed hatch time: fitter pairs simply have a higher chance every moment.
 * (`bp.hatchAt` stores the last-checked time.)
 */
export function tickBreedingHatch(db: Database, nowMs: number): void {
  const humanIds = new Set(db.lofts.filter((l) => !l.isBot).map((l) => l.userId));
  const hatched = new Set<string>();
  for (const bp of db.breedingPairs) {
    const checkedAt = bp.hatchAt ? Date.parse(bp.hatchAt) : NaN;
    if (Number.isNaN(checkedAt)) {
      bp.hatchAt = new Date(nowMs).toISOString();
      continue;
    }
    const sire = db.pigeons.find((p) => p.id === bp.sireId);
    const dam = db.pigeons.find((p) => p.id === bp.damId);
    if (!sire || !dam) {
      hatched.add(bp.id); // a parent was sold or died — the pairing lapses
      continue;
    }
    const dtHours = (nowMs - checkedAt) / 3600000;
    if (dtHours <= 0) continue;

    // Fertility from current libido + energie → mean days → hatch rate per hour.
    const fertility = clamp(
      ((sire.libido + dam.libido) / 2) * 0.5 + ((sire.form + dam.form) / 2) * 0.5,
      0,
      100,
    ) / 100;
    const meanDays =
      BREEDING.hatchMaxMeanDays - fertility * (BREEDING.hatchMaxMeanDays - BREEDING.hatchMinMeanDays);
    const lambdaPerHour = 1 / (meanDays * 24);
    const hatchNow = Math.random() < 1 - Math.exp(-lambdaPerHour * dtHours);
    if (!hatchNow) {
      bp.hatchAt = new Date(nowMs).toISOString(); // remember we checked
      continue;
    }

    hatched.add(bp.id);
    const young = breed(sire, dam, bp.ownerId, db.world.currentWeek);
    const loft = db.lofts.find((l) => l.userId === bp.ownerId);
    const owned = db.pigeons.filter((p) => p.ownerId === bp.ownerId).length;
    const space = (loft?.capacity ?? 0) - owned;
    const admitted = young.slice(0, Math.max(0, space));
    db.pigeons.push(...admitted);

    // Breeding badges.
    if (loft && admitted.length > 0) {
      loft.stats.babies += admitted.length;
      if (young.length >= 2) awardBadge(db, loft, 'tweeling');
      if (admitted.some((y) => talent(y) > 85)) awardBadge(db, loft, 'topfokker');
      const grandIds = [sire.sireId, sire.damId, dam.sireId, dam.damId].filter(Boolean) as string[];
      if (grandIds.some((gid) => db.pigeons.some((p) => p.id === gid))) awardBadge(db, loft, 'dynastie');
      evaluateBadges(db, loft);
    }

    if (loft && humanIds.has(loft.userId)) {
      if (admitted.length > 0) {
        const names = admitted.map((p) => p.name).join(' en ');
        pushNotification(
          db, loft.userId, 'info',
          `🐣 ${admitted.length === 1 ? 'Een jong' : `${admitted.length} jongen`} geboren!`,
          `${sire.name} × ${dam.name} bracht ${names} voort. Welkom in het hok!`,
          null,
        );
      } else if (young.length === 0) {
        pushNotification(
          db, loft.userId, 'info',
          '🥚 Koppel zonder resultaat',
          `${sire.name} × ${dam.name} leverde geen jongen op. Lage energie of libido, misschien volgende keer beter.`,
          null,
        );
      }
    }
  }
  if (hatched.size > 0) {
    db.breedingPairs = db.breedingPairs.filter((bp) => !hatched.has(bp.id));
    trimNotifications(db);
  }
}

/** Run every real-time step for the current instant. Caller persists. */
export function advanceRealtime(
  db: Database,
  nowMs: number,
  weatherByFlight?: Map<string, WeatherResult>,
): void {
  runDataMigrations(db);
  ensureFlightsScheduled(db, nowMs);
  ensureAuctions(db, nowMs);
  tickDailyCare(db, nowMs);
  tickBreedingHatch(db, nowMs);
  tickFlights(db, nowMs, weatherByFlight);
}
