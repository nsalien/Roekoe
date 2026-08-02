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
  ENERGIE_IMPACT,
  FLIGHT_CUTOFF_MINUTES,
  FLIGHT_FATIGUE,
  FLIGHT_RISK,
  HEALTH,
  IMPROVE,
  IMPROVE_ATTR_LABEL,
  MIN_FLIGHT_SECONDS,
  PRACTICE,
  PRIZE_MONEY,
  RANKING_POINTS,
  type Severity,
  TITAN,
  TOURNEY_RISK,
} from '../config/gameConfig.js';
import type { Ailment, Flight, FlightResult, Loft, Pigeon } from '../schema.js';
import { ageMultiplier } from './pigeon.js';
import { applyAilment, randomAilmentOfSeverity, randomInjury } from './health.js';
import { randomWeather, type WeatherResult } from './weather.js';
import { clamp, hashString, interpolate, pickWith, randFloat, round1, seededRng } from './util.js';

/** How far along the short→long scale a distance sits (0 = short, 1 = long). */
function distanceT(distanceKm: number): number {
  const { shortKm, longKm } = DISTANCE_WEIGHTING;
  return clamp((distanceKm - shortKm) / (longKm - shortKm), 0, 1);
}

/**
 * The energie multiplier for a bird, blended by distance and softened by
 * ervaring (energie dosing). Returns the multiplier plus the "effective energie"
 * the bird races on (its own energie, raised by how well experience lets it dose).
 */
function energieFactor(form: number, experience: number, t: number): { factor: number; effectiveForm: number } {
  const exp = clamp(experience, 0, 100);
  const effectiveForm = clamp(form + (exp / 100) * (100 - form) * ENERGIE_IMPACT.dosingFactor, 0, 100);
  const short = interpolate(ENERGIE_IMPACT.short, effectiveForm);
  const long = interpolate(ENERGIE_IMPACT.long, effectiveForm);
  return { factor: short + (long - short) * t, effectiveForm };
}

