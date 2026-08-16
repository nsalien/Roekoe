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
  GAME_WEEKS_PER_REAL_WEEK,
  INFIRMARY,
  REST_CURE,
  IMPROVE_ATTR_LABEL,
  RACE_CITIES,
  REAL_SCHEDULE,
  RELAY,
  isRelayWeek,
  SCHEDULE_HORIZON_DAYS,
  SPONSOR_OFFER_ON_PERFORMANCE,
  SPONSORS,
  sponsorPodiumBonus,
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
import { settleFlightBets, voidOrphanedBets, refundFlightBets } from './betting.js';
import { coveredInInfirmary, runAgeDecline, runAgeMortality, runHealthDay, tickHealing } from './health.js';
import { tickSeason } from './season.js';
import { progressMissions } from './missions.js';
import { activeContracts, evaluateSponsorOffers } from './sponsors.js';
import {
  applyFlightEffects,
  computeFinishPayouts,
  finalizeFlight,
  flightTotalSeconds,
  generateRecap,
  relayTeams,
  startLiveFlight,
  type Entry,
  type SimulatedFlight,
} from './flight.js';
import type { WeatherResult } from './weather.js';
import { generatePigeonName, isLegacyName, isWrongGenderName } from './names.js';
import { canRace, noteAttrChange, rollBreed, rollGenes, talent } from './pigeon.js';
import { NPC_OWNER_ID, ownerName } from './engine.js';
import { pickRelayRoute, relayEntryTeams, relayLegKm, relayTeamComplete } from './relay.js';
import { bell, clamp, hashString, haversineKm, pick, randFloat, round1, seededRng } from './util.js';

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

/** Epoch ms of the most recent local **midnight** (00:00 in `tz`) at `atMs`. */
function startOfLocalDayMs(tz: string, atMs: number): number {
  const { y, m, d } = tzDateParts(tz, atMs);
  return wallToUtcMs(tz, y, m, d, 0, 0);
}

/** Epoch ms of the next local midnight after the given local-midnight instant.
 *  Adding ~26 h and snapping back to the day start crosses DST safely (a local
 *  day is 23–25 h long). */
function nextLocalMidnightMs(tz: string, midnightMs: number): number {
  return startOfLocalDayMs(tz, midnightMs + 26 * 3600000);
}

