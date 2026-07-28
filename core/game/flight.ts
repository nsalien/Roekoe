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
  COMMENTARY_INTERVAL_SECONDS,
  DISTANCE_WEIGHTING,
  IMPROVE,
  IMPROVE_ATTR_LABEL,
  MIN_FLIGHT_SECONDS,
  PRIZE_MONEY,
  RANKING_POINTS,
} from '../config/gameConfig.js';
import type { Flight, FlightResult, Loft, Pigeon } from '../schema.js';
import { ageMultiplier } from './pigeon.js';
import { randomWeather, type WeatherResult } from './weather.js';
import { clamp, hashString, interpolate, pickWith, randFloat, round1, seededRng } from './util.js';

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

export interface Improvement {
  pigeonId: string;
  ownerId: string;
  pigeonName: string;
  attr: 'speed' | 'endurance' | 'orientation';
  gain: number;
}

export interface SimulatedFlight {
  /** Effects to apply to each participating pigeon after the flight. */
  fatigue: { pigeonId: string; formDelta: number; healthDelta: number; experienceDelta: number }[];
  /** Prize + points to credit each owner's loft. */
  payouts: { ownerId: string; prize: number; points: number; wins: number }[];
  /** Permanent attribute gains from racing. */
  improvements: Improvement[];
}

/**
 * Start a scheduled flight: apply the weather, freeze each pigeon's velocity and
 * its REAL homing duration, and flip the flight to `live`. Positions are derived
 * from this frozen `sim` for the rest of the race.
 */
