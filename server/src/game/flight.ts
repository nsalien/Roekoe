/**
 * Flight simulation — the heart of the game.
 *
 * Given a set of entered pigeons and a flight template, computes each pigeon's
 * effective homing velocity, ranks them fastest-first, and awards ranking
 * points and prize money. The result is deterministic-per-call but includes
 * randomness (weather + per-pigeon luck) so no two flights are identical.
 */

import {
  DISTANCE_WEIGHTING,
  PRIZE_MONEY,
  RANKING_POINTS,
} from '../config/gameConfig.js';
import type { Flight, FlightResult, Loft, Pigeon } from '../db/schema.js';
import { ageMultiplier } from './pigeon.js';
import { clamp, interpolate, pick, randFloat, round1 } from './util.js';

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
 * Simulate a scheduled flight in place: fills the flight's weather + results
 * and returns the effects (fatigue, payouts) for the engine to apply to
 * pigeons and lofts.
 */
export function simulateFlight(flight: Flight, week: number, entries: Entry[]): SimulatedFlight {
  const weather = pick(WEATHER_TABLE);
  const distanceKm = flight.distanceKm;

  const scored = entries.map((e) => {
    const luck = randFloat(0.88, 1.12);
    const velocity = pigeonVelocity(e.pigeon, distanceKm, week, weather.factor, luck);
    const timeSeconds = Math.round((distanceKm * 1000) / (velocity / 60));
    return { entry: e, velocity, timeSeconds };
  });

  scored.sort((a, b) => b.velocity - a.velocity);

  const prizes = PRIZE_MONEY[flight.type];
  const results: FlightResult[] = [];
  const payoutMap = new Map<string, { prize: number; points: number; wins: number }>();
  const fatigue: SimulatedFlight['fatigue'] = [];

  scored.forEach((s, i) => {
    const rank = i + 1;
    const points = RANKING_POINTS[i] ?? 0;
    const prize = prizes[i] ?? 0;
    results.push({
      pigeonId: s.entry.pigeon.id,
      pigeonName: s.entry.pigeon.name,
      ownerId: s.entry.pigeon.ownerId,
      ownerName: s.entry.ownerName,
      velocity: s.velocity,
      timeSeconds: s.timeSeconds,
      rank,
      points,
      prize,
    });

    const acc = payoutMap.get(s.entry.pigeon.ownerId) ?? { prize: 0, points: 0, wins: 0 };
    acc.prize += prize;
    acc.points += points;
    if (rank === 1) acc.wins += 1;
    payoutMap.set(s.entry.pigeon.ownerId, acc);

    // Fatigue scales with distance; longer flights cost more form.
    const formDelta = -round1(8 + distanceKm / 40 + randFloat(0, 6));
    const healthDelta = -round1(randFloat(0, distanceKm / 200));
    const experienceDelta = round1(2 + distanceKm / 100);
    fatigue.push({ pigeonId: s.entry.pigeon.id, formDelta, healthDelta, experienceDelta });
  });

  flight.weather = weather.label;
  flight.weatherFactor = weather.factor;
  flight.results = results;
  flight.status = 'completed';

  const payouts = [...payoutMap.entries()].map(([ownerId, v]) => ({ ownerId, ...v }));
  return { fatigue, payouts };
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