/** Attribute weighting for a given distance (interpolated short<->long). */
export function weightsForDistance(distanceKm: number) {
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

  // Energie impact grows with distance; ervaring lets the bird dose it (see
  // energieFactor). Short flights are forgiving to a tired bird.
  const { factor: formFactor } = energieFactor(pigeon.form, pigeon.experience, distanceT(distanceKm));
  const healthFactor = interpolate(
    [
      { x: 0, y: 0.4 },
      { x: 50, y: 0.85 },
      { x: 100, y: 1.0 },
    ],
    pigeon.health,
  );
  // Ervaring = confidence: seasoned birds race noticeably better.
  const experienceFactor = 1 + clamp(pigeon.experience, 0, 100) / 300; // up to +33%
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

/** Every factor that goes into a pigeon's velocity, for diagnostics (admin). */
export interface VelocityBreakdown {
  weights: { speed: number; endurance: number; orientation: number };
  baseAttr: number; // weighted attribute score
  base: number; // 700 + baseAttr*9
  effectiveForm: number; // energie after ervaring-dosing (what the factor uses)
  formFactor: number; // energie multiplier (distance-blended)
  healthFactor: number;
  experienceFactor: number;
  ageFactor: number;
  weatherFactor: number;
  velocityNoLuck: number; // base × all factors (luck = 1)
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Decompose a pigeon's velocity into its contributing factors. Pass `formValue`
 * to use the energie the bird had at race time (its frozen `startForm`) instead
 * of its current energie. Used by the admin flight-analysis tool.
 */
export function velocityBreakdown(
  pigeon: Pigeon,
  distanceKm: number,
  currentWeek: number,
  weatherFactor: number,
  formValue?: number,
): VelocityBreakdown {
  const w = weightsForDistance(distanceKm);
  const baseAttr = w.speed * pigeon.speed + w.endurance * pigeon.endurance + w.orientation * pigeon.orientation;
  const form = formValue ?? pigeon.form;
  const { factor: formFactor, effectiveForm } = energieFactor(form, pigeon.experience, distanceT(distanceKm));
  const healthFactor = interpolate([{ x: 0, y: 0.4 }, { x: 50, y: 0.85 }, { x: 100, y: 1.0 }], pigeon.health);
  const experienceFactor = 1 + clamp(pigeon.experience, 0, 100) / 300;
  const ageFactor = ageMultiplier(pigeon, currentWeek);
  const base = 700 + baseAttr * 9;
  const velocityNoLuck = base * formFactor * healthFactor * experienceFactor * ageFactor * weatherFactor;
  return {
    weights: { speed: round3(w.speed), endurance: round3(w.endurance), orientation: round3(w.orientation) },
    baseAttr: round1(baseAttr),
    base: round1(base),
    effectiveForm: round1(effectiveForm),
    formFactor: round3(formFactor),
    healthFactor: round3(healthFactor),
    experienceFactor: round3(experienceFactor),
    ageFactor: round3(ageFactor),
    weatherFactor: round3(weatherFactor),
    velocityNoLuck: round1(velocityNoLuck),
  };
}

export interface Improvement {
  pigeonId: string;
  ownerId: string;
  pigeonName: string;
  attr: 'speed' | 'endurance' | 'orientation';
  gain: number;
}

export interface FlightInjury {
  pigeonId: string;
  ownerId: string;
  pigeonName: string;
  ailment: Ailment;
}

export interface SimulatedFlight {
  /** Effects to apply to each participating pigeon after the flight. */
  fatigue: {
    pigeonId: string;
    formDelta: number; // energie drain
    enduranceDelta: number; // conditie gain (racing builds fitness)
    healthDelta: number;
    experienceDelta: number;
  }[];
  /** Prize + points to credit each owner's loft. */
  payouts: { ownerId: string; prize: number; points: number; wins: number }[];
  /** Permanent attribute gains from racing. */
  improvements: Improvement[];
  /** Birds hurt during the flight. */
  injuries: FlightInjury[];
  /** Birds that died during the flight (flew on almost no energie). */
  deaths: { pigeonId: string; ownerId: string; pigeonName: string }[];
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
    // Freeze the total energie this bird spends flying the full route. It is
    // drained gradually during the race (tickFlightEnergy), so a bird pulled
    // out mid-flight has already paid for the distance it covered. An oefenvlucht
    // costs almost nothing.
    const formCost = flight.practice
      ? PRACTICE.energyCost
      : round1(FLIGHT_FATIGUE.base + flight.distanceKm / FLIGHT_FATIGUE.perKmDivisor + randFloat(0, FLIGHT_FATIGUE.jitter));
    return {
      pigeonId: e.pigeon.id,
      pigeonName: e.pigeon.name,
      ownerId: e.pigeon.ownerId,
      ownerName: e.ownerName,
      velocity,
      durationSeconds,
      startForm: e.pigeon.form,
      formCost,
      formDrained: 0,
    };
  });
  flight.status = 'live';
}

/**
 * When the flight is over (seconds). A race ends once the first bird is home
 * plus a cutoff window — anyone not home by then is eliminated — or when the
 * slowest still-flying bird arrives, whichever comes first. Birds pulled by
 * their owner (gaveUp) don't count toward the timing.
 */
export function flightTotalSeconds(flight: Flight): number {
  const durations = flight.sim.filter((s) => !s.gaveUp).map((s) => s.durationSeconds);
  if (durations.length === 0) return 1;
  const first = Math.min(...durations);
  const slowest = Math.max(...durations);
  return Math.max(1, Math.min(slowest, first + FLIGHT_CUTOFF_MINUTES * 60));
}