export function startLiveFlight(flight: Flight, entries: Entry[], week: number, weather?: WeatherResult): void {
  const w = weather ?? randomWeather();
  flight.weather = w.label;
  flight.weatherFactor = w.factor;
  flight.sim = entries.map((e) => {
    const luck = randFloat(0.9, 1.1);
    const velocity = pigeonVelocity(e.pigeon, flight.distanceKm, week, w.factor, luck);
    // Real homing time: distance / speed. A ~72 km/h bird over 300 km ≈ 4 hours.
    const realSeconds = ((flight.distanceKm * 1000) / velocity) * 60;
    const durationSeconds = Math.max(MIN_FLIGHT_SECONDS, Math.round(realSeconds));
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

/** Pick which attribute a bird gets a chance to grow in, weighted by distance. */
function pickImproveAttr(w: { speed: number; endurance: number; orientation: number }): Improvement['attr'] {
  const total = w.speed + w.endurance + w.orientation;
  let r = Math.random() * total;
  if ((r -= w.speed) < 0) return 'speed';
  if ((r -= w.endurance) < 0) return 'endurance';
  return 'orientation';
}

/**
 * Finalize a live flight into ranked results and return the effects to apply.
 * Ranks by finish time (shortest = winner). Also rolls each bird's chance to
 * permanently improve (racing builds condition) and writes the flight's recap.
 */
export function finalizeFlight(flight: Flight, pigeons: Pigeon[]): SimulatedFlight {
  const scored = [...flight.sim].sort((a, b) => a.durationSeconds - b.durationSeconds);
  const prizes = PRIZE_MONEY[flight.type];
  const results: FlightResult[] = [];
  const payoutMap = new Map<string, { prize: number; points: number; wins: number }>();
  const fatigue: SimulatedFlight['fatigue'] = [];
  const improvements: Improvement[] = [];
  const w = weightsForDistance(flight.distanceKm);
  const n = scored.length;

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

    // Racing builds condition: a chance to grow in the attribute that matters
    // most for this distance. Front-runners and birds with more headroom
    // improve more readily; the gain shrinks as the attribute nears its cap.
    const pigeon = pigeons.find((p) => p.id === s.pigeonId);
    if (pigeon) {
      const attr = pickImproveAttr(w);
      const room = clamp((IMPROVE.cap - pigeon[attr]) / IMPROVE.cap, 0, 1);
      const placeBonus = (n > 1 ? (n - i) / n : 1) * 0.3; // up to +0.3 for the winner
      const chance = clamp(IMPROVE.baseChance * (0.5 + room) + placeBonus, 0, 0.9);
      if (pigeon[attr] < IMPROVE.cap && Math.random() < chance) {
        const gain = round1(randFloat(IMPROVE.gainMin, IMPROVE.gainMax) * (0.4 + room));
        if (gain > 0) {
          improvements.push({
            pigeonId: pigeon.id,
            ownerId: pigeon.ownerId,
            pigeonName: pigeon.name,
            attr,
            gain,
          });
        }
      }
    }
  });

  flight.results = results;
  flight.recap = generateRecap(flight);
  flight.status = 'completed';
  const payouts = [...payoutMap.entries()].map(([ownerId, v]) => ({ ownerId, ...v }));
  return { fatigue, payouts, improvements };
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

  const lines: CommentLine[] = [];
  const fill = (tpl: string, pool: string[]) => {
    const n1 = pickWith(rng, pool);
    let n2 = pickWith(rng, all);
    let guard = 0;
    while (n2 === n1 && guard++ < 5) n2 = pickWith(rng, all);
    return tpl.replace('{name}', n1).replace('{name2}', n2);
  };

  // One line at the start, then a fresh update every 10 real minutes.
  lines.push({ atSeconds: 0, text: pickWith(rng, COMMENTARY.start) });
  for (let at = COMMENTARY_INTERVAL_SECONDS; at < total; at += COMMENTARY_INTERVAL_SECONDS) {
    const r = rng();
    let text: string;
    if (r < 0.3) text = fill(pickWith(rng, COMMENTARY.leading), fast);
    else if (r < 0.55) text = fill(pickWith(rng, COMMENTARY.lagging), slow);
    else if (r < 0.75) text = fill(pickWith(rng, COMMENTARY.midrace), all);
    else text = fill(pickWith(rng, COMMENTARY.incident), all);
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
  for (const imp of sim.improvements) {
    const p = pigeons.find((x) => x.id === imp.pigeonId);
    if (!p) continue;
    p[imp.attr] = round1(clamp(p[imp.attr] + imp.gain, 0, IMPROVE.cap));
  }
  for (const pay of sim.payouts) {
    const loft = lofts.find((l) => l.userId === pay.ownerId);
    if (!loft) continue;
    loft.money += pay.prize;
    loft.seasonPoints += pay.points;
    loft.totalWins += pay.wins;
  }
}

/**
 * A short sports-reporter recap of a completed flight — read after the race by
 * everyone. Deterministic (seeded on the flight id) so it never changes.
 */
export function generateRecap(flight: Flight): string {
  const r = flight.results;
  if (r.length === 0) {
    return `De vlucht van ${flight.fromCity} naar ${flight.toCity} ging niet door — geen enkele duif waagde zich aan de reis. De duivenmelkers bleven aan de toog hangen.`;
  }
  const rng = seededRng(hashString(flight.id + ':recap'));
  const winner = r[0];
  const km = flight.distanceKm;
  const winKmh = round1(km / (winner.timeSeconds / 3600));
  const winMin = Math.round(winner.timeSeconds / 60);

  const parts: string[] = [];
  parts.push(
    `${flight.name}: ${r.length} duiven werden gelost in ${flight.fromCity} voor de ${km} km lange thuisreis naar ${flight.toCity}. Weer onderweg: ${flight.weather || 'wisselvallig'}.`,
  );
  const winLines = [
    `${winner.pigeonName} van ${winner.ownerName} draaide er de sokken in en klokte als eerste — ${winKmh} km/u, thuis na een dikke ${winMin} minuten. Een monsterprestatie!`,
    `De zege ging naar ${winner.pigeonName} van ${winner.ownerName}, die met ${winKmh} km/u iedereen op afstand hield. Na ${winMin} minuten viel-ie binnen alsof het niets was.`,
    `Het was ${winner.pigeonName} van ${winner.ownerName} die de klok als eerste deed rinkelen: ${winKmh} km/u gemiddeld. De rest mocht de kruimels oprapen.`,
  ];
  parts.push(pickWith(rng, winLines));

  if (r.length >= 3) {
    parts.push(
      `Op het podium vervolledigd door ${r[1].pigeonName} (${r[1].ownerName}) en ${r[2].pigeonName} (${r[2].ownerName}). Ereplaatsen die smaken naar meer.`,
    );
  } else if (r.length === 2) {
    parts.push(`${r[1].pigeonName} van ${r[1].ownerName} moest nipt de duimen leggen en pakte de tweede stek.`);
  }

  if (r.length >= 4) {
    const last = r[r.length - 1];
    const tailLines = [
      `Helemaal achteraan sukkelde ${last.pigeonName} van ${last.ownerName} binnen — waarschijnlijk nog even gestopt voor een frietje. Volgende keer beter, kameraad.`,
      `De rode lantaarn is voor ${last.pigeonName} (${last.ownerName}). Thuisgekomen, moe maar voldaan, en dat telt ook.`,
      `${last.pigeonName} van ${last.ownerName} deed er het langst over, maar wie het laatst lacht… tja, die is gewoon laatst.`,
    ];
    parts.push(pickWith(rng, tailLines));
  }

  parts.push('Tot de volgende lossing, duivenvrienden!');
  return parts.join(' ');
}
