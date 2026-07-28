/**
 * Flight simulation — the heart of the game.
 *
 * Given a set of entered pigeons and a flight template, computes each pigeon's
 * effective homing velocity, ranks them fastest-first, and awards ranking
 * points and prize money. The result is deterministic-per-call but includes
 * randomness (weather + per-pigeon luck) so no two flights are identical.
 */

import {
  COMMENTARY,
  DISTANCE_WEIGHTING,
  FLIGHT_TIME_SCALE,
  MIN_FLIGHT_SECONDS,
  PRIZE_MONEY,
  RANKING_POINTS,
} from '../config/gameConfig.js';
import type { Flight, FlightResult, Loft, Pigeon } from '../schema.js';
import { ageMultiplier } from './pigeon.js';
import { clamp, hashString, interpolate, pick, pickWith, randFloat, round1, seededRng } from './util.js';

const WEATHER_TABLE = [
  { label: 'Zonnig, rugwind', factor: 1.12 },
  { label: 'Helder en kalm', factor: 1.05 },
  { label: 'Licht bewolkt', factor: 1.0 },
  { label: 'Bewolkt, zijwind', factor: 0.95 },
  { label: 'Tegenwind', factor: 0.85 },
  { label: 'Regen en mist', factor: 0.72 },
];

/** Attribute weighting for a given distance (interpolated short<->long). */
function weightsForDistance(distanceKm: number) {
  const { shortKm, longKm, short, long } = DISTANCE_WEIGHTING;
  const t = clamp((distanceKm - shortKm) / (longKm - shortKm), 0, 1);
  return {
    speed: short.speed + (long.speed - short.speed) * t,
    endurance: short.endurance + (long.endurance - short.endurance) * t,
    orientation: short.orientation + (long.orientation - short.orientation) * t,
  };
}

export interface Entry {
  pigeon: Pigeon;
  ownerName: string;
}

/**
 * Compute a single pigeon's effective velocity (metres/minute) for a flight.
 * Exposed separately so the client can show a "predicted performance" preview.
 */
export function pigeonVelocity(
  pigeon: Pigeon,
  distanceKm: number,
  currentWeek: number,
  weatherFactor: number,
  luck = 1,
): number {
  const w = weightsForDistance(distanceKm);
  const baseAttr =
    w.speed * pigeon.speed + w.endurance * pigeon.endurance + w.orientation * pigeon.orientation;

  const formFactor = interpolate(
    [
      { x: 0, y: 0.55 },
      { x: 50, y: 0.9 },
      { x: 100, y: 1.1 },
    ],
    pigeon.form,
  );
  const healthFactor = interpolate(
    [
      { x: 0, y: 0.4 },
      { x: 50, y: 0.85 },
      { x: 100, y: 1.0 },
    ],
    pigeon.health,
  );
  const experienceFactor = 1 + clamp(pigeon.experience, 0, 100) / 400; // up to +25%
  const age = ageMultiplier(pigeon, currentWeek);

  // Base racing pigeons average ~1200 m/min; scale attribute score around that.
  const velocity =
    (700 + baseAttr * 9) *
    formFactor *
    healthFactor *
    experienceFactor *
    age *
    weatherFactor *
    luck;
  return round1(velocity);
}

export interface SimulatedFlight {
  /** Effects to apply to each participating pigeon after the flight. */
  fatigue: { pigeonId: string; formDelta: number; healthDelta: number; experienceDelta: number }[];
  /** Prize + points to credit each owner's loft. */
  payouts: { ownerId: string; prize: number; points: number; wins: number }[];
}

/**
 * Start a scheduled flight: roll the weather, freeze each pigeon's velocity and
 * a compressed live race duration, and flip the flight to `live`. Positions are
 * derived from this frozen `sim` for the rest of the race.
 */