/** Pick which attribute a bird gets a chance to grow in, weighted by distance. */
function pickImproveAttr(w: { speed: number; endurance: number; orientation: number }, rng: () => number): Improvement['attr'] {
  const total = w.speed + w.endurance + w.orientation;
  let r = rng() * total;
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
  if (flight.practice) return finalizePracticeFlight(flight, pigeons);
  // A titanenwedstrijd pays its own money prizes and NO ranking points.
  const prizes = flight.titan ? TITAN.prizes : PRIZE_MONEY[flight.type];
  const results: FlightResult[] = [];
  const payoutMap = new Map<string, { prize: number; points: number; wins: number }>();
  const fatigue: SimulatedFlight['fatigue'] = [];
  const improvements: Improvement[] = [];
  const injuries: FlightInjury[] = [];
  const deaths: SimulatedFlight['deaths'] = [];
  const w = weightsForDistance(flight.distanceKm);
  const injuryChance = HEALTH.flightInjuryBase + flight.distanceKm * HEALTH.flightInjuryPerKm;

  // Seed all randomness on the flight id so finalizing is DETERMINISTIC: if two
  // concurrent requests both finalize this flight (a race), they produce the
  // exact same ranks, effects and notifications instead of contradicting each
  // other (e.g. one says 4th, the other last).
  const rng = seededRng(hashString(flight.id + ':finalize'));
  const rf = (a: number, b: number) => a + (b - a) * rng();

  // Decide who makes it home. Three ways to NOT finish: pulled by the owner
  // (gaveUp), timed out past the cutoff, or exhausted (very low energie).
  const total = flightTotalSeconds(flight);
  const exhausted = new Set<string>();
  const timedOut = new Set<string>();
  const gaveUpSet = new Set<string>();
  for (const s of flight.sim) {
    if (s.gaveUp) { gaveUpSet.add(s.pigeonId); continue; }
    if (s.durationSeconds > total + 0.5) { timedOut.add(s.pigeonId); continue; }
    const pigeon = pigeons.find((p) => p.id === s.pigeonId);
    // Use the energie the bird had at release, not the value already drained
    // down during the flight, so the DNF chance reflects how it started out.
    const startForm = s.startForm ?? (pigeon ? pigeon.form : 50);
    const dnfChance = clamp(
      (FLIGHT_RISK.dnfFormThreshold - startForm) / FLIGHT_RISK.dnfFormThreshold,
      0,
      FLIGHT_RISK.dnfMaxChance,
    );
    if (pigeon && rng() < dnfChance) exhausted.add(s.pigeonId);
  }
  const isDnfId = (id: string) => exhausted.has(id) || timedOut.has(id) || gaveUpSet.has(id);
  const finishers = flight.sim.filter((s) => !isDnfId(s.pigeonId)).sort((a, b) => a.durationSeconds - b.durationSeconds);
  const nonFinishers = flight.sim.filter((s) => isDnfId(s.pigeonId));
  const ordered = [...finishers, ...nonFinishers];
  const n = finishers.length;

  ordered.forEach((s, i) => {
    const isDnf = isDnfId(s.pigeonId);
    const gaveUp = gaveUpSet.has(s.pigeonId);
    const rank = i + 1;
    // De titanenwedstrijd geeft geen rangschikkingspunten (enkel prijzengeld).
    const points = isDnf || flight.titan ? 0 : RANKING_POINTS[i] ?? 0;
    const prize = isDnf ? 0 : prizes[i] ?? 0;
    results.push({
      pigeonId: s.pigeonId,
      pigeonName: s.pigeonName,
      ownerId: s.ownerId,
      ownerName: s.ownerName,
      velocity: isDnf ? 0 : s.velocity,
      timeSeconds: isDnf ? 0 : s.durationSeconds,
      rank,
      points,
      prize,
      finished: !isDnf,
    });
    const acc = payoutMap.get(s.ownerId) ?? { prize: 0, points: 0, wins: 0 };
    acc.prize += prize;
    acc.points += points;
    // A titan win is money-only — it does not count as a competition win.
    if (rank === 1 && !isDnf && !flight.titan) acc.wins += 1;
    payoutMap.set(s.ownerId, acc);

    // Fatigue: racing drains energie. Most of it is already gone — it was
    // drained gradually while the bird flew (see tickFlightEnergy). Here we
    // only settle what is left:
    //  - a pulled bird (gaveUp) paid for the distance it covered, nothing more;
    //  - a finisher tops up to the frozen full cost of the route;
    //  - a bird that flew itself into the ground (DNF) tops up AND takes an
    //    extra exhaustion hit.
    // Flights that were already live before gradual draining existed have no
    // frozen formCost — fall back to the original lump-sum drain for those.
    const drained = s.formDrained ?? 0;
    let formDelta: number;
    if (s.formCost == null) {
      formDelta = gaveUp
        ? -round1(FLIGHT_FATIGUE.gaveUpBase + flight.distanceKm / FLIGHT_FATIGUE.gaveUpPerKmDivisor + rf(0, FLIGHT_FATIGUE.gaveUpJitter))
        : -round1(FLIGHT_FATIGUE.base + flight.distanceKm / FLIGHT_FATIGUE.perKmDivisor + rf(0, FLIGHT_FATIGUE.jitter) + (isDnf ? FLIGHT_FATIGUE.exhaustionPenalty : 0));
    } else if (gaveUp) {
      formDelta = 0; // already paid gradually for the distance it flew
    } else {
      const remainder = Math.max(0, s.formCost - drained);
      const exhaustion = isDnf ? FLIGHT_FATIGUE.exhaustionPenalty + rf(0, FLIGHT_FATIGUE.exhaustionJitter) : 0;
      formDelta = -round1(remainder + exhaustion);
    }
    const enduranceDelta = isDnf ? 0 : round1(0.3 + flight.distanceKm / 500 + rf(0, 0.4));
    const healthDelta = gaveUp ? 0 : -round1(rf(0, flight.distanceKm / 200) + (isDnf ? rf(4, 9) : 0));
    const experienceDelta = round1((isDnf ? 1 : 2) + flight.distanceKm / 100);
    fatigue.push({ pigeonId: s.pigeonId, formDelta, enduranceDelta, healthDelta, experienceDelta });

    const pigeon = pigeons.find((p) => p.id === s.pigeonId);
    if (pigeon) {
      // Racing builds condition (finishers only): a chance to grow in the
      // attribute that matters most for this distance.
      if (!isDnf) {
        const attr = pickImproveAttr(w, rng);
        const room = clamp((IMPROVE.cap - pigeon[attr]) / IMPROVE.cap, 0, 1);
        const placeBonus = (n > 1 ? (n - i) / n : 1) * 0.3; // up to +0.3 for the winner
        const chance = clamp(IMPROVE.baseChance * (0.5 + room) + placeBonus, 0, 0.9);
        if (pigeon[attr] < IMPROVE.cap && rng() < chance) {
          const gain = round1(rf(IMPROVE.gainMin, IMPROVE.gainMax) * (0.4 + room));
          if (gain > 0) {
            improvements.push({ pigeonId: pigeon.id, ownerId: pigeon.ownerId, pigeonName: pigeon.name, attr, gain });
          }
        }
      }

      // Rough flights leave birds hurt. Low energie ramps up the risk; an
      // exhausted bird that flew itself to a standstill is very likely injured.
      // A bird pulled by its owner (gaveUp) is spared the strain — no injury.
      // Risk is based on the energie the bird STARTED with (its live `form` has
      // already been drained down during the race).
      const startForm = s.startForm ?? pigeon.form;

      // Racing on a near-empty tank can be fatal. Only when the bird STARTED the
      // flight under the death threshold, and never for a bird its owner pulled
      // (gaveUp) — that one was spared the strain. A death overrides any injury.
      let died = false;
      if (!gaveUp && startForm < TOURNEY_RISK.deathThreshold && rng() < TOURNEY_RISK.deathChance) {
        deaths.push({ pigeonId: pigeon.id, ownerId: pigeon.ownerId, pigeonName: pigeon.name });
        died = true;
      }

      // Rough flights leave birds hurt. Low energie ramps up the risk; an
      // exhausted bird that flew itself to a standstill is very likely injured.
      // A bird pulled by its owner (gaveUp) is spared the strain — no injury.
      // Risk is based on the energie the bird STARTED with (its live `form` has
      // already been drained down during the race).
      const lowEnergie = startForm < FLIGHT_RISK.lowEnergieInjuryThreshold
        ? ((FLIGHT_RISK.lowEnergieInjuryThreshold - startForm) / FLIGHT_RISK.lowEnergieInjuryThreshold) * FLIGHT_RISK.lowEnergieInjuryBonus
        : 0;
      let perBirdInjury = gaveUp ? 0 : injuryChance * (1 + (100 - startForm) / 100) + lowEnergie;
      if (exhausted.has(s.pigeonId)) perBirdInjury = Math.max(perBirdInjury, 0.8);
      let hurt = false;
      if (!died && !pigeon.ailment && rng() < clamp(perBirdInjury, 0, 0.95)) {
        injuries.push({
          pigeonId: pigeon.id,
          ownerId: pigeon.ownerId,
          pigeonName: pigeon.name,
          ailment: randomInjury(flight.week, rng),
        });
        hurt = true;
      }

      // Graded low-energie danger for tournament flights, by the energie the bird
      // STARTED with: under 20 → kans op een LICHT letsel/ziekte; under 10 → kans
      // op een MATIG letsel/ziekte. (Under 5 is the death roll above.) Skipped for
      // a pulled bird, a bird that already died, or one that is already hurt.
      if (!gaveUp && !died && !hurt && !pigeon.ailment) {
        let severity: Severity | null = null;
        let chance = 0;
        if (startForm < TOURNEY_RISK.moderateThreshold) { severity = 'matig'; chance = TOURNEY_RISK.moderateChance; }
        else if (startForm < TOURNEY_RISK.lightThreshold) { severity = 'licht'; chance = TOURNEY_RISK.lightChance; }
        if (severity && rng() < chance) {
          const kind: Ailment['kind'] = rng() < 0.5 ? 'ziekte' : 'kwetsuur';
          injuries.push({
            pigeonId: pigeon.id,
            ownerId: pigeon.ownerId,
            pigeonName: pigeon.name,
            ailment: randomAilmentOfSeverity(kind, severity, flight.week, rng),
          });
        }
      }
    }
  });

  flight.results = results;
  flight.recap = generateRecap(flight);
  flight.status = 'completed';
  const payouts = [...payoutMap.entries()].map(([ownerId, v]) => ({ ownerId, ...v }));
  return { fatigue, payouts, improvements, injuries, deaths };
}

