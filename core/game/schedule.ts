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
  BOT_LOFT_CAPACITY,
  BREEDING,
  FEED_RATIONS,
  FLIGHT_FATIGUE,
  FLIGHT_TIERS,
  FOOD_PRICE_PER_KG,
  INFIRMARY,
  REST_CURE,
  IMPROVE_ATTR_LABEL,
  RACE_CITIES,
  REAL_SCHEDULE,
  SCHEDULE_HORIZON_DAYS,
  STARTING_LOFT_CAPACITY,
  TIMEZONE,
  TITAN,
  type FlightTier,
  type RaceCity,
} from '../config/gameConfig.js';
import type { Database, Flight, FlightResult, RaceLogEntry } from '../schema.js';
import { newId } from '../store.js';
import { applyDayOfCare, dailyRunningCost } from './economy.js';
import { breed } from './breeding.js';
import { awardBadge, awardFlightBadges, evaluateBadges } from './badges.js';
import { ensureAuctions } from './auction.js';
import { settleFlightBets } from './betting.js';
import { tickHealing } from './health.js';
import { tickSeason } from './season.js';
import { progressMissions } from './missions.js';
import { activeContracts } from './sponsors.js';
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
  // National = "greater region": BE + continental neighbours, so routes can reach
  // up to ~500 km, but no Channel crossing (GB) and no deep-south grote-fond points.
  if (tier === 'national') return RACE_CITIES.filter((c) => !c.intlOnly && c.country !== 'GB' && c.country !== 'ES');
  return RACE_CITIES; // international: anywhere, including the grote-fond release points
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

/** Pick a random start + finish with a distance in an arbitrary [minKm, maxKm]. */
function pickRouteInRange(minKm: number, maxKm: number): { fromCity: string; toCity: string; distanceKm: number } {
  const pool = RACE_CITIES; // full breadth, like an international route
  let fallback: { a: RaceCity; b: RaceCity; d: number } | null = null;
  for (let i = 0; i < 80; i++) {
    const a = pick(pool);
    const b = pick(pool);
    if (a.name === b.name) continue;
    const d = haversineKm(a, b);
    if (d >= minKm && d <= maxKm) return { fromCity: a.name, toCity: b.name, distanceKm: Math.round(d) };
    if (!fallback || Math.abs(d - (minKm + maxKm) / 2) < Math.abs(fallback.d - (minKm + maxKm) / 2)) {
      fallback = { a, b, d };
    }
  }
  const f = fallback ?? { a: pool[0], b: pool[1], d: haversineKm(pool[0], pool[1]) };
  return { fromCity: f.a.name, toCity: f.b.name, distanceKm: Math.round(f.d) };
}

