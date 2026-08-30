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
  COMMENTARY_LIMITS,
  DISTANCE_WEIGHTING,
  ENERGIE_IMPACT,
  FLIGHT_DYNAMICS,
  FLIGHT_FATIGUE,
  FLIGHT_RISK,
  INJURY,
  IMPROVE_WEIGHTING,
  LOST,
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
import { AGE_CUP, RELAY } from '../config/gameConfig.js';
import type { Ailment, Database, Flight, FlightResult, Loft, Pigeon, SimEntry } from '../schema.js';
import { relayEntryTeams, relayLegKm, relaySimTeams } from './relay.js';
import { ageMultiplier, conditionScore, experienceGain, flightForm, noteAttrChange, raceCeil } from './pigeon.js';
import { applyAilment, randomLuckInjury, randomStrainInjury } from './health.js';
import { winningsMultiplier } from './newcomer.js';
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
  // Ervaring is DELIBERATELY absent here. It used to add a flat multiplier of up
  // to +33%, which made it a second speed stat — measured, it produced more
  // spread across a field than snelheid itself, and it made a bird with ervaring
  // 0 unable to compete at all. Snelheid decides how fast a bird flies; energie
  // and conditie decide how long it holds that pace. Ervaring still matters, but
  // only through EFFICIENCY: it lets a bird ration a low tank (energieFactor
  // above — zero benefit on a full one), costs less energie per flight, and
  // recovers faster. Same cleanup orientation got, for the same reason.
  const age = ageMultiplier(pigeon, currentWeek);

  // Base racing pigeons average ~1200 m/min; scale attribute score around that.
  const velocity = (700 + baseAttr * 9) * formFactor * healthFactor * age * weatherFactor * luck;
  return round1(velocity);
}