/**
 * Finalize an oefenvlucht (practice flight). A gentle training loop: every bird
 * makes it home, nobody wins money or ranking points, and there is no DNF,
 * injury or death risk. Birds get a chance to build conditie/oriëntatie (and,
 * less often, snelheid); a private coach lifts both the odds and the size of the
 * conditie/oriëntatie gains.
 */
function finalizePracticeFlight(flight: Flight, pigeons: Pigeon[]): SimulatedFlight {
  const results: FlightResult[] = [];
  const fatigue: SimulatedFlight['fatigue'] = [];
  const improvements: Improvement[] = [];
  const rng = seededRng(hashString(flight.id + ':finalize'));
  const rf = (a: number, b: number) => a + (b - a) * rng();

  const ordered = [...flight.sim].sort((a, b) => a.durationSeconds - b.durationSeconds);
  ordered.forEach((s, i) => {
    results.push({
      pigeonId: s.pigeonId,
      pigeonName: s.pigeonName,
      ownerId: s.ownerId,
      ownerName: s.ownerName,
      velocity: s.velocity,
      timeSeconds: s.durationSeconds,
      rank: i + 1,
      points: 0,
      prize: 0,
      finished: true,
    });

    // Energie: only a little is spent, mostly already drained during the flight.
    const drained = s.formDrained ?? 0;
    const remainder = s.formCost == null ? PRACTICE.energyCost : Math.max(0, s.formCost - drained);
    const formDelta = -round1(remainder);
    const enduranceDelta = round1(0.2 + rf(0, 0.3)); // light conditie build
    const experienceDelta = round1(0.5 + rf(0, 0.5));
    fatigue.push({ pigeonId: s.pigeonId, formDelta, enduranceDelta, healthDelta: 0, experienceDelta });

    const pigeon = pigeons.find((p) => p.id === s.pigeonId);
    if (pigeon) {
      const chance = pigeon.coached ? PRACTICE.coachedImproveChance : PRACTICE.improveChance;
      if (rng() < chance) {
        const attr = pickImproveAttr(PRACTICE.weights, rng);
        const room = clamp((IMPROVE.cap - pigeon[attr]) / IMPROVE.cap, 0, 1);
        // A coach specifically drills conditie/oriëntatie on these flights.
        const coachBonus = pigeon.coached && attr !== 'speed' ? PRACTICE.coachedBonusGain : 0;
        const gain = round1((rf(PRACTICE.gainMin, PRACTICE.gainMax) + coachBonus) * (0.4 + room));
        if (pigeon[attr] < IMPROVE.cap && gain > 0) {
          improvements.push({ pigeonId: pigeon.id, ownerId: pigeon.ownerId, pigeonName: pigeon.name, attr, gain });
        }
      }
    }
  });

  flight.results = results;
  flight.recap = generateRecap(flight);
  flight.status = 'completed';
  return { fatigue, payouts: [], improvements, injuries: [], deaths: [] };
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
  gaveUp: boolean; // owner pulled it from the race
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

  // Rank every bird by its (frozen) finish time — pulled birds (gaveUp) last.
  // A bird that has crossed the line always has durationSeconds <= elapsed, while
  // a still-flying bird has durationSeconds > elapsed, so finishers automatically
  // sit ahead of flyers. This order is stable for the whole race AND matches the
  // final result order, so a bird no longer jumps to the back the moment others
  // start arriving.
  const ordered = [...flight.sim].sort((a, b) => {
    const ag = a.gaveUp ? 1 : 0;
    const bg = b.gaveUp ? 1 : 0;
    if (ag !== bg) return ag - bg;
    return a.durationSeconds - b.durationSeconds;
  });

  const birds: LiveBird[] = ordered.map((s) => {
    const gaveUp = !!s.gaveUp;
    const progress = clamp(elapsed / s.durationSeconds, 0, 1);
    const finished = !gaveUp && elapsed >= s.durationSeconds;
    const kmDone = round1(flight.distanceKm * progress);
    // A realistic-looking km/h with a gentle live wobble.
    const wobble = 1 + 0.05 * Math.sin(elapsed / 6 + (hashString(s.pigeonId) % 100) / 15);
    const speedKmh = finished || gaveUp ? 0 : round1(s.velocity * 0.06 * wobble);
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
      gaveUp,
      etaSeconds: finished ? 0 : Math.round(s.durationSeconds - elapsed),
      liveRank: 0,
    };
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
    p.restDays = 0; // raced → the rest-bonus streak restarts
    p.form = round1(clamp(p.form + f.formDelta, 0, 100)); // energie
    p.endurance = round1(clamp(p.endurance + f.enduranceDelta, 0, 100)); // conditie
    p.health = round1(clamp(p.health + f.healthDelta, 0, 100));
    p.experience = round1(clamp(p.experience + f.experienceDelta, 0, 100));
  }
  for (const imp of sim.improvements) {
    const p = pigeons.find((x) => x.id === imp.pigeonId);
    if (!p) continue;
    p[imp.attr] = round1(clamp(p[imp.attr] + imp.gain, 0, IMPROVE.cap));
  }
  for (const inj of sim.injuries) {
    const p = pigeons.find((x) => x.id === inj.pigeonId);
    if (!p || p.ailment) continue;
    applyAilment(p, inj.ailment);
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
  const km = flight.distanceKm;
  const finished = r.filter((x) => x.finished !== false);
  const lost = r.length - finished.length;

  const parts: string[] = [];
  parts.push(
    `${flight.name}: ${r.length} duiven werden gelost in ${flight.fromCity} voor de ${km} km lange thuisreis naar ${flight.toCity}. Weer onderweg: ${flight.weather || 'wisselvallig'}.`,
  );

  if (finished.length === 0) {
    parts.push('Onwaarschijnlijk maar waar: geen enkele duif raakte thuis. Volledig uitgeput onderweg gestrand — een pikzwarte dag voor de melkers.');
    parts.push('Tot de volgende lossing, duivenvrienden!');
    return parts.join(' ');
  }

  const winner = finished[0];
  const winKmh = round1(km / (winner.timeSeconds / 3600));
  const winMin = Math.round(winner.timeSeconds / 60);
  const winLines = [
    `${winner.pigeonName} van ${winner.ownerName} draaide er de sokken in en klokte als eerste — ${winKmh} km/u, thuis na een dikke ${winMin} minuten. Een monsterprestatie!`,
    `De zege ging naar ${winner.pigeonName} van ${winner.ownerName}, die met ${winKmh} km/u iedereen op afstand hield. Na ${winMin} minuten viel-ie binnen alsof het niets was.`,
    `Het was ${winner.pigeonName} van ${winner.ownerName} die de klok als eerste deed rinkelen: ${winKmh} km/u gemiddeld. De rest mocht de kruimels oprapen.`,
  ];
  parts.push(pickWith(rng, winLines));

  if (finished.length >= 3) {
    parts.push(
      `Op het podium vervolledigd door ${finished[1].pigeonName} (${finished[1].ownerName}) en ${finished[2].pigeonName} (${finished[2].ownerName}). Ereplaatsen die smaken naar meer.`,
    );
  } else if (finished.length === 2) {
    parts.push(`${finished[1].pigeonName} van ${finished[1].ownerName} moest nipt de duimen leggen en pakte de tweede stek.`);
  }

  if (lost > 0) {
    parts.push(`${lost} duif${lost === 1 ? '' : 'ven'} raakte${lost === 1 ? '' : 'n'} niet thuis — te weinig energie in de tank. Een dure les voor de baas.`);
  }

  if (finished.length >= 4) {
    const last = finished[finished.length - 1];
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