function makeRealtimeFlight(
  templateKey: string, tier: FlightTier, startMs: number, week: number, practice = false, titan = false,
): Flight {
  const cfg = FLIGHT_TIERS[tier];
  // A titanenwedstrijd draws a medium-to-long route of its own and always carries
  // the same title + entry fee; its tier is derived from the distance for display.
  const route = titan ? pickRouteInRange(TITAN.minKm, TITAN.maxKm) : pickRoute(tier);
  const effectiveTier: FlightTier = titan ? (route.distanceKm >= 300 ? 'international' : 'national') : tier;
  return {
    id: newId('flt'),
    week,
    templateKey,
    name: titan ? TITAN.name : practice ? 'Oefenvlucht' : cfg.name,
    type: effectiveTier,
    distanceKm: route.distanceKm,
    entryFee: titan ? TITAN.entryFee : practice ? 0 : cfg.entryFee,
    fromCity: route.fromCity,
    toCity: route.toCity,
    startAt: new Date(startMs).toISOString(),
    status: 'scheduled',
    practice,
    titan,
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
  if (flight.practice) return; // oefenvluchten zijn voor de speler, bots doen niet mee
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
    // A titanenwedstrijd allows only ONE bird per loft; otherwise 1-2.
    const n = flight.titan ? 1 : 1 + Math.floor(Math.random() * 2);
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

    // Absolute calendar-day index (days since the Unix epoch) for "every N days"
    // slots — deterministic and independent of the schedule horizon window.
    const dayNumber = Math.floor(dayMid.getTime() / 86400000);
    // On a titanenwedstrijd day, that race replaces every other flight.
    const titanDay = REAL_SCHEDULE.some((s) => s.titan && s.weekday === weekday);

    for (const slot of REAL_SCHEDULE) {
      if (slot.weekday !== null && slot.weekday !== weekday) continue;
      if (titanDay && !slot.titan) continue; // titan replaces everything else that day
      if (slot.everyNDays && slot.everyNDays > 1 && dayNumber % slot.everyNDays !== 0) continue;
      const startMs = wallToUtcMs(TIMEZONE, y, m, d, slot.hour, slot.minute);
      // Skip flights that are already well past their live window.
      if (startMs < nowMs - 2 * 3600 * 1000) continue;
      const templateKey = `${slot.key}:${y}-${m}-${d}`;
      if (db.flights.some((f) => f.templateKey === templateKey)) continue;

      // Resolve the tier: fixed, or rotate deterministically by the date.
      const tier: FlightTier = slot.tier
        ?? slot.tiers![Math.abs(hashDate(y, m, d)) % slot.tiers!.length];
      const flight = makeRealtimeFlight(templateKey, tier, startMs, db.world.currentWeek, !!slot.practice, !!slot.titan);
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
  id?: string,
): void {
  // A stable `id` makes the notification idempotent: if the same event is
  // processed twice (e.g. two concurrent requests both finalize a flight), the
  // second write replaces the first instead of creating a duplicate.
  const finalId = id ?? newId('ntf');
  const existing = db.notifications.find((n) => n.id === finalId);
  const note = {
    id: finalId, userId, kind, title, body, flightId,
    createdAt: new Date().toISOString(), read: existing?.read ?? false,
  };
  if (existing) Object.assign(existing, note);
  else db.notifications.push(note);
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
    // Oefenvluchten hebben geen uitslag/prijzen — een korte, rustige melding.
    if (flight.practice) {
      const count = list.length;
      const body = `${count === 1 ? list[0].pigeonName : `Je ${count} duiven`} vloog${count === 1 ? '' : 'en'} de oefenvlucht ` +
        `(${flight.fromCity} → ${flight.toCity}) uit — een rustige training aan conditie en oriëntatie. Geen punten of prijzengeld, wel ervaring.`;
      pushNotification(db, ownerId, 'info', `🕊️ Oefenvlucht afgerond`, body, flight.id, `ntf:res:${flight.id}:${ownerId}`);
      continue;
    }
    // Rank finishers first so "best" is a bird that actually came home if any did.
    list.sort((a, b) => (a.finished === false ? 1 : 0) - (b.finished === false ? 1 : 0) || a.rank - b.rank);
    const best = list[0];
    const prize = list.reduce((s, r) => s + r.prize, 0);
    const points = list.reduce((s, r) => s + r.points, 0);
    const many = list.length > 1 ? ` (${list.length} duiven ingezet)` : '';
    const won = best.rank === 1 && best.finished !== false;
    const title = won ? `🏆 Overwinning — ${flight.name}!` : `Uitslag — ${flight.name}`;
    const money = prize > 0 ? ` en €${prize}` : '';
    const body = best.finished === false
      ? `${best.pigeonName} raakte niet thuis${many} — te weinig energie. Opbrengst: ${points} punten${money}.`
      : `${best.pigeonName} werd ${ordinal(best.rank)} van ${flight.results.length}${many} ` +
        `(${flight.fromCity} → ${flight.toCity}). Opbrengst: ${points} punten${money}.`;
    // Stable id per (flight, owner): a second finalize replaces, never duplicates.
    pushNotification(db, ownerId, 'result', title, body, flight.id, `ntf:res:${flight.id}:${ownerId}`);
  }

  // Birds that died on the flight (flew on almost no energie).
  for (const dead of sim.deaths) {
    if (!humanIds.has(dead.ownerId)) continue;
    pushNotification(
      db,
      dead.ownerId,
      'health',
      `🕯️ ${dead.pigeonName} is de vlucht niet overleefd`,
      `${dead.pigeonName} ging met veel te weinig energie de lucht in en heeft het onderweg begeven. Laat een duif nooit met een lege tank vertrekken.`,
      flight.id,
      `ntf:death:${flight.id}:${dead.pigeonId}`,
    );
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
      `ntf:imp:${flight.id}:${imp.pigeonId}`,
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
      `ntf:inj:${flight.id}:${inj.pigeonId}`,
    );
  }

  trimNotifications(db);
}