/** Every factor that goes into a pigeon's velocity, for diagnostics (admin). */
export interface VelocityBreakdown {
  weights: { speed: number; endurance: number; orientation: number };
  baseAttr: number; // weighted attribute score
  base: number; // 700 + baseAttr*9
  effectiveForm: number; // energie after ervaring-dosing — the ONLY place ervaring shows up
  formFactor: number; // energie multiplier (distance-blended)
  healthFactor: number;
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
  const ageFactor = ageMultiplier(pigeon, currentWeek);
  const base = 700 + baseAttr * 9;
  // Mirrors pigeonVelocity exactly — if these two ever drift the tool is lying.
  const velocityNoLuck = base * formFactor * healthFactor * ageFactor * weatherFactor;
  return {
    weights: { speed: round3(w.speed), endurance: round3(w.endurance), orientation: round3(w.orientation) },
    baseAttr: round1(baseAttr),
    base: round1(base),
    effectiveForm: round1(effectiveForm),
    formFactor: round3(formFactor),
    healthFactor: round3(healthFactor),
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
  /** Birds that lost their way entirely and are not home yet. They are NOT gone —
   *  they turn up at the loft after `days` (see tickStrayReturn). */
  strays: { pigeonId: string; ownerId: string; pigeonName: string; days: number }[];
}

/** Total time (s) to fly `distanceKm` given a per-segment speed profile. */
function profileDuration(distanceKm: number, velocity: number, segMult: number[]): number {
  const segDistM = (distanceKm * 1000) / segMult.length;
  let secs = 0;
  for (const m of segMult) {
    const segSpeed = Math.max(FLIGHT_DYNAMICS.minSegSpeed, velocity * m);
    secs += (segDistM / segSpeed) * 60;
  }
  return secs;
}

/**
 * Build one bird's frozen pace profile: its effective (form-of-the-day + weather)
 * velocity, a sequence of per-segment speed multipliers (so it speeds up/slows
 * down and overtakes others), an optional getting-lost stretch, and — for real
 * races — whether it gives out mid-flight (a DNF you can watch happen). Seeded on
 * the flight id + pigeon id, so it is deterministic and live == final.
 */
function buildPaceProfile(
  flightId: string, pigeon: Pigeon, distanceKm: number, week: number, weatherFactor: number, practice: boolean,
): { velocity: number; segMult: number[]; durationSeconds: number; dnfAtSeconds: number | null; dnfKind: SimEntry['dnfKind']; lost: SimEntry['lost']; strayDays?: number } {
  const FD = FLIGHT_DYNAMICS;
  // Seed on the flight id + bird so every flight is a different race, yet the same
  // flight always rebuilds the identical profile (deterministic: live == final,
  // and a concurrent re-finalize can't diverge).
  const rng = seededRng(hashString('prof:' + flightId + ':' + pigeon.id));
  const rf = (a: number, b: number) => a + (b - a) * rng();

  // Attribute-driven baseline (weather handled per-bird below, so pass 1.0).
  const baseVel = pigeonVelocity(pigeon, distanceKm, week, 1, 1);

  // Form of the day: everyday swing, plus rarer great / off days for upsets.
  let dayFactor = 1 + (rng() * 2 - 1) * FD.dayNoise;
  if (rng() < FD.bigDayChance) dayFactor *= rf(FD.bigDayMin, FD.bigDayMax);
  else if (rng() < FD.offDayChance) dayFactor *= rf(FD.offDayMin, FD.offDayMax);

  // Weather affects birds differently: rough weather (factor<1) hurts some more;
  // a tailwind (factor>1) helps some more.
  const rough = Math.max(0, 1 - weatherFactor);
  const tail = Math.max(0, weatherFactor - 1);
  const sensitivity = 0.5 + rng() * FD.weatherSpread;
  const weatherMult = clamp(1 - rough * sensitivity + tail * (0.5 + rng()), 0.4, 1.35);

  const velocity = round1(Math.max(FD.minSegSpeed, baseVel * dayFactor * weatherMult));

  // Per-segment pacing: the source of live overtaking.
  const N = FD.segments;
  const segMult: number[] = [];
  for (let i = 0; i < N; i++) {
    let m = 1 + (rng() * 2 - 1) * FD.segSpread;
    if (rng() < FD.surgeChance) m *= rf(FD.surgeMin, FD.surgeMax);
    segMult.push(clamp(m, 0.1, 2));
  }
  // Normalise so the pacing does NOT change the finish time (Σ 1/m = N): the
  // segments only reshuffle positions mid-race, they don't make a race random.
  // The finish order is set by `velocity` (attributes + form-of-day + weather)
  // and the getting-lost penalty applied AFTER this.
  const invAvg = segMult.reduce((sum, m) => sum + 1 / m, 0) / N;
  for (let i = 0; i < N; i++) segMult[i] = segMult[i] * invAvg;

  // ORIËNTATIE — the whole of what the attribute does (see LOST in gameConfig).
  // The chance rises steeply as orientation drops, grows with DISTANCE (more
  // kilometres = more chances to drift) and with ROUGH WEATHER — and a good
  // navigator is barely troubled by weather that wrecks a poor one.
  let lost: SimEntry['lost'] = null;
  let strayDays: number | undefined;
  let strandedAtSeconds: number | null = null;
  if (!practice) {
    const room = clamp((100 - pigeon.orientation) / 100, 0, 1);
    const strayChance = Math.min(
      LOST.maxChance,
      (LOST.base + LOST.max * Math.pow(room, LOST.curve)) *
        (LOST.distBase + distanceKm * LOST.distPerKm) *
        (1 + rough * LOST.weatherK),
    );
    if (rng() < strayChance) {
      // Where in the route she drifts off, and the cumulative time to get there.
      const span = Math.round(rf(FD.lostSpanMin, FD.lostSpanMax));
      const startSeg = Math.floor(rng() * Math.max(1, N - span));
      const endSeg = Math.min(N, startSeg + span);
      const segDistM = (distanceKm * 1000) / N;
      let atSecs = 0;
      for (let i = 0; i < startSeg; i++) {
        atSecs += (segDistM / Math.max(FD.minSegSpeed, velocity * segMult[i])) * 60;
      }

      // Does she lose the way ENTIRELY? Only a genuinely poor navigator, and
      // mostly on a long flight. She is never gone for good — she finds her way
      // back to the loft after a few days (tickStrayReturn).
      if (rng() < LOST.strandedMax * Math.pow(room, LOST.strandedCurve)) {
        strandedAtSeconds = Math.round(atSecs);
        const days =
          LOST.returnDaysBase + distanceKm * LOST.returnDaysPerKm + room * LOST.returnDaysRoom;
        strayDays = Math.max(1, round1(days * rf(1 - LOST.returnDaysJitter, 1 + LOST.returnDaysJitter)));
      } else {
        // A plain detour: real extra kilometres. The slowdown is derived FROM the
        // detour so the time lost is exactly what those extra km cost her.
        const detourKm = Math.max(
          1,
          Math.round(
            distanceKm * LOST.detourFraction * (LOST.detourSeverityBase + LOST.detourSeveritySpread * room),
          ),
        );
        const spanDistM = segDistM * (endSeg - startSeg);
        const slow = spanDistM / (spanDistM + detourKm * 1000);
        for (let i = startSeg; i < endSeg; i++) segMult[i] = clamp(segMult[i] * slow, 0.05, 2);
        lost = { atSeconds: Math.round(atSecs), detourKm };
      }
    }
  }

  const durationSeconds = Math.max(MIN_FLIGHT_SECONDS, Math.round(profileDuration(distanceKm, velocity, segMult)));

  // Giving out mid-flight (only real races). Exhaustion scales with low start
  // energie; a small injury chance rises in rough weather.
  let dnfAtSeconds: number | null = null;
  let dnfKind: SimEntry['dnfKind'] = null;
  if (!practice) {
    const exhaustChance = clamp((FLIGHT_RISK.dnfFormThreshold - pigeon.form) / FLIGHT_RISK.dnfFormThreshold, 0, FLIGHT_RISK.dnfMaxChance);
    const injuryChance = FD.injuryDnfBase + rough * FD.injuryDnfWeatherBonus;
    if (rng() < exhaustChance) dnfKind = 'exhausted';
    else if (rng() < injuryChance) dnfKind = 'injury';
    if (dnfKind) dnfAtSeconds = Math.round(durationSeconds * rf(FD.dnfEarliestFrac, FD.dnfLatestFrac));
    // Losing the way entirely wins over the other two: she is not exhausted or
    // hurt, she simply has no idea where she is. Keeps the live board honest.
    if (strandedAtSeconds != null) {
      dnfKind = 'lost';
      dnfAtSeconds = strandedAtSeconds;
    }
  }

  return { velocity, segMult, durationSeconds, dnfAtSeconds, dnfKind, lost, strayDays };
}

/** How far home a bird is at `elapsed` seconds, from its frozen pace profile.
 *  Stops (freezes) at a mid-flight DNF or the moment its owner pulled it. */
function raceProgress(s: SimEntry, distanceKm: number, elapsed: number): {
  kmDone: number; finished: boolean; stopped: boolean; curMult: number;
} {
  const seg = s.segMult;
  const stopAt = s.gaveUpAtSeconds ?? (s.dnfAtSeconds ?? Infinity);
  const tEff = Math.min(Math.max(0, elapsed), stopAt);
  if (!seg || seg.length === 0) {
    // Legacy flight (pre-profile): constant velocity fallback.
    const prog = clamp(tEff / s.durationSeconds, 0, 1);
    return { kmDone: round1(distanceKm * prog), finished: !s.gaveUp && elapsed >= s.durationSeconds, stopped: false, curMult: 1 };
  }
  const N = seg.length;
  const segDistM = (distanceKm * 1000) / N;
  let tAcc = 0, kmM = 0, curMult = seg[N - 1];
  for (let i = 0; i < N; i++) {
    const segSpeed = Math.max(FLIGHT_DYNAMICS.minSegSpeed, s.velocity * seg[i]);
    const segTime = (segDistM / segSpeed) * 60;
    if (tEff >= tAcc + segTime) { kmM += segDistM; tAcc += segTime; continue; }
    kmM += segDistM * clamp((tEff - tAcc) / segTime, 0, 1);
    curMult = seg[i];
    break;
  }
  const kmDone = round1(Math.min(distanceKm, kmM / 1000));
  const stopped = !!s.gaveUp || (s.dnfAtSeconds != null && elapsed >= s.dnfAtSeconds);
  const finished = !stopped && elapsed >= s.durationSeconds;
  return { kmDone, finished, stopped, curMult };
}

/**
 * Start a scheduled flight: apply the weather, freeze each pigeon's VARYING pace
 * profile (see buildPaceProfile) and its resulting homing duration, and flip the
 * flight to `live`. Positions for the rest of the race are derived from this
 * frozen `sim`, so birds overtake and the final result matches the live board.
 */
export function startLiveFlight(flight: Flight, entries: Entry[], week: number, weather?: WeatherResult): void {
  if (flight.relay) return startLiveRelay(flight, entries, week);
  const w = weather ?? randomWeather();
  flight.weather = w.label;
  flight.weatherFactor = w.factor;
  // Reference moment for the rest deduction: when THIS race starts (see RECOVERY).
  const startMs = Date.parse(flight.startAt) || Date.now();
  flight.sim = entries.map((e) => {
    const prof = buildPaceProfile(flight.id, e.pigeon, flight.distanceKm, week, w.factor, !!flight.practice);
    // Freeze the total energie this bird spends flying the full route. It is
    // drained gradually during the race (tickFlightEnergy), so a bird pulled
    // out mid-flight has already paid for the distance it covered. An oefenvlucht
    // costs almost nothing.
    // Ervaring makes flying more efficient: an experienced bird burns less
    // energie, an inexperienced one burns more (pivot at ervaring 50 = ×1.0).
    const expRelief = 1 - (clamp(e.pigeon.experience, 0, 100) / 100 - 0.5) * FLIGHT_FATIGUE.experienceReliefSpread;
    // A detour is real extra kilometres, so it costs real extra energie — that is
    // why a bird that wandered off comes home emptier than the rest.
    const flownKm = flight.distanceKm + (prof.lost?.detourKm ?? 0);
    const formCost = flight.practice
      ? PRACTICE.energyCost
      : round1((FLIGHT_FATIGUE.base + flownKm / FLIGHT_FATIGUE.perKmDivisor) * expRelief + randFloat(0, FLIGHT_FATIGUE.jitter));
    return {
      pigeonId: e.pigeon.id,
      pigeonName: e.pigeon.name,
      ownerId: e.pigeon.ownerId,
      ownerName: e.ownerName,
      velocity: prof.velocity,
      durationSeconds: prof.durationSeconds,
      segMult: prof.segMult,
      dnfAtSeconds: prof.dnfAtSeconds,
      dnfKind: prof.dnfKind,
      lost: prof.lost,
      strayDays: prof.strayDays,
      startForm: e.pigeon.form,
      startVorm: flightForm(e.pigeon, startMs),
      formCost,
      formDrained: 0,
    };
  });
  flight.status = 'live';
}

/**
 * When the flight is over (seconds). There is NO finish-timer/cutoff: the race
 * runs until the LAST bird that actually finishes is home, so every bird gets
 * the time to (possibly) fly home — a slow or strayed bird is no longer cut off
 * just because the leader arrived long ago. Birds pulled by their owner (gaveUp)
 * or that give out mid-flight (dnfAtSeconds) never come home and don't set the
 * clock.
 */
export function flightTotalSeconds(flight: Flight): number {
  if (flight.relay) return relayTotalSeconds(flight);
  const durations = flight.sim.filter((s) => !s.gaveUp && s.dnfAtSeconds == null).map((s) => s.durationSeconds);
  if (durations.length === 0) {
    // Nobody finishes — fall back to the slowest scheduled duration so the race
    // still ends in bounded time.
    const all = flight.sim.map((s) => s.durationSeconds);
    return all.length ? Math.max(1, Math.min(...all)) : 1;
  }
  // The slowest actual finisher closes the race (no cutoff cap).
  return Math.max(1, Math.max(...durations));
}

// --- Estafettevlucht ---------------------------------------------------------

/**
 * A relay team's frozen race, read off its birds' pace profiles.
 *
 * The legs run back to back — only one bird of a team is airborne at a time — so
 * the team's clock is simply its legs added up. The moment ANY bird fails to
 * make it (pulled by its owner or gave out mid-leg) the team is eliminated and
 * the birds behind it never fly at all.
 */
export interface RelayTeam {
  ownerId: string;
  ownerName: string;
  legs: SimEntry[]; // ordered leg 1..n
  outAtLeg: number | null; // the leg whose bird never made it
  outSeconds: number | null; // race-clock second the team dropped out
  totalSeconds: number; // race-clock second the anchor got home (if it did)
  finished: boolean;
}

/** Every team in a relay flight, with its frozen outcome. */
export function relayTeams(flight: Flight): RelayTeam[] {
  const teams: RelayTeam[] = [];
  for (const [ownerId, legs] of relaySimTeams(flight)) {
    let offset = 0;
    let outAtLeg: number | null = null;
    let outSeconds: number | null = null;
    for (let i = 0; i < legs.length; i++) {
      const s = legs[i];
      // Both timers are LEG-local (see giveUpFlight), so they compare directly
      // against this bird's own duration.
      const stop = s.gaveUp ? (s.gaveUpAtSeconds ?? 0) : s.dnfAtSeconds ?? null;
      if (stop != null) {
        outAtLeg = s.leg ?? i + 1;
        outSeconds = offset + stop;
        break;
      }
      offset += s.durationSeconds;
    }
    teams.push({
      ownerId,
      ownerName: legs[0]?.ownerName ?? '',
      legs,
      outAtLeg,
      outSeconds,
      totalSeconds: offset,
      finished: outAtLeg === null && legs.length === RELAY.teamSize,
    });
  }
  return teams;
}

/** Where a team is at `elapsed` seconds: ground covered plus who is flying. */
export function relayTeamProgress(team: RelayTeam, legKm: number, elapsed: number): {
  kmDone: number; activeLeg: number; active: SimEntry | null; curMult: number; finished: boolean; out: boolean;
} {
  let km = 0;
  for (let i = 0; i < team.legs.length; i++) {
    const s = team.legs[i];
    const local = elapsed - (s.legStartSeconds ?? 0);
    if (local <= 0) {
      // Waiting at the handover for its turn — the team is parked on this leg.
      return { kmDone: round1(km), activeLeg: s.leg ?? i + 1, active: s, curMult: 1, finished: false, out: false };
    }
    const prog = raceProgress(s, legKm, local);
    km += prog.kmDone;
    if (prog.stopped) {
      return { kmDone: round1(km), activeLeg: s.leg ?? i + 1, active: s, curMult: prog.curMult, finished: false, out: true };
    }
    if (!prog.finished) {
      return { kmDone: round1(km), activeLeg: s.leg ?? i + 1, active: s, curMult: prog.curMult, finished: false, out: false };
    }
  }
  return { kmDone: round1(km), activeLeg: 0, active: null, curMult: 1, finished: team.finished, out: !team.finished };
}

/**
 * When a relay is over: the slowest team that actually gets home closes it. If
 * no team makes it, the race ends when the last team drops out, so it still
 * finishes in bounded time.
 */
function relayTotalSeconds(flight: Flight): number {
  const teams = relayTeams(flight);
  const done = teams.filter((t) => t.finished).map((t) => t.totalSeconds);
  if (done.length > 0) return Math.max(1, Math.max(...done));
  const out = teams.map((t) => t.outSeconds ?? t.totalSeconds).filter((n) => n > 0);
  return out.length ? Math.max(1, Math.max(...out)) : 1;
}

/**
 * The final team order: teams that got home first (fastest total time), then the
 * eliminated ones by how far they actually got. An eliminated team can therefore
 * still land in a paying slot — but never ahead of a team that made it home.
 */
export function relayStandings(flight: Flight): RelayTeam[] {
  const legKm = relayLegKm(flight);
  const total = relayTotalSeconds(flight);
  const teams = relayTeams(flight);
  const reached = new Map(teams.map((t) => [t.ownerId, relayTeamProgress(t, legKm, t.outSeconds ?? total).kmDone]));
  const home = teams.filter((t) => t.finished).sort((a, b) => a.totalSeconds - b.totalSeconds);
  const gone = teams.filter((t) => !t.finished).sort((a, b) => (reached.get(b.ownerId) ?? 0) - (reached.get(a.ownerId) ?? 0));
  return [...home, ...gone];
}

/**
 * Release a relay: freeze a pace profile per bird over ITS OWN leg, using that
 * leg's own weather (which is why the running order matters), and record when
 * each bird is handed the baton. Legs are equal in length, so a team's total is
 * purely the three birds added up.
 */
function startLiveRelay(flight: Flight, entries: Entry[], week: number): void {
  const legKm = relayLegKm(flight);
  const startMs = Date.parse(flight.startAt) || Date.now();
  const byId = new Map(entries.map((e) => [e.pigeon.id, e]));
  const sim: SimEntry[] = [];
  for (const [, teamEntries] of relayEntryTeams(flight)) {
    let offset = 0;
    for (let i = 0; i < teamEntries.length; i++) {
      const fe = teamEntries[i];
      const e = byId.get(fe.pigeonId);
      if (!e) continue;
      const legIndex = fe.leg ?? i + 1;
      const leg = flight.legs?.[legIndex - 1];
      const weatherFactor = leg?.weatherFactor ?? 1;
      const prof = buildPaceProfile(flight.id, e.pigeon, legKm, week, weatherFactor, false);
      // Each bird pays only for its own leg — a third of the route.
      const expRelief = 1 - (clamp(e.pigeon.experience, 0, 100) / 100 - 0.5) * FLIGHT_FATIGUE.experienceReliefSpread;
      const formCost = round1((FLIGHT_FATIGUE.base + legKm / FLIGHT_FATIGUE.perKmDivisor) * expRelief + randFloat(0, FLIGHT_FATIGUE.jitter));
      sim.push({
        pigeonId: e.pigeon.id,
        pigeonName: e.pigeon.name,
        ownerId: e.pigeon.ownerId,
        ownerName: e.ownerName,
        velocity: prof.velocity,
        durationSeconds: prof.durationSeconds,
        segMult: prof.segMult,
        dnfAtSeconds: prof.dnfAtSeconds,
        dnfKind: prof.dnfKind,
        lost: prof.lost,
        startForm: e.pigeon.form,
        startVorm: flightForm(e.pigeon, startMs),
        formCost,
        formDrained: 0,
        leg: legIndex,
        legStartSeconds: offset,
      });
      offset += prof.durationSeconds;
    }
  }
  flight.sim = sim;
  // The flight-level weather line summarises the three legs (each has its own).
  const labels = (flight.legs ?? []).map((l, i) => `etappe ${i + 1}: ${l.weather || 'onbekend'}`);
  if (labels.length) {
    flight.weather = labels.join(' · ');
    flight.weatherFactor = round1((flight.legs ?? []).reduce((s, l) => s + l.weatherFactor, 0) / (flight.legs?.length || 1));
  }
  flight.status = 'live';
}

/**
 * Is this bird STILL out on this flight, or is its own race already over?
 *
 * A flight only ends when its slowest finisher is home (there is no cutoff any
 * more), and on a 1000 km fond flight that tail can run for hours. A bird that
 * crossed the line long before that is home in every sense — its energie is fully
 * drained (tickFlightEnergy settles a bird the moment it stops) and its placing is
 * locked in (computeFinishPayouts already banked its prize) — so it should not stay
 * tied up waiting for a straggler.
 *
 * The end of a bird's own race is read from the FROZEN sim, so this is exact and
 * deterministic: it crossed the line (durationSeconds), it gave out mid-flight
 * (dnfAtSeconds), or its owner pulled it (gaveUpAtSeconds).
 *
 * An estafettevlucht runs on leg clocks: a bird is committed from the start (it
 * still has to fly its leg) until `legStartSeconds` + its own leg time. If a
 * team-mate ahead of it never makes it, the team is out and the birds behind are
 * never released at all — they come free the moment the team drops out.
 */
export function birdStillOut(flight: Flight, pigeonId: string, nowMs: number): boolean {
  if (flight.status === 'completed') return false;
  if (flight.status !== 'live') return true; // scheduled: the race is still ahead of it
  const s = flight.sim.find((x) => x.pigeonId === pigeonId);
  if (!s) return false; // no frozen profile → it isn't flying this one
  const startMs = flight.startAt ? Date.parse(flight.startAt) : NaN;
  if (Number.isNaN(startMs)) return false;
  const elapsed = (nowMs - startMs) / 1000;
  // Leg-local end of this bird's own effort (both timers are leg-local, see
  // giveUpFlight); for a normal flight legStartSeconds is 0 and this is the race clock.
  const localEnd = s.gaveUp
    ? s.gaveUpAtSeconds ?? 0
    : Math.min(s.dnfAtSeconds ?? Infinity, s.durationSeconds);
  if (flight.relay) {
    const team = relayTeams(flight).find((t) => t.legs.some((l) => l.pigeonId === pigeonId));
    if (!team) return false;
    // A team-mate on an EARLIER leg never made it: this bird is never released.
    if (team.outSeconds != null && (s.leg ?? 0) > (team.outAtLeg ?? 0)) return elapsed < team.outSeconds;
  }
  return elapsed < (s.legStartSeconds ?? 0) + localEnd;
}

/** The calendar day a flight belongs to — the key of the one-race-per-day rule. */
export function flightDay(flight: Flight): string {
  return flight.startAt.slice(0, 10);
}

/**
 * A flight that was called off (no entrants at all, or fewer than two breeders,
 * see tickFlights). It keeps its entries on record and its fees were refunded,
 * but nobody actually flew — so it must not spend a bird's racing day.
 *
 * Recognisable by a COMPLETED flight without a frozen sim: `startLiveFlight` is
 * the only thing that fills `sim`, and a cancelled flight never gets there.
 */
export function flightCancelled(flight: Flight): boolean {
  return flight.status === 'completed' && (flight.sim?.length ?? 0) === 0;
}

/**
 * The hard rule: a bird flies at most ONE race per calendar day.
 *
 * Returns the flight that already claims `pigeonId` on `day` (undefined if the
 * day is still free), skipping `exceptFlightId` — the flight being entered — and
 * flights that were called off.
 *
 * Note how this differs from `pigeonCommittedToFlight`: that one asks whether a
 * bird is tied up *right now* and lets go the moment its own race is over. This
 * one does not care. Once a bird is on a flight of that day, scheduled, running
 * or long since home, the day is spent. Withdrawing (`withdrawFlight`) drops the
 * entry and hands the day back; a race that was actually flown never does.
 */
export function flightClaimingDay(
  db: Database,
  pigeonId: string,
  day: string,
  exceptFlightId?: string,
): Flight | undefined {
  return db.flights.find(
    (f) =>
      f.id !== exceptFlightId &&
      flightDay(f) === day &&
      !flightCancelled(f) &&
      f.entries.some((e) => e.pigeonId === pigeonId),
  );
}

/**
 * Roughly what a route will cost this bird in energie — the same formula the sim
 * freezes at the lossing (minus the detour, which is not knowable up front), with
 * the random jitter taken at its mean. Handy for deciding, before entering, whether
 * a bird can actually fly the distance. Never used for the flight itself.
 */
export function expectedFlightEnergyCost(pigeon: Pigeon, distanceKm: number): number {
  const expRelief = 1 - (clamp(pigeon.experience, 0, 100) / 100 - 0.5) * FLIGHT_FATIGUE.experienceReliefSpread;
  return (
    (FLIGHT_FATIGUE.base + distanceKm / FLIGHT_FATIGUE.perKmDivisor) * expRelief +
    FLIGHT_FATIGUE.jitter / 2
  );
}

/**
 * Is this bird tied up by a flight right now — entered in one that has not started
 * yet, or still out on a live one? Once its own race is over (see birdStillOut) it is
 * FREE again even though the flight itself runs on: it can be entered for a new race,
 * trained, paired, put in the infirmary, given a rest cure, listed or sold.
 */
export function pigeonCommittedToFlight(db: Database, pigeonId: string, nowMs: number = Date.now()): boolean {
  return db.flights.some(
    (f) => f.status !== 'completed' && f.entries.some((e) => e.pigeonId === pigeonId) && birdStillOut(f, pigeonId, nowMs),
  );
}

/** Pick which attribute a bird gets a chance to grow in, weighted by distance. */
/** Weights for WHICH attribute a flight improves — its own table, because the
 *  speed weights now put orientation at 0 (see IMPROVE_WEIGHTING). */
export function improveWeightsForDistance(distanceKm: number) {
  const { shortKm, longKm } = DISTANCE_WEIGHTING;
  const { short, long } = IMPROVE_WEIGHTING;
  const t = clamp((distanceKm - shortKm) / (longKm - shortKm), 0, 1);
  return {
    speed: short.speed + (long.speed - short.speed) * t,
    endurance: short.endurance + (long.endurance - short.endurance) * t,
    orientation: short.orientation + (long.orientation - short.orientation) * t,
  };
}

function pickImproveAttr(w: { speed: number; endurance: number; orientation: number }, rng: () => number): Improvement['attr'] {
  const total = w.speed + w.endurance + w.orientation;
  let r = rng() * total;
  if ((r -= w.speed) < 0) return 'speed';
  if ((r -= w.endurance) < 0) return 'endurance';
  return 'orientation';
}

/**
/** The prize money a finisher has locked in, known the moment it crosses the line. */
export interface FinishPayout {
  pigeonId: string;
  ownerId: string;
  pigeonName: string;
  ownerName: string;
  rank: number; // final placing among FINISHERS (1 = winner)
  prize: number; // prize money for that placing (0 if out of the money)
  finishSeconds: number; // elapsed seconds at which this bird crosses the line
}

/**
 * The money table a flight pays out by placing. Most races use their tier's
 * PRIZE_MONEY; the two specials bring their own: the titanenwedstrijd, and a
 * leeftijdscriterium, whose table depends on the week's format (a sprint pays
 * less than a grote fond).
 */
export function flightPrizes(flight: Flight): readonly number[] {
  if (flight.ageCat) return flight.cupSprint ? AGE_CUP.sprint.prizes : AGE_CUP.fond.prizes;
  if (flight.titan) return TITAN.prizes;
  return PRIZE_MONEY[flight.type];
}

/**
 * The per-finisher prize payouts for a flight, derived purely from the FROZEN sim
 * — so they are known (and final) the moment each bird finishes, long before the
 * slowest straggler is home. Uses the exact same finisher ordering as
 * finalizeFlight (sort by durationSeconds, DNFs excluded), so a bird's rank/prize
 * here is identical to what finalize will record. A finisher's rank can never
 * change after it crosses (any faster bird that gets pulled is pulled BEFORE it
 * finishes), so paying on finish is safe. Practice flights pay nothing.
 */
export function computeFinishPayouts(flight: Flight): FinishPayout[] {
  if (flight.practice) return [];
  if (flight.relay) {
    // A relay pays per TEAM, banked on its anchor bird. Safe to pay early: an
    // eliminated team always ranks behind every team that gets home, so a
    // finishing team's placing is locked the moment its anchor is in.
    return relayTeams(flight)
      .filter((t) => t.finished)
      .sort((a, b) => a.totalSeconds - b.totalSeconds)
      .map((t, i) => {
        const anchor = t.legs[t.legs.length - 1];
        return {
          pigeonId: anchor.pigeonId,
          ownerId: t.ownerId,
          pigeonName: anchor.pigeonName,
          ownerName: t.ownerName,
          rank: i + 1,
          prize: RELAY.prizes[i] ?? 0,
          finishSeconds: t.totalSeconds,
        };
      });
  }
  const prizes = flightPrizes(flight);
  const isDnf = (s: SimEntry) => s.gaveUp || s.dnfAtSeconds != null;
  const finishers = flight.sim.filter((s) => !isDnf(s)).sort((a, b) => a.durationSeconds - b.durationSeconds);
  return finishers.map((s, i) => ({
    pigeonId: s.pigeonId,
    ownerId: s.ownerId,
    pigeonName: s.pigeonName,
    ownerName: s.ownerName,
    rank: i + 1,
    prize: prizes[i] ?? 0,
    finishSeconds: s.durationSeconds,
  }));
}

/**
 * Finalize a live flight into ranked results and return the effects to apply.
 * Ranks by finish time (shortest = winner). Also rolls each bird's chance to
 * permanently improve (racing builds condition) and writes the flight's recap.
 */
export function finalizeFlight(flight: Flight, pigeons: Pigeon[]): SimulatedFlight {
  if (flight.practice) return finalizePracticeFlight(flight, pigeons);
  if (flight.relay) return finalizeRelayFlight(flight, pigeons);
  // A titanenwedstrijd and a leeftijdscriterium both pay their own money prizes
  // and NO seizoenspunten for the melker standings.
  const prizes = flightPrizes(flight);
  const results: FlightResult[] = [];
  const payoutMap = new Map<string, { prize: number; points: number; wins: number }>();
  const fatigue: SimulatedFlight['fatigue'] = [];
  const improvements: Improvement[] = [];
  const injuries: FlightInjury[] = [];
  const deaths: SimulatedFlight['deaths'] = [];
  const strays: SimulatedFlight['strays'] = [];
  const w = weightsForDistance(flight.distanceKm);
  // Distance is only a MODIFIER now (×0.75 at 150 km to ×1.6 at 1000 km); what
  // actually decides a strain injury is the bird's vluchtvorm (see INJURY).
  const distanceFactor = INJURY.distBase + flight.distanceKm * INJURY.distPerKm;

  // Seed all randomness on the flight id so finalizing is DETERMINISTIC: if two
  // concurrent requests both finalize this flight (a race), they produce the
  // exact same ranks, effects and notifications instead of contradicting each
  // other (e.g. one says 4th, the other last).
  const rng = seededRng(hashString(flight.id + ':finalize'));
  const rf = (a: number, b: number) => a + (b - a) * rng();

  // Who makes it home. Ways to NOT finish, all decided at RELEASE (frozen in the
  // sim) so the live board and this result always agree: pulled by the owner
  // (gaveUp) or gave out mid-flight (dnfAtSeconds — exhaustion or injury). There
  // is no finish-timer any more, so a merely slow or strayed bird still comes
  // home. `exhausted` = the DNFs that leave a bird strung out (everything except
  // a clean injury), which raises its injury risk below.
  const total = flightTotalSeconds(flight);
  const gaveUpSet = new Set<string>();
  const gaveOut = new Set<string>();
  const exhausted = new Set<string>();
  for (const s of flight.sim) {
    if (s.gaveUp) { gaveUpSet.add(s.pigeonId); continue; }
    if (s.dnfAtSeconds != null) {
      gaveOut.add(s.pigeonId);
      if (s.dnfKind !== 'injury') exhausted.add(s.pigeonId);
    }
  }
  const isDnfId = (id: string) => gaveUpSet.has(id) || gaveOut.has(id);
  // How far a non-finisher actually got (for ordering the tail of the field).
  const reachedKm = (s: SimEntry) => raceProgress(s, flight.distanceKm, s.dnfAtSeconds ?? total).kmDone;
  const finishers = flight.sim.filter((s) => !isDnfId(s.pigeonId)).sort((a, b) => a.durationSeconds - b.durationSeconds);
  const nonFinishers = flight.sim.filter((s) => isDnfId(s.pigeonId)).sort((a, b) => reachedKm(b) - reachedKm(a));
  const ordered = [...finishers, ...nonFinishers];
  const n = finishers.length;

  ordered.forEach((s, i) => {
    const isDnf = isDnfId(s.pigeonId);
    const gaveUp = gaveUpSet.has(s.pigeonId);
    const rank = i + 1;
    // De titanenwedstrijd en het leeftijdscriterium geven geen seizoenspunten voor
    // de melkerranglijst (enkel prijzengeld). Het criterium kent zijn eigen punten
    // toe aan de DUIF — dat gebeurt in tickFlights, uit `results[].rank`.
    const points = isDnf || flight.titan || flight.ageCat ? 0 : RANKING_POINTS[i] ?? 0;
    const prize = isDnf ? 0 : prizes[i] ?? 0;
    results.push({
      pigeonId: s.pigeonId,
      pigeonName: s.pigeonName,
      ownerId: s.ownerId,
      ownerName: s.ownerName,
      // Realized average speed over the whole route (reflects the varied pacing),
      // so the km/h shown matches the finish time.
      velocity: isDnf ? 0 : round1(((flight.distanceKm * 1000) / s.durationSeconds) * 60),
      timeSeconds: isDnf ? 0 : s.durationSeconds,
      rank,
      points,
      prize,
      finished: !isDnf,
    });
    const acc = payoutMap.get(s.ownerId) ?? { prize: 0, points: 0, wins: 0 };
    // Prize money may already have been paid the instant this bird finished
    // (see schedule.payFinishedFlightPrizes) — if so, don't pay it again here.
    // The result/raceLog still records the full prize it won (below); only the
    // money credited at finalize excludes what was already banked.
    acc.prize += s.prizePaid ? 0 : prize;
    acc.points += points;
    // A titan or criterium win is money-only — it does not count as a competition
    // win for the loft (those drive badges, level and the melker standings).
    if (rank === 1 && !isDnf && !flight.titan && !flight.ageCat) acc.wins += 1;
    payoutMap.set(s.ownerId, acc);

    // Fatigue: racing drains energie, and a bird pays ONLY for the part it flew.
    // Most of it is already gone — it was drained gradually while the bird flew
    // (see tickFlightEnergy). Here we just settle what is left:
    //  - a pulled bird (gaveUp) paid for the distance it covered, nothing more;
    //  - a finisher pays the full frozen route cost;
    //  - a DNF bird pays proportional to how far it got (stops at dnfAtSeconds),
    //    never for the distance it didn't cover. No extra penalty for a DNF —
    //    missing points/prize plus the health/injury hit below is setback enough.
    // Flights that were already live before gradual draining existed have no
    // frozen formCost — fall back to the original lump-sum drain for those.
    const drained = s.formDrained ?? 0;
    let formDelta: number;
    if (s.formCost == null) {
      formDelta = gaveUp
        ? -round1(FLIGHT_FATIGUE.gaveUpBase + flight.distanceKm / FLIGHT_FATIGUE.gaveUpPerKmDivisor + rf(0, FLIGHT_FATIGUE.gaveUpJitter))
        : -round1(FLIGHT_FATIGUE.base + flight.distanceKm / FLIGHT_FATIGUE.perKmDivisor + rf(0, FLIGHT_FATIGUE.jitter));
    } else if (gaveUp) {
      formDelta = 0; // already paid gradually for the distance it flew
    } else {
      // Settle up to the flown share only: full route for a finisher, the part
      // up to dnfAtSeconds for a bird that gave out mid-flight.
      const stopSeconds = s.dnfAtSeconds ?? s.durationSeconds;
      const flownTarget = round1(s.formCost * clamp(stopSeconds / s.durationSeconds, 0, 1));
      formDelta = -round1(Math.max(0, flownTarget - drained));
    }
    const enduranceDelta = isDnf ? 0 : round1(0.3 + flight.distanceKm / 500 + rf(0, 0.4));
    // Racing is real wear: the further it flew AND the emptier it came home, the
    // more health it costs. This is what turns gezondheid into a resource you
    // manage over weeks instead of a number pinned at 100.
    const endEnergie = clamp((s.startForm ?? 100) - (s.formCost ?? 0), 0, 100);
    const healthDelta = gaveUp
      ? 0
      : -round1(
          (HEALTH.flightHealthBase + flight.distanceKm * HEALTH.flightHealthPerKm) *
            (1 + ((100 - endEnergie) / 100) * HEALTH.emptyTankFactor) +
            (isDnf ? rf(4, 9) : 0),
        );
    const pigeon = pigeons.find((p) => p.id === s.pigeonId);
    // Ervaring has diminishing returns: the same ride teaches a rookie far more
    // than a veteran (experienceGain scales the raw gain by the room left).
    const experienceDelta = round1(
      experienceGain(pigeon?.experience ?? 0, (isDnf ? 1 : 2) + flight.distanceKm / 100),
    );
    fatigue.push({ pigeonId: s.pigeonId, formDelta, enduranceDelta, healthDelta, experienceDelta });

    if (pigeon) {
      // Racing builds condition (finishers only): a chance to grow in the
      // attribute that matters most for this distance. The WORSE the bird is
      // overall AND the BETTER it placed, the more likely it improves — and the
      // more it gains — so a lesser bird that punches above its weight catches up.
      if (!isDnf) {
        const attr = pickImproveAttr(improveWeightsForDistance(flight.distanceKm), rng);
        // Racing can only lift a skill up to min(90, geneCap) — beyond 90 only the
        // coach helps. `room` is measured against that per-bird ceiling, so gains
        // shrink to ~0 as the skill approaches 90 (the 80→90 grind).
        const cap = raceCeil(pigeon, attr);
        const room = clamp((cap - pigeon[attr]) / cap, 0, 1);
        const avgAttr = (pigeon.speed + pigeon.endurance + pigeon.orientation) / 3;
        const weakness = clamp(1 - avgAttr / 100, 0, 1); // weaker bird → larger
        const placeFactor = n > 1 ? (n - i) / n : 1; // winner ~1 → last finisher ~1/n
        const chance = clamp(
          IMPROVE.baseChance * (0.4 + room) * (0.5 + weakness * IMPROVE.weaknessWeight) * (0.6 + placeFactor * 0.8),
          0, IMPROVE.maxChance,
        );
        if (pigeon[attr] < cap && rng() < chance) {
          const gain = round1(rf(IMPROVE.gainMin, IMPROVE.gainMax) * (0.4 + room) * (1 + weakness * IMPROVE.weaknessGainSpread));
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

      // She lost her way completely and is not home yet. Not gone — she turns up
      // at the loft in a few days (tickStrayReturn). A bird its owner pulled back
      // never wandered off, and a strayed bird is not strained or hurt: she simply
      // has no idea where she is, so she skips the injury roll below.
      const strayedOff = !gaveUp && !died && s.dnfKind === 'lost';
      if (strayedOff) {
        strays.push({
          pigeonId: pigeon.id,
          ownerId: pigeon.ownerId,
          pigeonName: pigeon.name,
          days: s.strayDays ?? 2,
        });
      }

      // TWO separate ways to come home hurt (see INJURY in gameConfig):
      //
      //  1. OVERBELASTING — the effort broke the bird down. Runs on the vluchtvorm
      //     it STARTED with (energie + gezondheid, minus the rest deduction for
      //     racing on consecutive days), so keeping a bird well is what protects it.
      //     Its severity follows the same form, so a fit bird strains a muscle where
      //     a spent one breaks a wing.
      //  2. PECH — a hawk, a collision. A small FLAT chance that no amount of care
      //     removes; at top form this is where most of the few injuries come from.
      //
      // A bird its owner pulled (gaveUp) is spared the strain, but a sperwer does
      // not care that you called your bird in — bad luck still applies.
      // The vluchtvorm frozen at release. Legacy flights (started before this
      // existed) fall back to the bird's current condition, which is close enough.
      const startForms = s.startVorm ?? conditionScore(pigeon);
      const strainRoom = Math.max(0, (100 - startForms) / 100);
      let strainChance = gaveUp
        ? 0
        : (INJURY.floor + INJURY.max * Math.pow(strainRoom, INJURY.curve)) * distanceFactor;
      if (exhausted.has(s.pigeonId)) strainChance = Math.max(strainChance, 0.8);
      // A bird that gave out from an injury mid-flight is (almost) certainly hurt.
      if (gaveOut.has(s.pigeonId) && s.dnfKind === 'injury') strainChance = Math.max(strainChance, 0.95);
      const luckChance = INJURY.luckBase * distanceFactor;

      if (!died && !strayedOff && !pigeon.ailment) {
        if (rng() < clamp(strainChance, 0, 0.95)) {
          injuries.push({
            pigeonId: pigeon.id,
            ownerId: pigeon.ownerId,
            pigeonName: pigeon.name,
            ailment: randomStrainInjury(flight.week, startForms, rng),
          });
        } else if (rng() < clamp(luckChance, 0, 0.95)) {
          injuries.push({
            pigeonId: pigeon.id,
            ownerId: pigeon.ownerId,
            pigeonName: pigeon.name,
            ailment: randomLuckInjury(flight.week, rng),
          });
        }
      }
    }
  });

  flight.results = results;
  flight.recap = generateRecap(flight);
  flight.status = 'completed';
  const payouts = [...payoutMap.entries()].map(([ownerId, v]) => ({ ownerId, ...v }));
  return { fatigue, payouts, improvements, injuries, deaths, strays };
}

/**
 * Finalize an estafettevlucht into ranked TEAMS.
 *
 * Teams that got home rank first on total time; the eliminated ones follow on
 * ground covered, so a team that dropped out can still take a paying slot when
 * few teams make it. Prize money is per team (credited once, recorded on the
 * anchor bird) and there are NO ranking points. Only birds that actually flew
 * pay energie or run any risk — a bird waiting at a handover when its team was
 * eliminated stays untouched.
 */
function finalizeRelayFlight(flight: Flight, pigeons: Pigeon[]): SimulatedFlight {
  const legKm = relayLegKm(flight);
  const results: FlightResult[] = [];
  const payoutMap = new Map<string, { prize: number; points: number; wins: number }>();
  const fatigue: SimulatedFlight['fatigue'] = [];
  const improvements: Improvement[] = [];
  const injuries: FlightInjury[] = [];
  const deaths: SimulatedFlight['deaths'] = [];
  const strays: SimulatedFlight['strays'] = [];
  const w = weightsForDistance(legKm);
  const distanceFactor = INJURY.distBase + legKm * INJURY.distPerKm;
  const rng = seededRng(hashString(flight.id + ':finalize'));
  const rf = (a: number, b: number) => a + (b - a) * rng();

  const standings = relayStandings(flight);
  const teamCount = standings.length;

  standings.forEach((team, ti) => {
    const rank = ti + 1;
    const prize = RELAY.prizes[ti] ?? 0;
    const anchor = team.legs[team.legs.length - 1];
    const outAt = team.outAtLeg ?? Infinity;

    const acc = payoutMap.get(team.ownerId) ?? { prize: 0, points: 0, wins: 0 };
    // The anchor may already have banked the money the moment it landed
    // (payFinishedFlightPrizes) — don't pay a winning team twice.
    acc.prize += anchor?.prizePaid ? 0 : prize;
    payoutMap.set(team.ownerId, acc);

    for (let i = 0; i < team.legs.length; i++) {
      const s = team.legs[i];
      const leg = s.leg ?? i + 1;
      const flew = leg <= outAt; // the failing bird still flew part of its leg
      const completed = leg < outAt || team.finished;
      const gaveUp = !!s.gaveUp;

      results.push({
        pigeonId: s.pigeonId,
        pigeonName: s.pigeonName,
        ownerId: s.ownerId,
        ownerName: s.ownerName,
        // Its own average over its own leg — directly comparable with any other
        // flight, which is what feeds the duivenranglijsten.
        velocity: completed ? round1(((legKm * 1000) / s.durationSeconds) * 60) : 0,
        timeSeconds: completed ? s.durationSeconds : 0,
        rank,
        points: 0, // money only — no seizoenspunten
        // The team's prize sits on the bird that brought it home, so the money in
        // the result rows adds up to exactly what the loft was paid.
        prize: leg === RELAY.teamSize ? prize : 0,
        finished: completed,
      });

      if (!flew) continue; // never left the handover: no cost, no risk, no gain

      // Energie: settle what the gradual drain has not taken yet, for the flown
      // share of its own leg only.
      const drained = s.formDrained ?? 0;
      let formDelta: number;
      if (s.formCost == null) {
        formDelta = -round1(FLIGHT_FATIGUE.base + legKm / FLIGHT_FATIGUE.perKmDivisor + rf(0, FLIGHT_FATIGUE.jitter));
      } else if (gaveUp) {
        formDelta = 0; // already paid gradually for the distance it flew
      } else {
        const stopSeconds = s.dnfAtSeconds ?? s.durationSeconds;
        const flownTarget = round1(s.formCost * clamp(stopSeconds / s.durationSeconds, 0, 1));
        formDelta = -round1(Math.max(0, flownTarget - drained));
      }
      const enduranceDelta = completed ? round1(0.3 + legKm / 500 + rf(0, 0.4)) : 0;
      const endEnergie = clamp((s.startForm ?? 100) - (s.formCost ?? 0), 0, 100);
      const healthDelta = gaveUp
        ? 0
        : -round1(
            (HEALTH.flightHealthBase + legKm * HEALTH.flightHealthPerKm) *
              (1 + ((100 - endEnergie) / 100) * HEALTH.emptyTankFactor) +
              (completed ? 0 : rf(4, 9)),
          );
      const pigeon = pigeons.find((p) => p.id === s.pigeonId);
      // Diminishing returns on ervaring — same curve as a solo race.
      const experienceDelta = round1(experienceGain(pigeon?.experience ?? 0, (completed ? 2 : 1) + legKm / 100));
      fatigue.push({ pigeonId: s.pigeonId, formDelta, enduranceDelta, healthDelta, experienceDelta });

      if (!pigeon) continue;

      // Growth, on the team's placing (you fly for the team, not for yourself).
      if (completed) {
        // Judged on the LEG this bird actually flew, not the whole relay route.
        const attr = pickImproveAttr(improveWeightsForDistance(legKm), rng);
        const cap = raceCeil(pigeon, attr);
        const room = clamp((cap - pigeon[attr]) / cap, 0, 1);
        const avgAttr = (pigeon.speed + pigeon.endurance + pigeon.orientation) / 3;
        const weakness = clamp(1 - avgAttr / 100, 0, 1);
        const placeFactor = teamCount > 1 ? (teamCount - ti) / teamCount : 1;
        const chance = clamp(
          IMPROVE.baseChance * (0.4 + room) * (0.5 + weakness * IMPROVE.weaknessWeight) * (0.6 + placeFactor * 0.8),
          0, IMPROVE.maxChance,
        );
        if (pigeon[attr] < cap && rng() < chance) {
          const gain = round1(rf(IMPROVE.gainMin, IMPROVE.gainMax) * (0.4 + room) * (1 + weakness * IMPROVE.weaknessGainSpread));
          if (gain > 0) improvements.push({ pigeonId: pigeon.id, ownerId: pigeon.ownerId, pigeonName: pigeon.name, attr, gain });
        }
      }

      // Same dangers as any competition flight, judged on the energie the bird
      // was released with. A bird its owner pulled is spared the strain.
      const startForm = s.startForm ?? pigeon.form;
      let died = false;
      if (!gaveUp && startForm < TOURNEY_RISK.deathThreshold && rng() < TOURNEY_RISK.deathChance) {
        deaths.push({ pigeonId: pigeon.id, ownerId: pigeon.ownerId, pigeonName: pigeon.name });
        died = true;
      }
      // Lost her way on this leg — the team is out, and she turns up at the loft
      // in a few days (tickStrayReturn). No injury roll: she is not strained.
      const strayedOff = !gaveUp && !died && s.dnfKind === 'lost';
      if (strayedOff) {
        strays.push({
          pigeonId: pigeon.id, ownerId: pigeon.ownerId, pigeonName: pigeon.name,
          days: s.strayDays ?? 2,
        });
      }
      // Strain runs on the vluchtvorm frozen at the start of the leg; bad luck is a
      // small flat chance on top. Same rules as a solo race (see INJURY).
      const startForms = s.startVorm ?? conditionScore(pigeon);
      let strainChance = gaveUp
        ? 0
        : (INJURY.floor + INJURY.max * Math.pow(Math.max(0, (100 - startForms) / 100), INJURY.curve)) * distanceFactor;
      if (!completed && !gaveUp) {
        strainChance = Math.max(strainChance, s.dnfKind === 'injury' ? 0.95 : 0.8);
      }
      if (!died && !strayedOff && !pigeon.ailment) {
        if (rng() < clamp(strainChance, 0, 0.95)) {
          injuries.push({
            pigeonId: pigeon.id, ownerId: pigeon.ownerId, pigeonName: pigeon.name,
            ailment: randomStrainInjury(flight.week, startForms, rng),
          });
        } else if (rng() < clamp(INJURY.luckBase * distanceFactor, 0, 0.95)) {
          injuries.push({
            pigeonId: pigeon.id, ownerId: pigeon.ownerId, pigeonName: pigeon.name,
            ailment: randomLuckInjury(flight.week, rng),
          });
        }
      }
    }
  });

  flight.results = results;
  flight.recap = generateRelayRecap(flight, standings);
  flight.status = 'completed';
  const payouts = [...payoutMap.entries()].map(([ownerId, v]) => ({ ownerId, ...v }));
  return { fatigue, payouts, improvements, injuries, deaths, strays };
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
    const pigeon = pigeons.find((p) => p.id === s.pigeonId);
    // Diminishing returns on ervaring — same curve as a competition flight.
    const experienceDelta = round1(experienceGain(pigeon?.experience ?? 0, 0.5 + rf(0, 0.5)));
    fatigue.push({ pigeonId: s.pigeonId, formDelta, enduranceDelta, healthDelta: 0, experienceDelta });

    if (pigeon) {
      const chance = pigeon.coached ? PRACTICE.coachedImproveChance : PRACTICE.improveChance;
      if (rng() < chance) {
        const attr = pickImproveAttr(PRACTICE.weights, rng);
        // Practice is a flight too → capped at min(90, geneCap).
        const cap = raceCeil(pigeon, attr);
        const room = clamp((cap - pigeon[attr]) / cap, 0, 1);
        // A coach specifically drills conditie/oriëntatie on these flights.
        const coachBonus = pigeon.coached && attr !== 'speed' ? PRACTICE.coachedBonusGain : 0;
        const gain = round1((rf(PRACTICE.gainMin, PRACTICE.gainMax) + coachBonus) * (0.4 + room));
        if (pigeon[attr] < cap && gain > 0) {
          improvements.push({ pigeonId: pigeon.id, ownerId: pigeon.ownerId, pigeonName: pigeon.name, attr, gain });
        }
      }
    }
  });

  flight.results = results;
  flight.recap = generateRecap(flight);
  flight.status = 'completed';
  return { fatigue, payouts: [], improvements, injuries: [], deaths: [], strays: [] };
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

/** One bird's slot in a relay team's running order. */
export interface LiveRelayLeg {
  leg: number;
  pigeonId: string;
  pigeonName: string;
  kmDone: number;
  kmTotal: number;
  speedKmh: number;
  status: 'wachtend' | 'onderweg' | 'binnen' | 'gestopt';
}

/** A relay team on the live board: one row, three birds, one baton. */
export interface LiveRelayTeam {
  ownerId: string;
  ownerName: string;
  kmDone: number;
  kmTotal: number;
  kmRemaining: number;
  progress: number;
  activeLeg: number; // 0 once the team is home or out
  speedKmh: number; // of the bird currently airborne
  legs: LiveRelayLeg[];
  finished: boolean;
  out: boolean;
  etaSeconds: number;
  liveRank: number;
}

export interface LiveSnapshot {
  status: Flight['status'];
  elapsedSeconds: number;
  totalSeconds: number;
  overallProgress: number;
  allFinished: boolean;
  birds: LiveBird[];
  /** Estafettevlucht only: the same race grouped into teams. */
  teams?: LiveRelayTeam[];
}

/** Compute the live positions of every bird from the frozen pace profile + time.
 *  Standings are ranked by distance actually covered, so birds overtake each other
 *  as the race unfolds; at the finish this collapses to the final order (finishers
 *  by time, the rest by how far they got). */
export function liveSnapshot(flight: Flight, nowMs: number): LiveSnapshot {
  if (flight.relay) return relaySnapshot(flight, nowMs);
  const startMs = Date.parse(flight.startAt);
  const elapsed = Math.max(0, (nowMs - startMs) / 1000);
  const total = flightTotalSeconds(flight);
  const dist = flight.distanceKm;
  // Freeze the board at the finish once the race is over (its replay must show the
  // final standings): a bird past the cutoff (durationSeconds > total) then stays a
  // non-finisher, exactly as finalizeFlight records it.
  const view = Math.min(elapsed, total);
  // The displayed km/h is the bird's REAL effective speed on the segment it is
  // flying (frozen velocity × the current pace multiplier × 0.06 to go m/min→km/h)
  // — not a cosmetic number. To keep it steady instead of flickering on every
  // poll, we sample the segment on a 5-minute grid: the value only steps when the
  // race genuinely moves into a new 5-minute block. No random wobble.
  const SPEED_STEP_SECONDS = 300;
  const speedView = Math.min(Math.floor(view / SPEED_STEP_SECONDS) * SPEED_STEP_SECONDS, total);

  const rows = flight.sim.map((s) => {
    const gaveUp = !!s.gaveUp;
    const { kmDone, finished, stopped } = raceProgress(s, dist, view);
    const moving = !finished && !gaveUp && !stopped;
    // Effective speed sampled on the 5-minute grid (honest, stable between polls).
    const { curMult: speedMult } = raceProgress(s, dist, speedView);
    const speedKmh = moving ? round1(s.velocity * speedMult * 0.06) : 0;
    const bird: LiveBird = {
      pigeonId: s.pigeonId,
      pigeonName: s.pigeonName,
      ownerId: s.ownerId,
      ownerName: s.ownerName,
      kmDone,
      kmTotal: dist,
      kmRemaining: round1(Math.max(0, dist - kmDone)),
      speedKmh,
      progress: clamp(kmDone / dist, 0, 1),
      finished,
      gaveUp: gaveUp || stopped, // a bird that gave out is shown as out of the race
      etaSeconds: finished || !moving ? 0 : Math.round(Math.max(0, s.durationSeconds - elapsed)),
      liveRank: 0,
    };
    return { bird, finishTime: s.durationSeconds, out: gaveUp || stopped };
  });

  // Rank: pulled/stopped birds last; then finishers ahead of flyers; finishers by
  // actual finish time; flyers by distance covered (furthest = leading → live
  // overtaking). At the finish this equals finalizeFlight's ordering.
  rows.sort((a, b) => {
    if (a.out !== b.out) return a.out ? 1 : -1;
    const af = a.bird.finished ? 0 : 1, bf = b.bird.finished ? 0 : 1;
    if (af !== bf) return af - bf;
    if (a.bird.finished && b.bird.finished) return a.finishTime - b.finishTime;
    return b.bird.kmDone - a.bird.kmDone;
  });
  const birds = rows.map((r, i) => { r.bird.liveRank = i + 1; return r.bird; });

  return {
    status: flight.status,
    elapsedSeconds: round1(elapsed),
    totalSeconds: total,
    overallProgress: clamp(elapsed / total, 0, 1),
    allFinished: elapsed >= total,
    birds,
  };
}

/**
 * The live board of an estafettevlucht: one row per team, ranked on the ground
 * the team has covered so far. Teams that are home lead, then the teams still
 * flying (furthest first — the baton changes hands mid-race, so the order really
 * moves), and the eliminated teams at the bottom. The per-bird `birds` list is
 * filled in as well, each bird measured over its own leg.
 */
function relaySnapshot(flight: Flight, nowMs: number): LiveSnapshot {
  const startMs = Date.parse(flight.startAt);
  const elapsed = Math.max(0, (nowMs - startMs) / 1000);
  const total = flightTotalSeconds(flight);
  const legKm = relayLegKm(flight);
  const routeKm = legKm * RELAY.teamSize;
  const view = Math.min(elapsed, total);
  const SPEED_STEP_SECONDS = 300;
  const speedView = Math.min(Math.floor(view / SPEED_STEP_SECONDS) * SPEED_STEP_SECONDS, total);

  const birds: LiveBird[] = [];
  const rows = relayTeams(flight).map((team) => {
    const legs: LiveRelayLeg[] = [];
    let kmDone = 0;
    let activeLeg = 0;
    let speedKmh = 0;
    let reachedEnd = true;
    for (let i = 0; i < team.legs.length; i++) {
      const s = team.legs[i];
      const legNo = s.leg ?? i + 1;
      const local = view - (s.legStartSeconds ?? 0);
      let status: LiveRelayLeg['status'] = 'wachtend';
      let legKmDone = 0;
      let legSpeed = 0;
      if (local > 0 && reachedEnd) {
        const prog = raceProgress(s, legKm, local);
        legKmDone = prog.kmDone;
        if (prog.stopped) { status = 'gestopt'; reachedEnd = false; activeLeg = legNo; }
        else if (prog.finished) { status = 'binnen'; }
        else {
          status = 'onderweg';
          activeLeg = legNo;
          reachedEnd = false;
          const { curMult } = raceProgress(s, legKm, Math.max(0, speedView - (s.legStartSeconds ?? 0)));
          legSpeed = round1(s.velocity * curMult * 0.06);
          speedKmh = legSpeed;
        }
      } else if (!reachedEnd) {
        status = 'wachtend';
      }
      kmDone += legKmDone;
      legs.push({
        leg: legNo, pigeonId: s.pigeonId, pigeonName: s.pigeonName,
        kmDone: legKmDone, kmTotal: legKm, speedKmh: legSpeed, status,
      });
      birds.push({
        pigeonId: s.pigeonId,
        pigeonName: s.pigeonName,
        ownerId: s.ownerId,
        ownerName: s.ownerName,
        kmDone: legKmDone,
        kmTotal: legKm,
        kmRemaining: round1(Math.max(0, legKm - legKmDone)),
        speedKmh: legSpeed,
        progress: clamp(legKmDone / legKm, 0, 1),
        finished: status === 'binnen',
        gaveUp: status === 'gestopt',
        etaSeconds: status === 'onderweg' ? Math.round(Math.max(0, (s.legStartSeconds ?? 0) + s.durationSeconds - elapsed)) : 0,
        liveRank: 0,
      });
      if (status === 'gestopt') break;
      if (status === 'wachtend') break;
    }
    const out = legs.some((l) => l.status === 'gestopt');
    const finished = !out && legs.length === RELAY.teamSize && legs.every((l) => l.status === 'binnen');
    const t: LiveRelayTeam = {
      ownerId: team.ownerId,
      ownerName: team.ownerName,
      kmDone: round1(kmDone),
      kmTotal: routeKm,
      kmRemaining: round1(Math.max(0, routeKm - kmDone)),
      progress: clamp(kmDone / routeKm, 0, 1),
      activeLeg: finished || out ? 0 : activeLeg,
      speedKmh,
      legs,
      finished,
      out,
      etaSeconds: finished || out ? 0 : Math.round(Math.max(0, team.totalSeconds - elapsed)),
      liveRank: 0,
    };
    return { t, finishTime: team.totalSeconds };
  });

  rows.sort((a, b) => {
    if (a.t.out !== b.t.out) return a.t.out ? 1 : -1;
    const af = a.t.finished ? 0 : 1, bf = b.t.finished ? 0 : 1;
    if (af !== bf) return af - bf;
    if (a.t.finished && b.t.finished) return a.finishTime - b.finishTime;
    return b.t.kmDone - a.t.kmDone;
  });
  const teams = rows.map((r, i) => { r.t.liveRank = i + 1; return r.t; });
  // Mirror the team ranking onto the flattened bird list so both read the same.
  const teamRank = new Map(teams.map((t) => [t.ownerId, t.liveRank]));
  birds.sort((a, b) => (teamRank.get(a.ownerId) ?? 99) - (teamRank.get(b.ownerId) ?? 99));
  birds.forEach((b, i) => { b.liveRank = i + 1; });

  return {
    status: flight.status,
    elapsedSeconds: round1(elapsed),
    totalSeconds: total,
    overallProgress: clamp(elapsed / total, 0, 1),
    allFinished: elapsed >= total,
    birds,
    teams,
  };
}

export interface CommentLine {
  atSeconds: number;
  text: string;
}

/** One snapshot of the field at an elapsed time, ranked like liveSnapshot. */
interface RankRow {
  s: SimEntry;
  kmDone: number;
  curMult: number; // pace multiplier of the segment it's flying now
  finished: boolean;
  stopped: boolean; // pulled by owner or gave out mid-flight
}

const fillLine = (tpl: string, a: string, b?: string, km?: number | string) =>
  tpl.replace('{name}', a).replace('{name2}', b ?? '').replace('{km}', String(km ?? ''));

/**
 * How often the report samples the field for THIS race.
 *
 * A fixed 10-minute step means a 50-hour fondvlucht is sampled 300 times, and
 * every poll re-derived all of them — the single biggest CPU cost in the game.
 * Above `COMMENTARY_LIMITS.maxSamples` the step is stretched proportionally, so
 * the work is bounded whatever the distance. Derived from the race length alone,
 * so it is deterministic and the feed stays stable across polls.
 */
function commentaryStep(total: number): number {
  const wanted = Math.ceil(total / COMMENTARY_INTERVAL_SECONDS);
  const factor = Math.max(1, Math.ceil(wanted / COMMENTARY_LIMITS.maxSamples));
  return COMMENTARY_INTERVAL_SECONDS * factor;
}

/**
 * The interval scan is the expensive half of the report and only changes when the
 * race clock crosses a sample point — but a poll arrives every few seconds. So we
 * keep the scan per flight and EXTEND it, instead of rebuilding it every request.
 *
 * The cached entry carries its own rng closure so continuing the scan produces
 * exactly the same phrasing a full rebuild would: the overtake stream is seeded
 * separately from the event/finish streams (below), so those stay stable no
 * matter how far the scan has run.
 */
interface CommentaryScan {
  sig: number;
  step: number;
  lines: CommentLine[];
  prev: RankRow[];
  nextT: number;
  interval: number;
  pairMutedUntil: Map<string, number>;
  rng: () => number;
}
const commentaryCache = new Map<string, CommentaryScan>();
const COMMENTARY_CACHE_MAX = 4;

/** Everything the scan reads: a changed sim (a bird pulled out) invalidates it. */
function commentarySignature(flight: Flight): number {
  let h = (hashString(flight.id) ^ Math.round(flight.distanceKm * 10)) >>> 0;
  for (const s of flight.sim) {
    h = (Math.imul(h, 31) + s.durationSeconds) >>> 0;
    h = (Math.imul(h, 31) + (s.gaveUpAtSeconds ?? -1)) >>> 0;
    h = (Math.imul(h, 31) + (s.dnfAtSeconds ?? -1)) >>> 0;
  }
  return h;
}

/**
 * Deterministic, growing commentary feed for a live/completed flight.
 *
 * The feed reports REAL race events derived from the frozen pace profiles rather
 * than random flavour: who overtakes whom (sampled from the actual positions),
 * plus the reason when it is clear — a bird surging ahead, a rival fading, one
 * straying off course (with the rough extra distance), giving out from exhaustion,
 * cramping up, or being pulled by its owner. Seeded on the flight id so it is
 * stable across polls, and grows monotonically (each line has a fixed time).
 *
 * COST: this runs on every live-board poll. The interval scan is cached and
 * extended (see CommentaryScan), bounded to COMMENTARY_LIMITS.maxSamples samples
 * and to passes inside the leading COMMENTARY_LIMITS.field positions. The event
 * and finish lines are O(birds) and recomputed each call so their timing stays
 * exact to the second.
 */
export function flightCommentary(flight: Flight, nowMs: number): CommentLine[] {
  if (flight.sim.length === 0) return [];
  if (flight.relay) return relayCommentary(flight, nowMs);
  const startMs = Date.parse(flight.startAt);
  const elapsed = Math.max(0, (nowMs - startMs) / 1000);
  const total = flightTotalSeconds(flight);
  const dist = flight.distanceKm;

  // Three INDEPENDENT streams. Splitting them is what lets the scan be cached:
  // the event/finish phrasing no longer depends on how many intervals ran.
  const evRng = seededRng(hashString(flight.id + ':ev'));
  const finRng = seededRng(hashString(flight.id + ':fin'));

  const lines: CommentLine[] = scanCommentary(flight, total, dist, Math.min(elapsed, total)).slice();

  // Event lines with a clear cause, at the moment they happen.
  for (const s of flight.sim) {
    if (s.lost) lines.push({ atSeconds: s.lost.atSeconds, text: fillLine(pickWith(evRng, COMMENTARY.stray), s.pigeonName, undefined, s.lost.detourKm) });
    if (s.dnfAtSeconds != null) {
      const pool =
        s.dnfKind === 'lost'
          ? COMMENTARY.dnfLost
          : s.dnfKind === 'injury'
            ? COMMENTARY.dnfInjury
            : COMMENTARY.dnfExhausted;
      lines.push({ atSeconds: s.dnfAtSeconds, text: fillLine(pickWith(evRng, pool), s.pigeonName) });
    }
    if (s.gaveUp && s.gaveUpAtSeconds != null) {
      lines.push({ atSeconds: s.gaveUpAtSeconds, text: fillLine(pickWith(evRng, COMMENTARY.pulled), s.pigeonName) });
    }
  }

  // Finishers: a line as each bird that actually makes it home clocks in.
  for (const s of flight.sim) {
    if (s.gaveUp || s.dnfAtSeconds != null || s.durationSeconds > total + 0.5) continue;
    lines.push({ atSeconds: s.durationSeconds, text: fillLine(pickWith(finRng, COMMENTARY.finish), s.pigeonName) });
  }

  return lines
    .filter((l) => l.atSeconds <= elapsed + 0.5)
    .sort((a, b) => a.atSeconds - b.atSeconds);
}

/**
 * The overtake scan up to `upTo` seconds of race clock, cached and extended in
 * place. Returns the scan's own lines (opening lines included).
 */
function scanCommentary(flight: Flight, total: number, dist: number, upTo: number): CommentLine[] {
  const sig = commentarySignature(flight);
  let sc = commentaryCache.get(flight.id);
  if (!sc || sc.sig !== sig) {
    const rng = seededRng(hashString(flight.id + ':ov'));
    const step = commentaryStep(total);
    const first = rankAtTime(flight, dist, 1);
    // Only the lossing itself. The old "Vroege stand: X op kop, gevolgd door
    // Y en Z" line is gone: the live board right next to the feed already shows
    // the standings, continuously and for the whole field.
    const lines: CommentLine[] = [{ atSeconds: 0, text: pickWith(rng, COMMENTARY.start) }];
    sc = { sig, step, lines, prev: first, nextT: step, interval: 0, pairMutedUntil: new Map(), rng };
    if (commentaryCache.size >= COMMENTARY_CACHE_MAX) {
      commentaryCache.delete(commentaryCache.keys().next().value as string);
    }
    commentaryCache.set(flight.id, sc);
  }

  // Cooldown so two evenly-matched birds that keep trading places aren't reported
  // every single sample (pure oscillation reads as padding). A pair is muted for
  // a few samples after a pass — unless the pass has a real cause (a lead change
  // or a rival going off course), which is always worth a line.
  const PAIR_COOLDOWN = 3;
  const FIELD = COMMENTARY_LIMITS.field;
  const airborne = (r: RankRow) => !r.finished && !r.stopped;
  const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const pick = <T>(pool: readonly T[]): T => pickWith(sc!.rng, pool);

  for (let t = sc.nextT; t <= Math.min(upTo, total); t += sc.step) {
    sc.interval++;
    const now = rankAtTime(flight, dist, t);
    // Only the leading group is interesting — and bounding it here is what keeps
    // the scan linear instead of quadratic in the size of the field.
    const head = now.slice(0, FIELD);
    const prevIdx = new Map<string, number>();
    for (let i = 0; i < sc.prev.length && i < FIELD; i++) prevIdx.set(sc.prev[i].s.pigeonId, i);
    const wasAirborne = new Map<string, boolean>();
    for (let i = 0; i < sc.prev.length && i < FIELD; i++) wasAirborne.set(sc.prev[i].s.pigeonId, airborne(sc.prev[i]));

    type Pass = { a: RankRow; b: RankRow; climb: number };
    const passes: Pass[] = [];
    for (let ai = 0; ai < head.length; ai++) {
      const a = head[ai];
      if (!airborne(a) || !wasAirborne.get(a.s.pigeonId)) continue;
      const aPrev = prevIdx.get(a.s.pigeonId);
      if (aPrev === undefined || ai >= aPrev) continue; // didn't move up
      let scalp: RankRow | null = null, scalpPrev = -1;
      for (let bi = 0; bi < head.length; bi++) {
        const b = head[bi];
        if (b === a || !airborne(b) || !wasAirborne.get(b.s.pigeonId)) continue;
        const bPrev = prevIdx.get(b.s.pigeonId);
        if (bPrev === undefined) continue;
        if (bPrev < aPrev && bi > ai && bPrev > scalpPrev) { scalp = b; scalpPrev = bPrev; }
      }
      if (scalp) passes.push({ a, b: scalp, climb: aPrev - ai });
    }

    passes.sort((x, y) => y.climb - x.climb || x.a.s.pigeonId.localeCompare(y.a.s.pigeonId));
    const used = new Set<string>();
    let emitted = 0;
    for (const p of passes) {
      if (emitted >= 2) break;
      if (used.has(p.a.s.pigeonId) || used.has(p.b.s.pigeonId)) continue;
      const A = p.a, B = p.b;
      const bLost = B.s.lost && t >= B.s.lost.atSeconds && B.curMult < 0.95;
      const isLead = head[0] === A;
      const key = pairKey(A.s.pigeonId, B.s.pigeonId);
      const strongCause = isLead || bLost;
      if (!strongCause && sc.interval < (sc.pairMutedUntil.get(key) ?? 0)) continue;
      used.add(A.s.pigeonId); used.add(B.s.pigeonId);
      sc.pairMutedUntil.set(key, sc.interval + PAIR_COOLDOWN);
      emitted++;
      let text: string;
      if (isLead) {
        text = fillLine(pick(COMMENTARY.leadChange), A.s.pigeonName, B.s.pigeonName);
      } else if (bLost) {
        text = fillLine(pick(COMMENTARY.overtakeLost), A.s.pigeonName, B.s.pigeonName, B.s.lost!.detourKm);
      } else if (B.curMult < 0.8) {
        text = fillLine(pick(COMMENTARY.overtakeTired), A.s.pigeonName, B.s.pigeonName);
      } else if (A.curMult > 1.15) {
        text = fillLine(pick(COMMENTARY.overtakeSurge), A.s.pigeonName, B.s.pigeonName);
      } else {
        text = fillLine(pick(COMMENTARY.overtake), A.s.pigeonName, B.s.pigeonName);
      }
      sc.lines.push({ atSeconds: t, text });
    }
    sc.prev = now;
    sc.nextT = t + sc.step;
  }

  return sc.lines;
}

/** Rank the field exactly like liveSnapshot at an arbitrary elapsed time. */
function rankAtTime(flight: Flight, dist: number, t: number): RankRow[] {
  return flight.sim
    .map((s) => {
      const { kmDone, finished, stopped, curMult } = raceProgress(s, dist, t);
      return { s, kmDone, curMult, finished, stopped: stopped || !!s.gaveUp };
    })
    .sort((a, b) => {
      if (a.stopped !== b.stopped) return a.stopped ? 1 : -1;
      const af = a.finished ? 0 : 1, bf = b.finished ? 0 : 1;
      if (af !== bf) return af - bf;
      if (a.finished && b.finished) return a.s.durationSeconds - b.s.durationSeconds;
      return b.kmDone - a.kmDone;
    });
}

/**
 * Live report for an estafettevlucht. Same idea as the normal feed, but the
 * duel is between TEAMS: it samples the team standings every interval and
 * reports which team passed which (naming the bird that is actually flying),
 * plus the moments that only a relay has — every handover at a swap point, a
 * team knocked out because one bird never made it, and a team completing the
 * full route. Deterministic (seeded on the flight id), grows monotonically.
 */
function relayCommentary(flight: Flight, nowMs: number): CommentLine[] {
  const startMs = Date.parse(flight.startAt);
  const elapsed = Math.max(0, (nowMs - startMs) / 1000);
  const total = flightTotalSeconds(flight);
  const legKm = relayLegKm(flight);
  // TWO independent streams, as in the individual report: the scan below stops at
  // `elapsed`, so the number of draws it makes grows during the race. Sharing one
  // stream with the event lines would re-roll THEIR wording on every poll — the
  // feed would visibly rewrite itself. Seeding them apart keeps every line fixed.
  const ovRng = seededRng(hashString(flight.id + ':relay:ov'));
  const evRng = seededRng(hashString(flight.id + ':relay:ev'));
  const pickLine = <T>(pool: readonly T[]): T => pickWith(ovRng, pool);
  const pickEvent = <T>(pool: readonly T[]): T => pickWith(evRng, pool);
  const fill = (tpl: string, a: string, b?: string, km?: string | number) =>
    tpl.replace('{name}', a).replace('{name2}', b ?? '').replace('{km}', String(km ?? ''));

  const teams = relayTeams(flight);
  const lines: CommentLine[] = [];
  lines.push({ atSeconds: 0, text: pickLine(COMMENTARY.start) });

  // Team standings at an arbitrary moment, ranked like the live board.
  const rankAt = (t: number) =>
    teams
      .map((team) => ({ team, ...relayTeamProgress(team, legKm, t) }))
      .sort((a, b) => {
        if (a.out !== b.out) return a.out ? 1 : -1;
        const af = a.finished ? 0 : 1, bf = b.finished ? 0 : 1;
        if (af !== bf) return af - bf;
        if (a.finished && b.finished) return a.team.totalSeconds - b.team.totalSeconds;
        return b.kmDone - a.kmDone;
      });

  const flying = (r: { finished: boolean; out: boolean }) => !r.finished && !r.out;
  const PAIR_COOLDOWN = 3;
  const pairMutedUntil = new Map<string, number>();
  const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  let prev = rankAt(1);
  let interval = 0;
  // Same bound as the individual report: a relay runs ~900 km, so a fixed
  // 10-minute step would sample the field 60+ times per poll. Stop at `elapsed`
  // too — sampling the future only to filter it away afterwards is free work.
  const step = commentaryStep(total);
  const scanTo = Math.min(total, elapsed);
  for (let t = step; t <= scanTo; t += step) {
    interval++;
    const now = rankAt(t);
    const prevIdx = new Map(prev.map((r, i) => [r.team.ownerId, i]));
    const nowIdx = new Map(now.map((r, i) => [r.team.ownerId, i]));
    const wasFlying = new Map(prev.map((r) => [r.team.ownerId, flying(r)]));

    type Pass = { a: typeof now[number]; b: typeof now[number]; climb: number };
    const passes: Pass[] = [];
    for (const a of now) {
      if (!flying(a) || !wasFlying.get(a.team.ownerId)) continue;
      const aNow = nowIdx.get(a.team.ownerId)!, aPrev = prevIdx.get(a.team.ownerId)!;
      if (aNow >= aPrev) continue;
      let scalp: typeof now[number] | null = null, scalpPrev = -1;
      for (const b of now) {
        if (b === a || !flying(b) || !wasFlying.get(b.team.ownerId)) continue;
        const bNow = nowIdx.get(b.team.ownerId)!, bPrev = prevIdx.get(b.team.ownerId)!;
        if (bPrev < aPrev && bNow > aNow && bPrev > scalpPrev) { scalp = b; scalpPrev = bPrev; }
      }
      if (scalp) passes.push({ a, b: scalp, climb: aPrev - aNow });
    }

    passes.sort((x, y) => y.climb - x.climb || x.a.team.ownerId.localeCompare(y.a.team.ownerId));
    const used = new Set<string>();
    let emitted = 0;
    for (const p of passes) {
      if (emitted >= 2) break;
      if (used.has(p.a.team.ownerId) || used.has(p.b.team.ownerId)) continue;
      const aName = p.a.active?.pigeonName ?? p.a.team.ownerName;
      const bName = p.b.active?.pigeonName ?? p.b.team.ownerName;
      const isLead = nowIdx.get(p.a.team.ownerId) === 0;
      const bLost = p.b.active?.lost && t >= (p.b.active.legStartSeconds ?? 0) + p.b.active.lost.atSeconds && p.b.curMult < 0.95;
      const key = pairKey(p.a.team.ownerId, p.b.team.ownerId);
      if (!isLead && !bLost && interval < (pairMutedUntil.get(key) ?? 0)) continue;
      used.add(p.a.team.ownerId); used.add(p.b.team.ownerId);
      pairMutedUntil.set(key, interval + PAIR_COOLDOWN);
      emitted++;
      let text: string;
      if (isLead) text = fill(pickLine(COMMENTARY.leadChange), aName, bName);
      else if (bLost) text = fill(pickLine(COMMENTARY.overtakeLost), aName, bName, p.b.active!.lost!.detourKm);
      else if (p.b.curMult < 0.8) text = fill(pickLine(COMMENTARY.overtakeTired), aName, bName);
      else if (p.a.curMult > 1.15) text = fill(pickLine(COMMENTARY.overtakeSurge), aName, bName);
      else text = fill(pickLine(COMMENTARY.overtake), aName, bName);
      lines.push({ atSeconds: t, text });
    }
    prev = now;
  }

  // The moments that make a relay: handovers, eliminations and team finishes.
  for (const team of teams) {
    const outAt = team.outAtLeg ?? Infinity;
    for (let i = 0; i < team.legs.length; i++) {
      const s = team.legs[i];
      const legNo = s.leg ?? i + 1;
      if (legNo > outAt) break;
      const legStart = s.legStartSeconds ?? 0;
      if (s.lost && legNo <= outAt) {
        lines.push({ atSeconds: legStart + s.lost.atSeconds, text: fill(pickEvent(COMMENTARY.stray), s.pigeonName, undefined, s.lost.detourKm) });
      }
      if (legNo === outAt) {
        const at = legStart + (s.gaveUp ? (s.gaveUpAtSeconds ?? 0) : s.dnfAtSeconds ?? 0);
        const cause = s.gaveUp
          ? fill(pickEvent(COMMENTARY.pulled), s.pigeonName)
          : fill(
              pickEvent(
                s.dnfKind === 'lost'
                  ? COMMENTARY.dnfLost
                  : s.dnfKind === 'injury'
                    ? COMMENTARY.dnfInjury
                    : COMMENTARY.dnfExhausted,
              ),
              s.pigeonName,
            );
        lines.push({ atSeconds: at, text: cause });
        lines.push({ atSeconds: at + 1, text: fill(pickEvent(COMMENTARY.relayOut), s.pigeonName, team.ownerName) });
        break;
      }
      // Completed its leg: either a handover or the team coming home.
      const at = legStart + s.durationSeconds;
      const next = team.legs[i + 1];
      if (next) {
        const point = flight.legs?.[legNo - 1]?.toName ?? `${legNo}`;
        lines.push({ atSeconds: at, text: fill(pickEvent(COMMENTARY.handover), s.pigeonName, next.pigeonName, point) });
      } else {
        lines.push({ atSeconds: at, text: fill(pickEvent(COMMENTARY.relayFinish), s.pigeonName, team.ownerName) });
      }
    }
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
  /** The flight these effects come from, so each bird can remember when it last
   *  raced (drives the RECOVERY deduction for racing on consecutive days). */
  raced?: { at: string; practice?: boolean },
): void {
  for (const f of sim.fatigue) {
    const p = pigeons.find((x) => x.id === f.pigeonId);
    if (!p) continue;
    p.restDays = 0; // raced → the rest-bonus streak restarts
    if (raced) {
      p.lastRaceAt = raced.at;
      p.lastRaceWasPractice = !!raced.practice;
    }
    p.form = round1(clamp(p.form + f.formDelta, 0, 100)); // energie
    // Conditie built by racing respects the per-bird racing ceiling (min(90,cap));
    // a grandfathered bird already above it keeps its value (no growth, no drop).
    const eCap = raceCeil(p, 'endurance');
    if (p.endurance < eCap) {
      const before = p.endurance;
      p.endurance = round1(clamp(p.endurance + f.enduranceDelta, 0, eCap));
      noteAttrChange(p, 'endurance', before, 'vlucht');
    }
    p.health = round1(clamp(p.health + f.healthDelta, 0, 100));
    p.experience = round1(clamp(p.experience + f.experienceDelta, 0, 100));
  }
  for (const imp of sim.improvements) {
    const p = pigeons.find((x) => x.id === imp.pigeonId);
    if (!p) continue;
    // Clamp to this bird's racing ceiling (min(90, geneCap)); never lower a
    // grandfathered bird already above it.
    const cap = raceCeil(p, imp.attr);
    if (p[imp.attr] < cap) {
      const before = p[imp.attr];
      p[imp.attr] = round1(Math.min(p[imp.attr] + imp.gain, cap));
      noteAttrChange(p, imp.attr, before, 'vlucht');
    }
  }
  for (const inj of sim.injuries) {
    const p = pigeons.find((x) => x.id === inj.pigeonId);
    if (!p || p.ailment) continue;
    applyAilment(p, inj.ailment);
  }
  // A newcomer banks double for its first season — prize money AND ranking
  // points. Keyed on the flight's START (not "now"), so a race begun inside the
  // window still pays double even if its stragglers only land after it closed.
  const racedAtMs = raced?.at ? Date.parse(raced.at) : NaN;
  for (const pay of sim.payouts) {
    const loft = lofts.find((l) => l.userId === pay.ownerId);
    if (!loft) continue;
    const mult = Number.isNaN(racedAtMs) ? 1 : winningsMultiplier(loft, racedAtMs);
    loft.money += Math.round(pay.prize * mult);
    loft.seasonPoints += Math.round(pay.points * mult);
    loft.totalWins += pay.wins;
    loft.seasonWins = (loft.seasonWins ?? 0) + pay.wins;
  }
}

/**
 * A short sports-reporter recap of a completed flight — read after the race by
 * everyone. Deterministic (seeded on the flight id) so it never changes.
 */
/** A sports-reporter recap of an estafettevlucht — written per team. */
function generateRelayRecap(flight: Flight, standings: RelayTeam[]): string {
  const legKm = relayLegKm(flight);
  const route = (flight.legs ?? []).map((l) => l.fromName).concat(flight.toCity).join(' → ');
  const parts: string[] = [
    `${flight.name}: ${standings.length} ploeg${standings.length === 1 ? '' : 'en'} van elk ${RELAY.teamSize} duiven ` +
    `over ${legKm * RELAY.teamSize} km, in etappes van ${legKm} km. Route: ${route}.`,
  ];
  const home = standings.filter((t) => t.finished);
  if (home.length === 0) {
    parts.push('Ongezien: geen enkele ploeg raakte compleet thuis. Overal sneuvelde er wel een schakel.');
    parts.push('Tot de volgende lossing, duivenvrienden!');
    return parts.join(' ');
  }
  const win = home[0];
  const hrs = Math.floor(win.totalSeconds / 3600);
  const mins = Math.round((win.totalSeconds % 3600) / 60);
  parts.push(
    `De ploeg van ${win.ownerName} wint in ${hrs} u ${mins} min, met ${win.legs.map((l) => l.pigeonName).join(', ')} ` +
    'die elkaar vlekkeloos aflosten.',
  );
  if (home.length >= 3) {
    parts.push(`${home[1].ownerName} pakt zilver, ${home[2].ownerName} brons — de wissels maakten daar het verschil.`);
  } else if (home.length === 2) {
    parts.push(`${home[1].ownerName} moest als enige andere ploeg vrede nemen met de tweede stek.`);
  }
  const out = standings.filter((t) => !t.finished);
  if (out.length > 0) {
    const names = out.map((t) => t.ownerName).join(', ');
    parts.push(`Uitgeschakeld onderweg: ${names}. Eén duif die het niet haalt, en de hele ploeg ligt eruit — zo hard is de estafette.`);
  }
  parts.push('Tot de volgende lossing, duivenvrienden!');
  return parts.join(' ');
}

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