export function startLiveFlight(flight: Flight, entries: Entry[], week: number): void {
  const weather = pick(WEATHER_TABLE);
  flight.weather = weather.label;
  flight.weatherFactor = weather.factor;
  flight.sim = entries.map((e) => {
    const luck = randFloat(0.9, 1.1);
    const velocity = pigeonVelocity(e.pigeon, flight.distanceKm, week, weather.factor, luck);
    const realMinutes = (flight.distanceKm * 1000) / velocity; // true homing minutes
    const durationSeconds = Math.max(
      MIN_FLIGHT_SECONDS,
      Math.round(realMinutes * 60 * FLIGHT_TIME_SCALE),
    );
    return {
      pigeonId: e.pigeon.id,
      pigeonName: e.pigeon.name,
      ownerId: e.pigeon.ownerId,
      ownerName: e.ownerName,
      velocity,
      durationSeconds,
    };
  });
  flight.status = 'live';
}

/** Longest bird duration = when the flight is fully over (seconds). */
export function flightTotalSeconds(flight: Flight): number {
  return flight.sim.reduce((m, s) => Math.max(m, s.durationSeconds), 1);
}

/**
 * Finalize a live flight into ranked results and return the effects to apply.
 * Ranks by finish time (shortest = winner).
 */
export function finalizeFlight(flight: Flight): SimulatedFlight {
  const scored = [...flight.sim].sort((a, b) => a.durationSeconds - b.durationSeconds);
  const prizes = PRIZE_MONEY[flight.type];
  const results: FlightResult[] = [];
  const payoutMap = new Map<string, { prize: number; points: number; wins: number }>();
  const fatigue: SimulatedFlight['fatigue'] = [];

  scored.forEach((s, i) => {
    const rank = i + 1;
    const points = RANKING_POINTS[i] ?? 0;
    const prize = prizes[i] ?? 0;
    results.push({
      pigeonId: s.pigeonId,
      pigeonName: s.pigeonName,
      ownerId: s.ownerId,
      ownerName: s.ownerName,
      velocity: s.velocity,
      timeSeconds: s.durationSeconds,
      rank,
      points,
      prize,
    });
    const acc = payoutMap.get(s.ownerId) ?? { prize: 0, points: 0, wins: 0 };
    acc.prize += prize;
    acc.points += points;
    if (rank === 1) acc.wins += 1;
    payoutMap.set(s.ownerId, acc);

    const formDelta = -round1(8 + flight.distanceKm / 40 + randFloat(0, 6));
    const healthDelta = -round1(randFloat(0, flight.distanceKm / 200));
    const experienceDelta = round1(2 + flight.distanceKm / 100);
    fatigue.push({ pigeonId: s.pigeonId, formDelta, healthDelta, experienceDelta });
  });

  flight.results = results;
  flight.status = 'completed';
  const payouts = [...payoutMap.entries()].map(([ownerId, v]) => ({ ownerId, ...v }));
  return { fatigue, payouts };
}

export interface LiveBird {
  pigeonId: string;
  pigeonName: string;
  ownerId: string;
  ownerName: string;
  kmDone: number;
  kmTotal: number;
  kmRemaining: number;
  speedKmh: number;
  progress: number; // 0..1
  finished: boolean;
  etaSeconds: number; // seconds until this bird is home (0 if finished)
  liveRank: number;
}

export interface LiveSnapshot {
  status: Flight['status'];
  elapsedSeconds: number;
  totalSeconds: number;
  overallProgress: number;
  allFinished: boolean;
  birds: LiveBird[];
}

/** Compute the live positions of every bird from the frozen sim + elapsed time. */
export function liveSnapshot(flight: Flight, nowMs: number): LiveSnapshot {
  const startMs = Date.parse(flight.startAt);
  const elapsed = Math.max(0, (nowMs - startMs) / 1000);
  const total = flightTotalSeconds(flight);

  const birds: LiveBird[] = flight.sim.map((s) => {
    const progress = clamp(elapsed / s.durationSeconds, 0, 1);
    const finished = elapsed >= s.durationSeconds;
    const kmDone = round1(flight.distanceKm * progress);
    // A realistic-looking km/h with a gentle live wobble.
    const wobble = 1 + 0.05 * Math.sin(elapsed / 6 + (hashString(s.pigeonId) % 100) / 15);
    const speedKmh = finished ? 0 : round1(s.velocity * 0.06 * wobble);
    return {
      pigeonId: s.pigeonId,
      pigeonName: s.pigeonName,
      ownerId: s.ownerId,
      ownerName: s.ownerName,
      kmDone,
      kmTotal: flight.distanceKm,
      kmRemaining: round1(Math.max(0, flight.distanceKm - kmDone)),
      speedKmh,
      progress,
      finished,
      etaSeconds: finished ? 0 : Math.round(s.durationSeconds - elapsed),
      liveRank: 0,
    };
  });

  birds.sort((a, b) => {
    if (a.finished && b.finished) return a.etaSeconds - b.etaSeconds; // both 0; stable
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  });
  birds.forEach((b, i) => (b.liveRank = i + 1));

  return {
    status: flight.status,
    elapsedSeconds: round1(elapsed),
    totalSeconds: total,
    overallProgress: clamp(elapsed / total, 0, 1),
    allFinished: elapsed >= total,
    birds,
  };
}