/** How many race-log lines to keep per bird (newest first). Bounds the JSON. */
const RACE_LOG_CAP = 40;

/** Keep completed flights for this long; older ones are pruned (their per-bird
 *  placings already live durably in each pigeon's `raceLog`). */
const FLIGHT_RETENTION_MS = 2 * 86400000; // 2 days

/**
 * Record each finisher's placing on its pigeon, so the bird's race history and
 * its owner's trophies survive the pruning of the flight row itself. Idempotent
 * per flight: a second finalize (concurrent requests) replaces the line instead
 * of duplicating it. Dead birds are already removed from `db.pigeons`, so they
 * are naturally skipped.
 */
function logRaceResults(db: Database, flight: Flight): void {
  for (const r of flight.results) {
    const p = db.pigeons.find((x) => x.id === r.pigeonId);
    if (!p) continue;
    const log = p.raceLog ?? [];
    const entry: RaceLogEntry = {
      flightId: flight.id, name: flight.name, fromCity: flight.fromCity, toCity: flight.toCity,
      distanceKm: flight.distanceKm, startAt: flight.startAt, ownerId: r.ownerId,
      rank: r.rank, total: flight.results.length, points: r.points, prize: r.prize,
      velocity: r.velocity, finished: r.finished, practice: !!flight.practice, titan: !!flight.titan,
    };
    const idx = log.findIndex((e) => e.flightId === flight.id);
    if (idx >= 0) log[idx] = entry;
    else log.push(entry);
    if (log.length > RACE_LOG_CAP) log.splice(0, log.length - RACE_LOG_CAP);
    p.raceLog = log;
  }
}

/**
 * Drop completed flights older than the retention window. This is the main fix
 * for the day-long D1 outages: the flights table was never pruned, so every
 * request re-read thousands of fat flight rows (blowing the free-tier "rows
 * read" quota). Scheduled/live flights are always kept; per-bird placings are
 * preserved in `raceLog` before this runs.
 */
export function pruneOldFlights(db: Database, nowMs: number): void {
  const cutoff = nowMs - FLIGHT_RETENTION_MS;
  db.flights = db.flights.filter((f) => {
    if (f.status !== 'completed') return true;
    const t = f.startAt ? Date.parse(f.startAt) : NaN;
    if (Number.isNaN(t)) return true; // keep anything we can't date, to be safe
    return t >= cutoff;
  });
}