/** Whole-day index of the local calendar date at `atMs` (days since epoch). */
function localDayNumber(tz: string, atMs: number): number {
  const { y, m, d } = tzDateParts(tz, atMs);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
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

/** Pick a random start + finish for a tier, within its distance window. The
 *  window defaults to the tier's current config, but can be overridden (e.g. a
 *  legacy migration routing existing flights into the OLD, narrower windows). */
export function pickRoute(tier: FlightTier, minKmOverride?: number, maxKmOverride?: number): { fromCity: string; toCity: string; distanceKm: number } {
  const pool = tierPool(tier);
  const minKm = minKmOverride ?? FLIGHT_TIERS[tier].minKm;
  const maxKm = maxKmOverride ?? FLIGHT_TIERS[tier].maxKm;
  // Track the sampled pair that sits CLOSEST to the [minKm, maxKm] window, so if
  // no in-window pair turns up we still return the nearest one (respecting the
  // minimum whenever the pool can reach it) instead of any random short pair.
  let best: { a: RaceCity; b: RaceCity; d: number; penalty: number } | null = null;
  for (let i = 0; i < 120; i++) {
    const a = pick(pool);
    const b = pick(pool);
    if (a.name === b.name) continue;
    const d = haversineKm(a, b);
    if (d >= minKm && d <= maxKm) return { fromCity: a.name, toCity: b.name, distanceKm: Math.round(d) };
    const penalty = d < minKm ? minKm - d : d - maxKm; // how far outside the window
    if (!best || penalty < best.penalty) best = { a, b, d, penalty };
  }
  const f = best ?? { a: pool[0], b: pool[1], d: haversineKm(pool[0], pool[1]) };
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
  templateKey: string, tier: FlightTier, startMs: number, week: number, practice = false, titan = false, relay = false,
): Flight {
  const cfg = FLIGHT_TIERS[tier];
  // An estafettevlucht carries its own route: one long haul cut into equal legs,
  // with handover points instead of a single release → home pair.
  if (relay) {
    const r = pickRelayRoute();
    return {
      id: newId('flt'),
      week,
      templateKey,
      name: RELAY.name,
      type: 'international',
      distanceKm: r.totalKm,
      entryFee: RELAY.entryFee,
      fromCity: r.fromCity,
      toCity: r.toCity,
      startAt: new Date(startMs).toISOString(),
      status: 'scheduled',
      practice: false,
      titan: false,
      relay: true,
      legs: r.legs,
      entries: [],
      sim: [],
      weather: '',
      weatherFactor: 1,
      results: [],
      recap: '',
      createdAt: new Date().toISOString(),
    };
  }
  // A titanenwedstrijd draws a medium-to-long route of its own and always carries
  // the same title + entry fee; its tier is derived from the distance for display.
  // Oefenvluchten (practice) stay SHORT training runs: they use the regional pool
  // but override the min distance to 0, so the regional competition floor (100 km)
  // doesn't lengthen them.
  const route = titan
    ? pickRouteInRange(TITAN.minKm, TITAN.maxKm)
    : practice
      ? pickRoute(tier, 0)
      : pickRoute(tier);
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
    // A titanenwedstrijd allows only ONE bird per loft; an estafettevlucht needs
    // a full team of exactly RELAY.teamSize (a short-handed bot would only get
    // refunded at the start); otherwise 1-2.
    const n = flight.relay ? RELAY.teamSize : flight.titan ? 1 : 1 + Math.floor(Math.random() * 2);
    if (flight.relay && eligible.length < RELAY.teamSize) continue;
    // The relay charges its fee once per team, not per bird.
    const team = eligible.slice(0, n);
    if (flight.relay) {
      loft.money -= flight.entryFee;
      team.forEach((p, i) => {
        flight.entries.push({ pigeonId: p.id, ownerId: loft.userId, leg: i + 1 });
        committed.add(p.id);
      });
      continue;
    }
    for (const p of team) {
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

/** Slot keys of the OLD, denser calendar (a daily long race + a daily short one
 *  + an every-other-day oefenvlucht). A day that already carries one of these was
 *  planned under that calendar and keeps exactly what it has — the new, lighter
 *  schedule only fills days that were never planned. Self-expiring: once no such
 *  flight is left within the horizon this guard stops matching and can go. */
const LEGACY_SLOT_KEYS = ['morning-long', 'noon-practice', 'evening-short'];

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
    // Leave days that were already planned under the old calendar completely
    // alone, so the new schedule never bolts extra races onto an existing day.
    if (LEGACY_SLOT_KEYS.some((k) => db.flights.some((f) => f.templateKey === `${k}:${y}-${m}-${d}`))) continue;
    // On a titanenwedstrijd day, that race replaces every other flight.
    const titanDay = REAL_SCHEDULE.some((s) => s.titan && s.weekday === weekday);

    for (const slot of REAL_SCHEDULE) {
      if (slot.weekday !== null && slot.weekday !== weekday) continue;
      if (titanDay && !slot.titan) continue; // titan replaces everything else that day
      if (slot.everyNDays && slot.everyNDays > 1 && dayNumber % slot.everyNDays !== 0) continue;
      // The weekend slot alternates: titanenwedstrijd one Saturday, estafette-
      // vlucht the next. The relay starts earlier (RELAY.hour) because ~900 km in
      // three legs takes most of the day.
      const relay = !!slot.titan && isRelayWeek(dayNumber);
      const hour = relay ? RELAY.hour : slot.hour;
      const minute = relay ? RELAY.minute : slot.minute;
      const startMs = wallToUtcMs(TIMEZONE, y, m, d, hour, minute);
      // Skip flights that are already well past their live window.
      if (startMs < nowMs - 2 * 3600 * 1000) continue;
      const templateKey = `${slot.key}:${y}-${m}-${d}`;
      if (db.flights.some((f) => f.templateKey === templateKey)) continue;

      // Resolve the tier: fixed, or rotate deterministically by the date.
      const tier: FlightTier = slot.tier
        ?? slot.tiers![Math.abs(hashDate(y, m, d)) % slot.tiers!.length];
      const flight = makeRealtimeFlight(
        templateKey, tier, startMs, db.world.currentWeek, !!slot.practice, !!slot.titan && !relay, relay,
      );
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
    // An estafettevlucht is scored per TEAM: one placing, one prize, three birds.
    if (flight.relay) {
      const teamRank = list[0].rank;
      const prize = list.reduce((s, r) => s + r.prize, 0);
      const teamCount = new Set(flight.results.map((r) => r.ownerId)).size;
      const order = [...list].sort((a, b) => (a.rank - b.rank) || 0);
      const failed = order.find((r) => r.finished === false);
      const money = prize > 0 ? ` Prijzengeld: €${prize}.` : '';
      const title = teamRank === 1 && !failed ? `🏆 Ploegzege — ${flight.name}!` : `Uitslag — ${flight.name}`;
      const body = failed
        ? `Je ploeg strandde in de ${flight.name.toLowerCase()}: ${failed.pigeonName} raakte er niet, en zonder haar valt de hele ploeg uit. ` +
          `Eindstand: ${ordinal(teamRank)} van ${teamCount} ploegen.${money}`
        : `Je ploeg werd ${ordinal(teamRank)} van ${teamCount} ploegen in de ${flight.name.toLowerCase()} ` +
          `(${flight.fromCity} → ${flight.toCity}, ${RELAY.teamSize} × ${relayLegKm(flight)} km).${money}`;
      pushNotification(db, ownerId, 'result', title, body, flight.id, `ntf:res:${flight.id}:${ownerId}`);
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
      relay: !!flight.relay,
      // A relay bird flew one leg, not the whole route — record which and how far.
      ...(flight.relay
        ? { leg: flight.entries.find((e) => e.pigeonId === r.pigeonId)?.leg, legKm: relayLegKm(flight) }
        : {}),
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
/**
 * Pay a bird's prize money the MOMENT it crosses the finish line, based on its
 * (already-final) placing — instead of waiting until the whole flight completes
 * and the slowest straggler is home, which can take a very long time. The rank is
 * frozen from the sim, so this matches what finalize will record; the per-bird
 * `prizePaid` flag makes it idempotent, and finalize excludes already-paid prizes.
 * Only real competition/titan flights pay money (practice pays nothing).
 */
function payFinishedFlightPrizes(db: Database, nowMs: number): void {
  for (const flight of db.flights) {
    if (flight.status !== 'live' || flight.practice) continue;
    const startMs = flight.startAt ? Date.parse(flight.startAt) : NaN;
    if (Number.isNaN(startMs)) continue;
    const elapsed = (nowMs - startMs) / 1000;
    if (elapsed <= 0) continue;
    for (const pay of computeFinishPayouts(flight)) {
      if (pay.finishSeconds > elapsed || pay.prize <= 0) continue; // not home yet / out of the money
      const s = flight.sim.find((x) => x.pigeonId === pay.pigeonId);
      if (!s || s.prizePaid) continue; // already banked
      const loft = db.lofts.find((l) => l.userId === pay.ownerId);
      if (!loft) continue;
      loft.money += pay.prize;
      s.prizePaid = true;
      if (!loft.isBot) {
        const body = flight.relay
          ? `${pay.pigeonName} bracht je ploeg als ${pay.rank}e binnen in de ${flight.name.toLowerCase()} (${flight.fromCity} → ${flight.toCity}). Je prijzengeld van €${pay.prize} staat al op je rekening — je hoeft niet te wachten tot de laatste ploeg thuis is.`
          : `${pay.pigeonName} finishte als ${pay.rank}e in ${flight.name} (${flight.fromCity} → ${flight.toCity}). Je prijzengeld van €${pay.prize} is meteen bijgeschreven — je hoeft niet te wachten tot de hele vlucht afgelopen is. De ranglijstpunten en de rest volgen bij de afronding.`;
        pushNotification(
          db, pay.ownerId, 'result',
          flight.relay ? `🏁 Ploeg binnen — ${pay.rank}e plaats` : `🏁 ${pay.pigeonName} is binnen — ${pay.rank}e plaats`,
          body,
          flight.id, `ntf:prize:${flight.id}:${pay.pigeonId}`,
        );
      }
    }
  }
}

export function tickFlights(db: Database, nowMs: number, weatherByFlight?: Map<string, WeatherResult>): void {
  for (const flight of db.flights) {
    const startMs = flight.startAt ? Date.parse(flight.startAt) : NaN;

    if (flight.status === 'scheduled' && !Number.isNaN(startMs) && nowMs >= startMs) {
      // An estafettevlucht only starts full teams. A loft that never completed
      // its team (or lost a bird since entering) is taken off the flight and
      // refunded — it cannot fly a leg short.
      if (flight.relay) {
        for (const [ownerId, team] of relayEntryTeams(flight)) {
          const allPresent = team.every((e) => db.pigeons.some((p) => p.id === e.pigeonId));
          if (relayTeamComplete(team) && allPresent) continue;
          flight.entries = flight.entries.filter((e) => e.ownerId !== ownerId);
          const loft = db.lofts.find((l) => l.userId === ownerId);
          if (!loft) continue;
          loft.money += flight.entryFee;
          if (!loft.isBot) {
            pushNotification(
              db, ownerId, 'info', `🚫 Ploeg niet compleet — ${flight.name}`,
              `Je ploeg voor de ${flight.name.toLowerCase()} telde geen ${RELAY.teamSize} vluchtklare duiven bij de start, dus ze is uit de wedstrijd gehaald. Je inschrijfgeld (€${flight.entryFee}) is terugbetaald.`,
              flight.id, `ntf:relayshort:${flight.id}:${ownerId}`,
            );
          }
        }
      }
      const entries: Entry[] = [];
      for (const e of flight.entries) {
        const pigeon = db.pigeons.find((p) => p.id === e.pigeonId);
        if (!pigeon) continue;
        entries.push({ pigeon, ownerName: ownerName(db, pigeon.ownerId) });
      }
      // A competition flight needs at least two different breeders — otherwise it
      // is called off and everyone's entry fee is refunded. Training flights
      // (oefenvluchten) may run with a single participant. For a relay that means
      // two complete TEAMS (short-handed ones were just removed above).
      const distinctOwners = new Set(flight.entries.map((e) => e.ownerId)).size;
      const tooFewRivals = !flight.practice && distinctOwners < 2;
      if (entries.length === 0 || tooFewRivals) {
        flight.status = 'completed';
        flight.weather = entries.length === 0 ? 'Afgelast (geen deelnemers)' : 'Afgelast (te weinig deelnemers)';
        flight.results = [];
        flight.recap = generateRecap(flight);
        // Cancel + refund any open bets on this flight (it never reaches settle).
        refundFlightBets(db, flight);
        // Refund the entry fee to every entrant: one fee per entered bird, or —
        // for an estafettevlucht — one fee per team.
        if (flight.entryFee > 0) {
          for (const ownerId of new Set(flight.entries.map((e) => e.ownerId))) {
            const count = flight.relay ? 1 : flight.entries.filter((e) => e.ownerId === ownerId).length;
            const loft = db.lofts.find((l) => l.userId === ownerId);
            if (!loft) continue;
            loft.money += flight.entryFee * count;
            if (!loft.isBot) {
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
        // Oefenvluchten (practice) feed NONE of the rankings. Record the
        // development they added so it can be subtracted from the "vooruitgang"
        // ranking (birds still improve for real — only the ranking excludes it),
        // then skip everything else.
        if (flight.practice) {
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
        // Per-season pigeon stats: best average flight speed (r.velocity = route
        // average, despite the seasonPeakSpeed field name) + podium count (finishers
        // only). Runs for wedstrijdvluchten AND the titanenwedstrijd — the titan
        // feeds the three duivenranglijsten (snelheid, podiums, vooruitgang), it
        // just yields no seizoenspunten (its results carry 0 points from finalize,
        // so the Roekoe/melker ranking is untouched).
        for (const r of flight.results) {
          if (r.finished === false) continue;
          const p = db.pigeons.find((x) => x.id === r.pigeonId);
          if (!p) continue;
          if (r.velocity > (p.seasonPeakSpeed ?? 0)) p.seasonPeakSpeed = r.velocity;
          if (r.rank <= 3) p.seasonPodiums = (p.seasonPodiums ?? 0) + 1;
        }
        // The weekend specials stop here: no medals/wins badges, no bets (none can
        // be placed on them), no win/podium missions and no sponsor bonuses —
        // money + the pigeon rankings above are all they feed.
        if (flight.titan || flight.relay) continue;
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
          // Every active sponsor pays for EACH podium finish, scaled by how much
          // prestige the race carries (regionaal < nationaal < internationaal)
          // and by the placing. Only the three competition tiers pay — the titan
          // and the estafette already returned above, and a practice flight never
          // gets here.
          const contracts = activeContracts(loft);
          if (contracts.length > 0) {
            const tier = flight.type as FlightTier;
            const perSponsor = new Map<string, number>();
            let bonus = 0;
            for (const r of mine) {
              if (r.rank > 3) continue;
              for (const c of contracts) {
                const amount = sponsorPodiumBonus(c.contract.podiumBase, tier, r.rank);
                if (amount <= 0) continue;
                perSponsor.set(c.def.id, (perSponsor.get(c.def.id) ?? 0) + amount);
                bonus += amount;
              }
            }
            if (bonus > 0) {
              loft.money += bonus;
              const places = mine
                .filter((r) => r.rank <= 3)
                .sort((a, b) => a.rank - b.rank)
                .map((r) => `${r.pigeonName} ${ordinal(r.rank)}`)
                .join(', ');
              const lines = contracts
                .filter((c) => (perSponsor.get(c.def.id) ?? 0) > 0)
                .map((c) => `${c.def.icon} ${c.def.name}: €${perSponsor.get(c.def.id)}`)
                .join(' · ');
              pushNotification(
                db, loft.userId, 'info', `🤝 Sponsorpremie — €${bonus}`,
                `${places} in ${flight.name} (${FLIGHT_TIERS[tier]?.label.toLowerCase() ?? flight.type}). ` +
                `Je sponsors betalen daarvoor samen €${bonus} uit: ${lines}.`,
                flight.id, `ntf:spon:${flight.id}:${loft.userId}`,
              );
            }
          }
          // A good result may draw a NEW sponsor — but only by chance, and only one
          // at a time (evaluateSponsorOffers respects the cap + spacing). Sponsors
          // never appear on a timer; they scout birds that just performed well.
          const chance = wins > 0
            ? SPONSOR_OFFER_ON_PERFORMANCE.winChance
            : podiums > 0 ? SPONSOR_OFFER_ON_PERFORMANCE.podiumChance : 0;
          if (chance > 0) {
            const rng = seededRng(hashString(`spon-offer:${flight.id}:${ownerId}`));
            if (rng() < chance) evaluateSponsorOffers(db, loft, nowMs);
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
    // not empty on launch: a bird's best-ever race velocity (route average)
    // becomes its seasonPeakSpeed, and every past top-3 finish counts toward its
    // podium tally.
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
  if ((db.world.dataVersion ?? 0) < 19) {
    // Sponsor offers used to appear on a timer/threshold basis, which handed
    // players a whole wall of simultaneous offers. Offers now only come after a
    // good competition result (see tickFlights). Wipe any pending offers banked
    // under the old model so nobody starts with a burst; active contracts and the
    // signed/declined history stay intact, and future offers are earned on the wing.
    for (const l of db.lofts) {
      const sp = l.sponsorship as { offers?: unknown[]; lastOfferAt?: string } | undefined;
      if (!sp) continue;
      if (Array.isArray(sp.offers)) sp.offers = [];
      sp.lastOfferAt = undefined;
    }
    db.world.dataVersion = 19;
  }
  if ((db.world.dataVersion ?? 0) < 20) {
    // The distance windows were widened (regional 0–200, national 200–500,
    // international 400–1200 km). Flights already on the calendar keep their
    // ORIGINAL length — we don't reshuffle the whole calendar. We only correct a
    // still-SCHEDULED flight whose distance sits outside its tier's new window AND
    // that a REAL player has already entered a pigeon in (those are the ones that
    // matter). Bot-only or empty scheduled flights, live/completed flights (their
    // sim is frozen on the old distance) and titans (their own fixed range) are
    // left exactly as they are; new flights are routed with the new distances.
    const humanIds = new Set(db.lofts.filter((l) => !l.isBot).map((l) => l.userId));
    for (const f of db.flights) {
      if (f.status !== 'scheduled' || f.titan) continue;
      if (!f.entries.some((e) => humanIds.has(e.ownerId))) continue; // no real-player bird entered
      const tier: FlightTier =
        f.type === 'regional' || f.type === 'national' || f.type === 'international'
          ? f.type
          : f.distanceKm >= 400 ? 'international' : f.distanceKm >= 200 ? 'national' : 'regional';
      const { minKm, maxKm } = FLIGHT_TIERS[tier];
      if (f.distanceKm >= minKm && f.distanceKm <= maxKm) continue; // already in range
      const route = pickRoute(tier);
      f.type = tier;
      f.name = f.practice ? 'Oefenvlucht' : FLIGHT_TIERS[tier].name;
      f.entryFee = f.practice ? 0 : FLIGHT_TIERS[tier].entryFee;
      f.fromCity = route.fromCity;
      f.toCity = route.toCity;
      f.distanceKm = route.distanceKm;
    }
    db.world.dataVersion = 20;
  }
  if ((db.world.dataVersion ?? 0) < 21) {
    // Existing scheduled flights should keep the OLD, shorter distances (roughly
    // "like it used to be" — an exact match isn't needed); only flights scheduled
    // from here on use the widened windows. Re-route every still-scheduled non-titan
    // flight whose distance now sits outside its tier's LEGACY window back into that
    // window, so the current calendar reads like the old distances. Flights already
    // within the legacy range keep their length; live/completed flights (frozen sim)
    // and titans (own range) are left untouched. New flights created afterwards get
    // the new distances via makeRealtimeFlight. (v20 may have pushed some flights
    // into the new windows; this brings the current calendar back.)
    const legacy: Record<FlightTier, { minKm: number; maxKm: number }> = {
      regional: { minKm: 30, maxKm: 160 },
      national: { minKm: 60, maxKm: 290 },
      international: { minKm: 180, maxKm: 950 },
    };
    for (const f of db.flights) {
      if (f.status !== 'scheduled' || f.titan) continue;
      const tier: FlightTier =
        f.type === 'regional' || f.type === 'national' || f.type === 'international'
          ? f.type
          : f.distanceKm >= 400 ? 'international' : f.distanceKm >= 200 ? 'national' : 'regional';
      const win = legacy[tier];
      if (f.distanceKm >= win.minKm && f.distanceKm <= win.maxKm) continue; // already old-range
      const route = pickRoute(tier, win.minKm, win.maxKm);
      f.type = tier;
      f.name = f.practice ? 'Oefenvlucht' : FLIGHT_TIERS[tier].name;
      f.entryFee = f.practice ? 0 : FLIGHT_TIERS[tier].entryFee;
      f.fromCity = route.fromCity;
      f.toCity = route.toCity;
      f.distanceKm = route.distanceKm;
    }
    db.world.dataVersion = 21;
  }
  if ((db.world.dataVersion ?? 0) < 22) {
    // One-off: the upcoming international morning race (10:00) was too long — shorten
    // it to a 300–400 km route (it stays an "international" flight, just shorter).
    // Target the still-SCHEDULED international `morning-long` flight starting around
    // now (from ~3h ago up to ~20h ahead, so we catch today's whether this runs just
    // before or just after 10:00, but never tomorrow's). Safe no-op once it has gone
    // live (frozen sim) or been pruned.
    const now = Date.now();
    for (const f of db.flights) {
      if (f.status !== 'scheduled' || !f.templateKey.startsWith('morning-long:') || f.type !== 'international') continue;
      const start = Date.parse(f.startAt);
      if (start < now - 3 * 3600_000 || start > now + 20 * 3600_000) continue;
      const route = pickRouteInRange(300, 400);
      f.fromCity = route.fromCity;
      f.toCity = route.toCity;
      f.distanceKm = route.distanceKm;
    }
    db.world.dataVersion = 22;
  }
  if ((db.world.dataVersion ?? 0) < 23) {
    // Breeds (rassen): assign a weighted-random breed to every existing pigeon
    // that doesn't have one yet, so old birds get a photo + rarity just like new
    // ones. Purely cosmetic (plus a small price premium) — no attributes change.
    for (const p of db.pigeons) {
      if (!p.breed) p.breed = rollBreed();
    }
    db.world.dataVersion = 23;
  }
  if ((db.world.dataVersion ?? 0) < 24) {
    // One-off admin cleanup: fully remove the player whose loft is named
    // "flapping pidgeons" (matched case-insensitively; both the pidgeons/pigeons
    // spellings, real players only — never a bot) and everything tied to them.
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const target = db.lofts.find(
      (l) => !l.isBot && (norm(l.name) === 'flapping pidgeons' || norm(l.name) === 'flapping pigeons'),
    );
    if (target) {
      const uid = target.userId;
      const mine = new Set(db.pigeons.filter((p) => p.ownerId === uid).map((p) => p.id));

      // Their own records.
      db.pigeons = db.pigeons.filter((p) => p.ownerId !== uid);
      db.breedingPairs = db.breedingPairs.filter(
        (bp) => bp.ownerId !== uid && !mine.has(bp.sireId) && !mine.has(bp.damId),
      );
      db.lofts = db.lofts.filter((l) => l.userId !== uid);
      db.users = db.users.filter((u) => u.id !== uid);
      db.notifications = db.notifications.filter((n) => n.userId !== uid);

      // Their bets go; other players' still-open bets on a removed bird are voided.
      db.bets = db.bets.filter((b) => b.userId !== uid);
      for (const b of db.bets) {
        if (b.status === 'open' && ((b.pigeonId && mine.has(b.pigeonId)) || (b.rivalId && mine.has(b.rivalId)))) {
          b.status = 'void';
          b.settledAt = new Date().toISOString();
        }
      }

      // Pending pigeon-offers from/to this player or on one of their birds.
      db.offers = db.offers.filter(
        (o) => o.fromUserId !== uid && o.toUserId !== uid && !mine.has(o.pigeonId),
      );

      // Drop their bids from open auctions; recompute the leader if they held it.
      for (const a of db.auctions) {
        if (a.status !== 'open') continue;
        a.bids = a.bids.filter((bid) => bid.userId !== uid);
        if (a.currentBidderId === uid) {
          let top: { userId: string; name: string; amount: number } | null = null;
          for (const bid of a.bids) if (!top || bid.amount > top.amount) top = bid;
          a.currentBidderId = top?.userId ?? null;
          a.currentBidderName = top?.name ?? null;
          a.currentBid = top?.amount ?? a.minBid;
        }
      }

      // Remove their birds from any not-yet-completed flight (entries/sim/results).
      // Completed flights keep their historical rows (frozen name snapshots).
      for (const f of db.flights) {
        if (f.status === 'completed') continue;
        f.entries = f.entries.filter((e) => e.ownerId !== uid);
        f.sim = f.sim.filter((s) => s.ownerId !== uid);
        f.results = f.results.filter((r) => r.ownerId !== uid);
      }
    }
    db.world.dataVersion = 24;
  }
  if ((db.world.dataVersion ?? 0) < 25) {
    // Withdrawing a bird now refunds any open bet on it right away. Repair the
    // bets placed before that: refund + cancel every open bet whose bird is no
    // longer taking part (withdrawn from a scheduled/live flight, or its flight
    // was called off / is gone). Normally-finished flights already settled.
    voidOrphanedBets(db);
    db.world.dataVersion = 25;
  }
  if ((db.world.dataVersion ?? 0) < 26) {
    // Titanenwedstrijden now feed the pigeon rankings (speed/podiums/vooruitgang),
    // where before they were excluded. Back-fill the two stored stats from titan
    // flights still on record — retention keeps ~2 days, i.e. the most recent
    // titan — so a bird's titan result shows up in the ⚡/🎖️ ranglijsten right away:
    // raise seasonPeakSpeed to the titan's route average and count its podiums.
    // (Vooruitgang can't be recovered retroactively: the titan's development was
    // folded into seasonPracticeGain and isn't separable — only future titans
    // count there. Pruned older titans can't be recovered either.)
    for (const f of db.flights) {
      if (f.status !== 'completed' || !f.titan) continue;
      for (const r of f.results) {
        if (r.finished === false) continue;
        const p = db.pigeons.find((x) => x.id === r.pigeonId);
        if (!p) continue;
        if (r.velocity > (p.seasonPeakSpeed ?? 0)) p.seasonPeakSpeed = r.velocity;
        if (r.rank <= 3) p.seasonPodiums = (p.seasonPodiums ?? 0) + 1;
      }
    }
    db.world.dataVersion = 26;
  }
  if ((db.world.dataVersion ?? 0) < 27) {
    // A bird in the infirmary no longer occupies a private compartment (the slot
    // frees up for another bird). Release the compartment on every bird currently
    // in the infirmary so the counts match the new rule from the start.
    for (const p of db.pigeons) if (p.inInfirmary && p.compartment) p.compartment = false;
    db.world.dataVersion = 27;
  }
  if ((db.world.dataVersion ?? 0) < 28) {
    // Enforce per-tier MINIMUM distances on the existing calendar: regional never
    // < 100 km, national never < 200, international never < 400. Re-route every
    // still-SCHEDULED competition flight that sits below its tier's floor into the
    // tier's window. Oefenvluchten stay short (skipped), and live/completed flights
    // (frozen sim) and titans (own range) are left untouched — a race in progress
    // can't be re-routed. New flights already respect the floors via pickRoute.
    for (const f of db.flights) {
      if (f.status !== 'scheduled' || f.titan || f.practice) continue;
      const tier: FlightTier =
        f.type === 'regional' || f.type === 'national' || f.type === 'international'
          ? f.type
          : f.distanceKm >= 400 ? 'international' : f.distanceKm >= 200 ? 'national' : 'regional';
      if (f.distanceKm >= FLIGHT_TIERS[tier].minKm) continue; // already at/above the floor
      const route = pickRoute(tier);
      f.type = tier;
      f.name = FLIGHT_TIERS[tier].name;
      f.entryFee = FLIGHT_TIERS[tier].entryFee;
      f.fromCity = route.fromCity;
      f.toCity = route.toCity;
      f.distanceKm = route.distanceKm;
    }
    db.world.dataVersion = 28;
  }
  if ((db.world.dataVersion ?? 0) < 29) {
    // Genetics: give every existing pigeon a genetic profile (per-skill ceilings +
    // an ageing decline rate) so the new caps/ageing apply retroactively. The caps
    // are rolled INDEPENDENTLY of the bird's current stats — so a bird may already
    // sit ABOVE its rolled cap (or above 95). Per the design, existing birds KEEP
    // their current value; the growth logic simply never raises them further and
    // never lowers them. Only NEW growth is capped. (New births clamp start ≤ cap.)
    for (const p of db.pigeons) {
      if (!p.genes || typeof p.declineRate !== 'number') {
        const rolled = rollGenes(talent(p) / 100);
        if (!p.genes) p.genes = rolled.genes;
        if (typeof p.declineRate !== 'number') p.declineRate = rolled.declineRate;
      }
    }
    db.world.dataVersion = 29;
  }
  if ((db.world.dataVersion ?? 0) < 30) {
    // One-off correction (owner request): restore "Tinne de Doodskist-Ontwijker" to
    // 79 snelheid. She showed a 79→78 dip that NO mechanic can cause at her age
    // (skills only decline via ageing past ~208 weeks) — a display-rounding artefact.
    // Real players only; only ever bumps UP; logged in the bird's audit trail.
    for (const p of db.pigeons) {
      if (!p.name.trim().toLowerCase().includes('tinne de doodskist')) continue;
      const loft = db.lofts.find((l) => l.userId === p.ownerId);
      if (!loft || loft.isBot) continue;
      if (p.speed < 79) {
        const before = p.speed;
        p.speed = 79;
        noteAttrChange(p, 'speed', before, 'admin-correctie');
      }
    }
    db.world.dataVersion = 30;
  }
  if ((db.world.dataVersion ?? 0) < 31) {
    // The weekend slot now alternates titanenwedstrijd / estafettevlucht. A titan
    // that was already scheduled on what is now a relay Saturday is dropped so the
    // estafette can take its place; everyone who had entered gets their entry fee
    // back with a notification. Live/completed titans are left alone.
    const dropped: Flight[] = [];
    for (const f of db.flights) {
      if (f.status !== 'scheduled' || !f.titan || !f.startAt) continue;
      const startMs = Date.parse(f.startAt);
      if (Number.isNaN(startMs)) continue;
      if (!isRelayWeek(localDayNumber(TIMEZONE, startMs))) continue;
      dropped.push(f);
      for (const ownerId of new Set(f.entries.map((e) => e.ownerId))) {
        const count = f.entries.filter((e) => e.ownerId === ownerId).length;
        const loft = db.lofts.find((l) => l.userId === ownerId);
        if (!loft) continue;
        loft.money += f.entryFee * count;
        if (loft.isBot) continue;
        pushNotification(
          db, ownerId, 'info', `🔄 Titanenwedstrijd wordt ${RELAY.name.toLowerCase()}`,
          `Vanaf nu wisselt de zaterdagwedstrijd week na week: de ene week de titanenwedstrijd, de andere de ${RELAY.name.toLowerCase()} ` +
          `— één ploeg van ${RELAY.teamSize} duiven die elkaar aflossen over ~900 km. Die van dit weekend wordt een ${RELAY.name.toLowerCase()}, ` +
          `dus je inschrijving voor de titanenwedstrijd is geannuleerd en je inschrijfgeld (€${f.entryFee * count}) is terugbetaald. Schrijf gerust een ploeg in!`,
          null, `ntf:relayswap:${f.id}:${ownerId}`,
        );
      }
    }
    if (dropped.length > 0) {
      const ids = new Set(dropped.map((f) => f.id));
      // Any open bets on a dropped titan are refunded before it disappears.
      for (const f of dropped) refundFlightBets(db, f);
      db.flights = db.flights.filter((f) => !ids.has(f.id));
    }
    db.world.dataVersion = 31;
  }
  if ((db.world.dataVersion ?? 0) < 32) {
    // Sponsor terms moved from a WEEKLY stipend + win-only bonus to a DAILY
    // stipend + a podium bonus that scales with the flight tier — and the whole
    // catalogue was re-tuned upward (the old amounts covered ~9% of a loft's
    // running costs). Rewrite every signed contract and pending offer onto the
    // new shape, at the NEW catalogue value: a contract signed under the old
    // terms should not stay stuck on money that was never meant to be that low.
    // A contract whose terms were scaled at signing keeps that same ratio.
    for (const loft of db.lofts) {
      const raw: any = loft.sponsorship;
      if (!raw) continue;
      const rescale = (entry: any) => {
        const def = SPONSORS.find((d) => d.id === entry?.id);
        if (!def) return;
        // How the old terms compared to the old catalogue value, so a
        // performance-scaled offer keeps its edge (or its discount).
        const oldWeekly = typeof entry.weeklyStipend === 'number' ? entry.weeklyStipend : null;
        const ratio = oldWeekly && oldWeekly > 0 && LEGACY_WEEKLY[def.id]
          ? clamp(oldWeekly / LEGACY_WEEKLY[def.id], 0.5, 2)
          : 1;
        entry.dailyStipend = Math.max(1, Math.round((def.dailyStipend * ratio) / 5) * 5);
        entry.podiumBase = Math.max(5, Math.round((def.podiumBase * ratio) / 5) * 5);
        if (typeof entry.signingBonus === 'number') {
          entry.signingBonus = Math.max(5, Math.round((def.signingBonus * ratio) / 5) * 5);
        }
        delete entry.weeklyStipend;
        delete entry.winBonus;
      };
      for (const a of Array.isArray(raw.active) ? raw.active : []) rescale(a);
      for (const o of Array.isArray(raw.offers) ? raw.offers : []) rescale(o);
    }
    db.world.dataVersion = 32;
  }
  if ((db.world.dataVersion ?? 0) < 33) {
    // One-off correction (owner request): take €3440 back off "De Vluchtige
    // Vleugel" to settle an auction that had been credited wrongly. Real players
    // only, matched on loft name or username. The stable notification id keeps it
    // to exactly one message even if two requests run the migration at once — the
    // player reads it from the bell the next time they open the game.
    const target = db.lofts.find((l) => {
      if (l.isBot) return false;
      const user = db.users.find((u) => u.id === l.userId);
      const names = [l.name, user?.username ?? ''];
      return names.some((n) => n.trim().toLowerCase() === 'de vluchtige vleugel');
    });
    if (target) {
      target.money -= 3440;
      pushNotification(
        db, target.userId, 'info',
        '⚖️ Rechtzetting van de veiling',
        'Er is €3.440 van je kassa gehaald om een veiling recht te zetten die verkeerd was ' +
          'afgerekend. Je duiven, punten en de rest van je hok blijven ongewijzigd.',
        null,
        'ntf:admin:auctioncorrection:3440',
      );
    }
    db.world.dataVersion = 33;
  }
}

/** The pre-v32 weekly stipends, kept only so migration v32 can tell whether a
 *  stored contract was scaled up or down relative to the old catalogue. */
const LEGACY_WEEKLY: Record<string, number> = {
  zatte_duif: 40, vetzakske: 60, den_beenhouwer: 50, het_schuim: 70,
  de_pluim: 80, kruimeltje: 85, den_dorst: 95, van_steen: 110, van_hoof: 120,
  gulden_friet: 150, zeker_vast: 170, fondinvest: 180, duivenkoning: 200, snelle_vleugel: 260,
  gouden_ring: 300, vleugelnet: 320, turbo_motors: 400,
};

/** One leg of a scheduled estafettevlucht whose forecast should be refreshed. */
export interface RelayForecastRequest {
  flightId: string;
  legIndex: number; // 1-based
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  atMs: number; // roughly when that leg is flown
}

/**
 * Which relay legs need their weather (re)fetched. Every leg of an upcoming
 * estafettevlucht carries its own forecast, published days ahead so a player can
 * choose which bird flies which stretch — and refreshed while the forecast can
 * still change, so what you plan with stays close to what you fly. Cheap by
 * design: at most `teamSize` requests every few hours, and nothing at all once a
 * leg's forecast is fresh.
 */
export function relayLegsNeedingForecast(db: Database, nowMs: number): RelayForecastRequest[] {
  const out: RelayForecastRequest[] = [];
  for (const f of db.flights) {
    if (f.status !== 'scheduled' || !f.relay || !f.legs?.length || !f.startAt) continue;
    const startMs = Date.parse(f.startAt);
    if (Number.isNaN(startMs) || startMs < nowMs) continue;
    const untilStartH = (startMs - nowMs) / 3600000;
    const staleH = untilStartH <= RELAY.forecastFinalHours ? 1 : RELAY.forecastRefreshHours;
    const legHours = relayLegKm(f) / RELAY.nominalKmh;
    for (const leg of f.legs) {
      const ageH = leg.forecastAt ? (nowMs - Date.parse(leg.forecastAt)) / 3600000 : Infinity;
      if (Number.isFinite(ageH) && ageH < staleH) continue;
      out.push({
        flightId: f.id,
        legIndex: leg.index,
        from: { lat: leg.fromLat, lon: leg.fromLon },
        to: { lat: leg.toLat, lon: leg.toLon },
        atMs: startMs + (leg.index - 1) * legHours * 3600000,
      });
    }
  }
  return out;
}

/** Store refreshed relay forecasts, keyed `flightId:legIndex`. */
export function applyRelayForecasts(db: Database, forecasts: Map<string, WeatherResult>, nowMs: number): void {
  if (forecasts.size === 0) return;
  const at = new Date(nowMs).toISOString();
  for (const f of db.flights) {
    if (!f.relay || !f.legs?.length) continue;
    for (const leg of f.legs) {
      const w = forecasts.get(`${f.id}:${leg.index}`);
      if (!w) continue;
      leg.weather = w.label;
      leg.weatherFactor = w.factor;
      leg.forecastAt = at;
    }
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

/** Consume food and recover condition once per calendar day, at the local
 *  **day boundary** (00:00 in {@link TIMEZONE}) — so every loft's birds recover
 *  at exactly the same moment, no matter when their owner last logged in. On
 *  each request we simply apply care for every midnight crossed since the last
 *  one we processed (with catch-up), and park the anchor on that midnight; the
 *  next recovery is the following 00:00. */
export function tickDailyCare(db: Database, nowMs: number): void {
  const parsed = db.world.lastDailyTick ? Date.parse(db.world.lastDailyTick) : NaN;
  const todayMidnight = startOfLocalDayMs(TIMEZONE, nowMs);
  if (Number.isNaN(parsed)) {
    // Fresh world: mark today as already handled; first recovery is tomorrow 00:00.
    db.world.lastDailyTick = new Date(todayMidnight).toISOString();
    return;
  }
  // Normalize any legacy anchor (an arbitrary time-of-day from the old rolling
  // 24 h scheme) to its local midnight, then count the day boundaries since.
  let cursor = startOfLocalDayMs(TIMEZONE, parsed);
  let days = 0;
  while (cursor < todayMidnight && days < 30) { // cap catch-up after a long absence
    cursor = nextLocalMidnightMs(TIMEZONE, cursor);
    days++;
  }
  if (days <= 0) return;

  // Birds currently away on a live flight — their coach can't drill them.
  const livePigeonIds = new Set<string>(
    db.flights.filter((f) => f.status === 'live').flatMap((f) => f.entries.map((e) => e.pigeonId)),
  );

  let dayMidnight = startOfLocalDayMs(TIMEZONE, parsed);
  for (let i = 0; i < days; i++) {
    dayMidnight = nextLocalMidnightMs(TIMEZONE, dayMidnight);
    // Pigeons AGE in real time: roll the monotonic game-week counter forward at
    // GAME_WEEKS_PER_REAL_WEEK weeks per real week, spread evenly over the days.
    // Old-age mortality runs once per rolled week (true to the per-week curve).
    const dn = localDayNumber(TIMEZONE, dayMidnight);
    const rolls =
      Math.floor((dn * GAME_WEEKS_PER_REAL_WEEK) / 7) -
      Math.floor(((dn - 1) * GAME_WEEKS_PER_REAL_WEEK) / 7);
    for (let r = 0; r < rolls; r++) {
      db.world.currentWeek += 1;
      runAgeMortality(db, db.world.currentWeek);
      runAgeDecline(db, db.world.currentWeek); // skills fade past the prime (real time)
    }
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
      // Infirmary birds only recover energie (at a reduced rate) when properly
      // staffed — same coverage rule that speeds their healing.
      const coveredInfirmaryIds = coveredInInfirmary(loft, owned);
      const { deaths } = applyDayOfCare(loft, owned, livePigeonIds, coveredInfirmaryIds);
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
        // Sponsors pay a DAILY stipend — same cadence as the running costs, so
        // the player's daily balance is a single honest number (no /7 rounding).
        const stipend = activeContracts(loft).reduce((s, c) => s + c.contract.dailyStipend, 0);
        if (stipend > 0) loft.money += stipend;
      }
    }
    // One real-time day of health for the whole world: birds actually fall ill,
    // ailments keep draining health, and an untreated ailment can turn fatal.
    runHealthDay(db, db.world.currentWeek);
  }
  db.world.lastDailyTick = new Date(cursor).toISOString();
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
    // Birds of a relay team that was already knocked out never leave the handover,
    // so they must not start draining when their leg's clock would have begun.
    const grounded = new Set<string>();
    if (flight.relay) {
      for (const team of relayTeams(flight)) {
        if (team.outAtLeg == null) continue;
        for (const s of team.legs) if ((s.leg ?? 0) > team.outAtLeg) grounded.add(s.pigeonId);
      }
    }

    for (const s of flight.sim) {
      if (s.gaveUp) continue; // pulled — stops spending energie
      if (grounded.has(s.pigeonId)) continue; // team was out before its turn
      if (s.formCost == null) continue; // legacy flight: settled at finalize
      // In an estafettevlucht a bird only burns energie during ITS OWN leg: its
      // clock starts at the handover, and a bird still waiting there (or one whose
      // team was already knocked out) spends nothing at all.
      const legElapsed = elapsed - (s.legStartSeconds ?? 0);
      if (legElapsed <= 0) continue;
      // A bird only pays energie for the part it actually flew. A finisher flies
      // the whole route; a bird that gives out mid-flight (DNF) stops at
      // dnfAtSeconds and never spends energie for the distance it didn't cover.
      const stopSeconds = s.dnfAtSeconds ?? s.durationSeconds;
      const flownSeconds = Math.min(legElapsed, stopSeconds);
      const stopped = legElapsed >= stopSeconds;
      // Quantise to whole 30-minute blocks while still flying; drain the exact
      // flown share once the bird has stopped (finished or gave out).
      const countedSeconds = stopped ? stopSeconds : Math.floor(flownSeconds / stepSeconds) * stepSeconds;
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
  payFinishedFlightPrizes(db, nowMs); // pay prize money the moment a bird finishes
  tickFlights(db, nowMs, weatherByFlight);
  pruneOldFlights(db, nowMs);
}