export interface CommentLine {
  atSeconds: number;
  text: string;
}

/** Deterministic, growing commentary feed for a live/completed flight. */
export function flightCommentary(flight: Flight, nowMs: number): CommentLine[] {
  if (flight.sim.length === 0) return [];
  const startMs = Date.parse(flight.startAt);
  const elapsed = Math.max(0, (nowMs - startMs) / 1000);
  const total = flightTotalSeconds(flight);
  const rng = seededRng(hashString(flight.id));

  // Likely leaders/laggards by velocity, to make comments feel plausible.
  const byVel = [...flight.sim].sort((a, b) => b.velocity - a.velocity);
  const fast = byVel.slice(0, Math.max(1, Math.ceil(byVel.length / 3))).map((s) => s.pigeonName);
  const slow = byVel.slice(-Math.max(1, Math.ceil(byVel.length / 3))).map((s) => s.pigeonName);
  const all = flight.sim.map((s) => s.pigeonName);

  const count = Math.round(clamp(total / 12, 5, 26));
  const lines: CommentLine[] = [];
  const fill = (tpl: string, pool: string[]) => {
    const n1 = pickWith(rng, pool);
    let n2 = pickWith(rng, all);
    let guard = 0;
    while (n2 === n1 && guard++ < 5) n2 = pickWith(rng, all);
    return tpl.replace('{name}', n1).replace('{name2}', n2);
  };

  for (let i = 0; i < count; i++) {
    const at = Math.round((total * i) / count);
    let text: string;
    if (i === 0) text = pickWith(rng, COMMENTARY.start);
    else {
      const r = rng();
      if (r < 0.3) text = fill(pickWith(rng, COMMENTARY.leading), fast);
      else if (r < 0.55) text = fill(pickWith(rng, COMMENTARY.lagging), slow);
      else if (r < 0.75) text = fill(pickWith(rng, COMMENTARY.midrace), all);
      else text = fill(pickWith(rng, COMMENTARY.incident), all);
    }
    lines.push({ atSeconds: at, text });
  }
  // Finishers: a line as each bird comes home.
  for (const s of byVel) {
    lines.push({ atSeconds: s.durationSeconds, text: fill(pickWith(rng, COMMENTARY.finish), [s.pigeonName]) });
  }

  return lines
    .filter((l) => l.atSeconds <= elapsed + 0.5)
    .sort((a, b) => a.atSeconds - b.atSeconds);
}

/** Apply a flight's effects to pigeons and lofts in place. */
export function applyFlightEffects(
  sim: SimulatedFlight,
  pigeons: Pigeon[],
  lofts: Loft[],
): void {
  for (const f of sim.fatigue) {
    const p = pigeons.find((x) => x.id === f.pigeonId);
    if (!p) continue;
    p.form = round1(clamp(p.form + f.formDelta, 0, 100));
    p.health = round1(clamp(p.health + f.healthDelta, 0, 100));
    p.experience = round1(clamp(p.experience + f.experienceDelta, 0, 100));
  }
  for (const pay of sim.payouts) {
    const loft = lofts.find((l) => l.userId === pay.ownerId);
    if (!loft) continue;
    loft.money += pay.prize;
    loft.seasonPoints += pay.points;
    loft.totalWins += pay.wins;
  }
}