/** Start flights whose time has come and finalize flights that are over. */
export function tickFlights(db: Database, nowMs: number, weatherByFlight?: Map<string, WeatherResult>): void {
  for (const flight of db.flights) {
    const startMs = flight.startAt ? Date.parse(flight.startAt) : NaN;

    if (flight.status === 'scheduled' && !Number.isNaN(startMs) && nowMs >= startMs) {
      const entries: Entry[] = [];
      for (const e of flight.entries) {
        const pigeon = db.pigeons.find((p) => p.id === e.pigeonId);
        if (!pigeon) continue;
        entries.push({ pigeon, ownerName: ownerName(db, pigeon.ownerId) });
      }
      // A competition flight needs at least two different breeders — otherwise it
      // is called off and everyone's entry fee is refunded. Training flights
      // (oefenvluchten) may run with a single participant.
      const distinctOwners = new Set(flight.entries.map((e) => e.ownerId)).size;
      const tooFewRivals = !flight.practice && distinctOwners < 2;
      if (entries.length === 0 || tooFewRivals) {
        flight.status = 'completed';
        flight.weather = entries.length === 0 ? 'Afgelast (geen deelnemers)' : 'Afgelast (te weinig deelnemers)';
        flight.results = [];
        flight.recap = generateRecap(flight);
        // Refund the entry fee to every entrant (one fee per entered bird).
        if (flight.entryFee > 0) {
          for (const e of flight.entries) {
            const loft = db.lofts.find((l) => l.userId === e.ownerId);
            if (loft) loft.money += flight.entryFee;
          }
          for (const ownerId of new Set(flight.entries.map((e) => e.ownerId))) {
            const loft = db.lofts.find((l) => l.userId === ownerId);
            if (loft && !loft.isBot) {
              const count = flight.entries.filter((e) => e.ownerId === ownerId).length;
              pushNotification(
                db, ownerId, 'info', `🚫 ${flight.name} afgelast`,
                `Te weinig deelnemers voor de ${flight.name.toLowerCase()} (${flight.fromCity} → ${flight.toCity}). Je inschrijfgeld (€${flight.entryFee * count}) is terugbetaald.`,
                flight.id, `ntf:cancel:${flight.id}:${ownerId}`,
              );
            }
          }
        }
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
        // Remove birds that died on the flight and clean up their references.
        for (const dead of sim.deaths) {
          db.pigeons = db.pigeons.filter((p) => p.id !== dead.pigeonId);
          db.breedingPairs = db.breedingPairs.filter((bp) => bp.sireId !== dead.pigeonId && bp.damId !== dead.pigeonId);
          for (const f of db.flights) {
            if (f.status !== 'completed') f.entries = f.entries.filter((e) => e.pigeonId !== dead.pigeonId);
          }
        }
        // Durably record each surviving bird's placing before the flight can be
        // pruned (covers race, practice and titan flights).
        logRaceResults(db, flight);
        // Neither oefenvluchten nor de titanenwedstrijd feed the seasonal rankings
        // (only regionale/nationale/internationale wedstrijden do). They award no
        // ranking badges, bets, win/podium missions or peak/podium stats. Prize
        // money for the titan is already paid via applyFlightEffects above. Record
        // the development they added so it can be subtracted from the "vooruitgang"
        // ranking (birds still improve for real — only the ranking excludes it).
        if (flight.practice || flight.titan) {
          for (const f of sim.fatigue) {
            const p = db.pigeons.find((x) => x.id === f.pigeonId);
            if (!p) continue;
            p.seasonPracticeGain = round1((p.seasonPracticeGain ?? 0) + Math.max(0, f.enduranceDelta) + Math.max(0, f.experienceDelta));
          }
          for (const imp of sim.improvements) {
            const p = db.pigeons.find((x) => x.id === imp.pigeonId);
            if (!p) continue;
            p.seasonPracticeGain = round1((p.seasonPracticeGain ?? 0) + imp.gain);
          }
          continue;
        }
        // Per-season pigeon stats: peak speed + podium count (finishers only).
        for (const r of flight.results) {
          if (r.finished === false) continue;
          const p = db.pigeons.find((x) => x.id === r.pigeonId);
          if (!p) continue;
          if (r.velocity > (p.seasonPeakSpeed ?? 0)) p.seasonPeakSpeed = r.velocity;
          if (r.rank <= 3) p.seasonPodiums = (p.seasonPodiums ?? 0) + 1;
        }
        awardFlightBadges(db, flight);
        settleFlightBets(db, flight);
        // Daily-mission progress for win/podium.
        for (const ownerId of new Set(flight.results.map((r) => r.ownerId))) {
          const loft = db.lofts.find((l) => l.userId === ownerId);
          if (!loft || loft.isBot) continue;
          const mine = flight.results.filter((r) => r.ownerId === ownerId && r.finished !== false);
          const podiums = mine.filter((r) => r.rank <= 3).length;
          if (podiums > 0) progressMissions(db, loft, 'podium', podiums);
          const wins = mine.filter((r) => r.rank === 1).length;
          if (wins > 0) progressMissions(db, loft, 'win', 1);
          // Every active sponsor pays a bonus for each winning bird.
          if (wins > 0) {
            const contracts = activeContracts(loft);
            const bonus = contracts.reduce((s, c) => s + c.contract.winBonus * wins, 0);
            if (bonus > 0) {
              loft.money += bonus;
              pushNotification(
                db, loft.userId, 'info', '🤝 Sponsorbonus',
                `Je sponsors belonen je overwinning met €${bonus}.`, flight.id,
                `ntf:spon:${flight.id}:${loft.userId}`,
              );
            }
          }
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
        if (!loft || r.finished === false) continue;
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
  if ((db.world.dataVersion ?? 0) < 9) {
    // Retro-award the shelter-adoption badge from trade history.
    for (const t of db.trades) {
      if (t.sellerId !== 'shelter_center' && t.sellerName !== 'Opvangcentrum') continue;
      const loft = db.lofts.find((l) => l.userId === t.buyerId);
      if (loft) awardBadge(db, loft, 'opvang');
    }
    db.world.dataVersion = 9;
  }
  if ((db.world.dataVersion ?? 0) < 10) {
    // Loft capacity is now a buyable upgrade from a base of 8; reset existing
    // human lofts to the base (bots keep headroom). Backfill new fields.
    for (const loft of db.lofts) {
      loft.capacity = loft.isBot ? BOT_LOFT_CAPACITY : STARTING_LOFT_CAPACITY;
      if (loft.compartments == null) loft.compartments = 0;
    }
    for (const p of db.pigeons) if (p.coached == null) p.coached = false;
    db.world.dataVersion = 10;
  }
  if ((db.world.dataVersion ?? 0) < 11) {
    // Feeding is now per pigeon: seed each bird with its loft's current schedule
    // so nothing changes until the player picks a different ration.
    const rationByOwner = new Map(db.lofts.map((l) => [l.userId, l.feedRation]));
    for (const p of db.pigeons) {
      if (p.ration == null) p.ration = rationByOwner.get(p.ownerId) ?? 'normal';
      if (p.compartment == null) p.compartment = false;
    }
    db.world.dataVersion = 11;
  }
  if ((db.world.dataVersion ?? 0) < 12) {
    // Enforce the 8-pigeon base: any human loft over capacity loses its most
    // recently born birds down to capacity.
    for (const loft of db.lofts) {
      if (loft.isBot) continue;
      const owned = db.pigeons.filter((p) => p.ownerId === loft.userId);
      if (owned.length <= loft.capacity) continue;
      const sorted = [...owned].sort(
        (a, b) => b.birthWeek - a.birthWeek || b.createdAtWeek - a.createdAtWeek || (a.id < b.id ? 1 : -1),
      );
      const remove = sorted.slice(0, owned.length - loft.capacity);
      const removeIds = new Set(remove.map((p) => p.id));
      db.pigeons = db.pigeons.filter((p) => !removeIds.has(p.id));
      db.breedingPairs = db.breedingPairs.filter((bp) => !removeIds.has(bp.sireId) && !removeIds.has(bp.damId));
      for (const f of db.flights) {
        if (f.status !== 'completed') f.entries = f.entries.filter((e) => !removeIds.has(e.pigeonId));
      }
      pushNotification(
        db, loft.userId, 'info', '🏠 Hok teruggebracht tot de basis',
        `Je hok telt voortaan maximaal ${loft.capacity} duiven. Je ${remove.length} jongste duif/duiven ${remove.length === 1 ? 'is' : 'zijn'} vertrokken. Breid je hok uit om er meer te houden.`,
        null,
      );
    }
    db.world.dataVersion = 12;
  }
  if ((db.world.dataVersion ?? 0) < 13) {
    // Food is now kept per type. Wipe old stock, give everyone 50 kg Normaal,
    // and reset every bird to the 'normal' ration.
    for (const loft of db.lofts) {
      loft.food = { normal: 50, premium: 0, libido: 0, herstel: 0 };
      loft.feedRation = 'normal';
    }
    for (const p of db.pigeons) p.ration = 'normal';
    db.world.dataVersion = 13;
  }
  if ((db.world.dataVersion ?? 0) < 14) {
    // Bots now play by the same 8-pigeon base as players. Bring every bot loft
    // down to the base and drop its most recently born birds down to capacity.
    for (const loft of db.lofts) {
      if (!loft.isBot) continue;
      loft.capacity = BOT_LOFT_CAPACITY;
      const owned = db.pigeons.filter((p) => p.ownerId === loft.userId);
      if (owned.length <= loft.capacity) continue;
      const sorted = [...owned].sort(
        (a, b) => b.birthWeek - a.birthWeek || b.createdAtWeek - a.createdAtWeek || (a.id < b.id ? 1 : -1),
      );
      const removeIds = new Set(sorted.slice(0, owned.length - loft.capacity).map((p) => p.id));
      db.pigeons = db.pigeons.filter((p) => !removeIds.has(p.id));
      db.breedingPairs = db.breedingPairs.filter((bp) => !removeIds.has(bp.sireId) && !removeIds.has(bp.damId));
      for (const f of db.flights) {
        if (f.status !== 'completed') f.entries = f.entries.filter((e) => !removeIds.has(e.pigeonId));
      }
    }
    db.world.dataVersion = 14;
  }
  if ((db.world.dataVersion ?? 0) < 15) {
    // Bots used to be generated stronger than players (quality up to 0.75 vs
    // 0.6), which mostly lifted the racing attributes of their best birds — the
    // ones that kept winning. Pull existing bot birds back toward the
    // player-typical level by trimming only the part ABOVE that level (the
    // strongest birds lose the most; average/weak birds are left alone), so
    // their earned progress is largely kept but the unfair edge is gone.
    const PLAYER_LEVEL = 52; // centre of a player-generated attribute
    const trim = (a: number) => round1(clamp(a - clamp((a - PLAYER_LEVEL) * 0.5, 0, 12), 5, 100));
    for (const p of db.pigeons) {
      const loft = db.lofts.find((l) => l.userId === p.ownerId);
      if (!loft?.isBot) continue;
      p.speed = trim(p.speed);
      p.endurance = trim(p.endurance);
      p.orientation = trim(p.orientation);
    }
    db.world.dataVersion = 15;
  }
  if ((db.world.dataVersion ?? 0) < 16) {
    // The infirmary base is now 2 beds (was 4), with a new upgrade ladder.
    // Bring existing lofts onto the new scheme: never-upgraded lofts drop to the
    // new base; upgraded lofts keep their beds but capped at the new max (6).
    for (const loft of db.lofts) {
      loft.infirmaryCapacity = (loft.infirmaryCapacity ?? 4) <= 4
        ? INFIRMARY.baseCapacity
        : Math.min(loft.infirmaryCapacity, 6);
    }
    db.world.dataVersion = 16;
  }
  if ((db.world.dataVersion ?? 0) < 17) {
    // Seed the (new) pigeon season rankings from past race history so they are
    // not empty on launch: a bird's best-ever race velocity becomes its season
    // peak speed, and every past top-3 finish counts toward its podium tally.
    // Practice flights don't count. Progress can't be reconstructed (no historic
    // attribute snapshots), so it just starts fresh from here.
    const peak = new Map<string, number>();
    const podium = new Map<string, number>();
    for (const f of db.flights) {
      if (f.status !== 'completed' || f.practice) continue;
      for (const r of f.results) {
        if (r.finished === false) continue;
        if (r.velocity > (peak.get(r.pigeonId) ?? 0)) peak.set(r.pigeonId, r.velocity);
        if (r.rank <= 3) podium.set(r.pigeonId, (podium.get(r.pigeonId) ?? 0) + 1);
      }
    }
    for (const p of db.pigeons) {
      p.seasonPeakSpeed = peak.get(p.id) ?? 0;
      p.seasonPodiums = podium.get(p.id) ?? 0;
    }
    db.world.dataVersion = 17;
  }
  if ((db.world.dataVersion ?? 0) < 18) {
    // Old completed flights are about to become prunable (2-day retention). Move
    // each bird's placings into its durable `raceLog` first, so no race history
    // or trophy is lost when the flights table is trimmed. Oldest→newest so the
    // per-bird cap keeps the most recent races.
    const byPigeon = new Map<string, RaceLogEntry[]>();
    const completed = db.flights
      .filter((f) => f.status === 'completed')
      .sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
    for (const f of completed) {
      for (const r of f.results) {
        const arr = byPigeon.get(r.pigeonId) ?? [];
        arr.push({
          flightId: f.id, name: f.name, fromCity: f.fromCity, toCity: f.toCity,
          distanceKm: f.distanceKm, startAt: f.startAt, ownerId: r.ownerId,
          rank: r.rank, total: f.results.length, points: r.points, prize: r.prize,
          velocity: r.velocity, finished: r.finished, practice: !!f.practice, titan: !!f.titan,
        });
        byPigeon.set(r.pigeonId, arr);
      }
    }
    for (const p of db.pigeons) {
      const arr = byPigeon.get(p.id);
      if (arr && arr.length) p.raceLog = arr.slice(-RACE_LOG_CAP);
    }
    db.world.dataVersion = 18;
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

  // Birds currently away on a live flight — their coach can't drill them.
  const livePigeonIds = new Set<string>(
    db.flights.filter((f) => f.status === 'live').flatMap((f) => f.entries.map((e) => e.pigeonId)),
  );

  for (let i = 0; i < days; i++) {
    for (const loft of db.lofts) {
      const owned = db.pigeons.filter((p) => p.ownerId === loft.userId);
      if (owned.length === 0) continue;
      // Bots eat 'normal' and restock that type in real time so they don't
      // starve between weeks.
      if (loft.isBot) {
        const weeklyNeed = owned.length * FEED_RATIONS.normal.foodPerPigeon;
        if ((loft.food.normal ?? 0) < weeklyNeed && loft.money > 400) {
          const buy = Math.min(weeklyNeed * 3, Math.floor((loft.money - 300) / FOOD_PRICE_PER_KG));
          if (buy > 0) {
            loft.food.normal = round1((loft.food.normal ?? 0) + buy);
            loft.money -= Math.round(buy * FOOD_PRICE_PER_KG);
          }
        }
      }
      const { deaths } = applyDayOfCare(loft, owned, livePigeonIds);
      for (const dead of deaths) {
        db.pigeons = db.pigeons.filter((p) => p.id !== dead.id);
        db.breedingPairs = db.breedingPairs.filter((bp) => bp.sireId !== dead.id && bp.damId !== dead.id);
        for (const f of db.flights) {
          if (f.status !== 'completed') f.entries = f.entries.filter((e) => e.pigeonId !== dead.id);
        }
        if (!loft.isBot) {
          pushNotification(
            db, loft.userId, 'health', `🕯️ ${dead.name} is verhongerd`,
            `${dead.name} kreeg ${dead.hungerDays} dagen op rij geen eten en heeft het niet gered. Zorg dat er altijd voorraad is van het voertype van elke duif.`,
            null,
          );
        }
      }
      // Recurring costs are charged DAILY (fixed upkeep + coach + infirmary staff/
      // medicated feed); sponsors likewise pay their stipend daily (weekly ÷ 7).
      // No per-day notification — it would spam the inbox.
      const alive = db.pigeons.filter((p) => p.ownerId === loft.userId);
      if (alive.length > 0) {
        const coachedCount = alive.filter((p) => p.coached).length;
        const infirmaryBirds = alive.filter((p) => p.inInfirmary).length;
        loft.money -= dailyRunningCost(loft, alive.length, coachedCount, infirmaryBirds);
        const stipend = activeContracts(loft).reduce((s, c) => s + c.contract.weeklyStipend, 0);
        if (stipend > 0) loft.money += Math.round(stipend / 7);
      }
    }
  }
  db.world.lastDailyTick = new Date(last + days * DAY_MS).toISOString();
  // Catch state badges that daily recovery may have unlocked (topfit, kerngezond).
  for (const loft of db.lofts) if (!loft.isBot) evaluateBadges(db, loft);
}

/**
 * Drain each live-flight bird's energie (`form`) GRADUALLY while it flies,
 * in blocks of `FLIGHT_FATIGUE.stepMinutes` (30 min), instead of all at once
 * when the race finishes. The total drain per bird equals the `formCost` frozen
 * at the start; here we deduct the share proportional to the distance already
 * covered (rounded down to whole 30-minute blocks, and completed in full once
 * the bird is home). `formDrained` records how much has been taken so far so we
 * never double-count across requests.
 *
 * The point: a bird pulled out of a live race (gaveUp) keeps only the energie
 * it had already spent — you can no longer dodge the whole cost by quitting
 * near the finish. `finalizeFlight` settles whatever is left.
 */
export function tickFlightEnergy(db: Database, nowMs: number): void {
  const stepSeconds = FLIGHT_FATIGUE.stepMinutes * 60;
  for (const flight of db.flights) {
    if (flight.status !== 'live') continue;
    const startMs = flight.startAt ? Date.parse(flight.startAt) : NaN;
    if (Number.isNaN(startMs)) continue;
    const elapsed = Math.max(0, (nowMs - startMs) / 1000);

    for (const s of flight.sim) {
      if (s.gaveUp) continue; // pulled — stops spending energie
      if (s.formCost == null) continue; // legacy flight: settled at finalize
      const flownSeconds = Math.min(elapsed, s.durationSeconds);
      const finished = elapsed >= s.durationSeconds;
      // Quantise to whole 30-minute blocks while still flying; drain in full
      // once home so the total spent matches the frozen cost exactly.
      const countedSeconds = finished ? s.durationSeconds : Math.floor(flownSeconds / stepSeconds) * stepSeconds;
      const fraction = clamp(countedSeconds / s.durationSeconds, 0, 1);
      const target = round1(s.formCost * fraction);
      const delta = target - (s.formDrained ?? 0);
      if (delta <= 0) continue;
      const pigeon = db.pigeons.find((p) => p.id === s.pigeonId);
      if (pigeon) pigeon.form = round1(clamp(pigeon.form - delta, 0, 100));
      s.formDrained = target;
    }
  }
}

/** Finish paid rest cures whose day is up: grant the energie boost + notify. */
export function tickRestCures(db: Database, nowMs: number): void {
  const humanIds = new Set(db.lofts.filter((l) => !l.isBot).map((l) => l.userId));
  for (const p of db.pigeons) {
    if (!p.cureUntil) continue;
    const done = Date.parse(p.cureUntil);
    if (Number.isNaN(done) || nowMs < done) continue;
    p.cureUntil = null;
    p.form = round1(clamp(p.form + REST_CURE.energy, 0, 100));
    if (humanIds.has(p.ownerId)) {
      pushNotification(
        db, p.ownerId, 'info', `🛌 ${p.name} is uitgerust`,
        `De rustkuur zit erop: ${p.name} kreeg er ${REST_CURE.energy} energie bij en is weer inzetbaar.`,
        null, `ntf:cure:${p.id}:${done}`,
      );
    }
  }
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
  tickFlightEnergy(db, nowMs);
  tickHealing(db, nowMs);
  tickRestCures(db, nowMs);
  tickSeason(db, nowMs);
  tickFlights(db, nowMs, weatherByFlight);
  pruneOldFlights(db, nowMs);
}
