/**
 * KENMERKEN (seizoen 3) — one trait per bird for life, from De Stem.
 *
 * About one bird in three carries a trait: a +5% speed bonus that only counts in
 * its own situation (see PIGEON_TRAITS), or a passive edge (less straying, less
 * energie, less illness). This module holds everything that is ABOUT traits and
 * owns no game state:
 *   - rolling and inheriting a trait (`rollTrait`, `inheritTrait`);
 *   - whether a static condition holds at the release (`staticTraitActive`);
 *   - the sun's altitude, for the day/night traits (`sunAltitudeDeg`);
 *   - applying a speed trait to a pace profile segment by segment
 *     (`applyTraitBonus`) and turning that into frozen time windows
 *     (`traitWindows`);
 *   - the expected factor the betting odds use before the weather is known.
 *
 * ⚠️ Nothing here draws from the profile's rng. A trait only rescales segments
 * that were already drawn, so a bird WITHOUT a trait gets exactly the profile it
 * got before seizoen 3, and a race stays reproducible (live == final).
 */

import {
  FLIGHT_DYNAMICS,
  PIGEON_TRAITS,
  TRAITS,
  traitById,
  type PigeonTraitId,
} from '../config/gameConfig.js';
import type { Pigeon } from '../schema.js';
import { interpolatePoint, type GeoPoint } from './relay.js';

// --- Rolling -----------------------------------------------------------------

/** A trait for a new bird: TRAITS.chance of any, then gewoon/zeldzaam, then one
 *  of that rarity uniformly. Null = no trait. */
export function rollTrait(rng: () => number = Math.random): PigeonTraitId | null {
  if (rng() >= TRAITS.chance) return null;
  const rare = rng() < TRAITS.rareShare;
  const pool = PIGEON_TRAITS.filter((t) => (t.rarity === 'zeldzaam') === rare);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))].id;
}

/**
 * A youngster's trait. Each parent WITH a trait passes it on with
 * TRAITS.inheritChance (sire first, then dam); both parents carrying the SAME
 * trait pass it on with TRAITS.inheritBothSame. Nothing passed on → the normal
 * roll, so a line without traits can still produce one.
 */
export function inheritTrait(
  sire: Pick<Pigeon, 'trait'> | null | undefined,
  dam: Pick<Pigeon, 'trait'> | null | undefined,
  rng: () => number = Math.random,
): PigeonTraitId | null {
  const s = traitById(sire?.trait)?.id;
  const d = traitById(dam?.trait)?.id;
  if (s && d && s === d) {
    if (rng() < TRAITS.inheritBothSame) return s;
  } else {
    if (s && rng() < TRAITS.inheritChance) return s;
    if (d && rng() < TRAITS.inheritChance) return d;
  }
  return rollTrait(rng);
}

// --- Static conditions ---------------------------------------------------------

/** The release weather in the detail the traits read. Undefined = unknown. */
export interface TraitWeather {
  along?: number; // km/h along the route, + = tailwind
  rain?: boolean;
  tempC?: number;
}

/**
 * Does a STATIC trait count for this whole race? Same thresholds as the weather
 * label (a "rugwind" in the label is a tailwind here). Unknown weather never
 * counts — a flight from before seizoen 3 has no `along`/`tempC` recorded.
 */
export function staticTraitActive(id: string, distanceKm: number, w: TraitWeather): boolean {
  const t = TRAITS.windThreshold;
  switch (id) {
    case 'tailwind': return typeof w.along === 'number' && w.along > t;
    case 'headwind': return typeof w.along === 'number' && w.along < -t;
    case 'rain': return w.rain === true;
    case 'fair': return w.rain === false && typeof w.along === 'number' && Math.abs(w.along) <= t;
    case 'cold': return typeof w.tempC === 'number' && w.tempC < TRAITS.coldBelowC;
    case 'warm': return typeof w.tempC === 'number' && w.tempC >= TRAITS.coldBelowC;
    case 'sprint': return distanceKm <= TRAITS.sprintMaxKm;
    case 'fond': return distanceKm >= TRAITS.fondMinKm;
    default: return false;
  }
}

// --- The sun ---------------------------------------------------------------------

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * The sun's altitude above the horizon (degrees) at a place and moment. The
 * standard low-precision solar position (the Astronomical Almanac's formula, good
 * to about a minute of sunrise/sunset in Europe): mean longitude and anomaly →
 * ecliptic longitude → declination and right ascension → hour angle via sidereal
 * time. No network, no tables, deterministic.
 */
export function sunAltitudeDeg(lat: number, lon: number, atMs: number): number {
  const n = atMs / 86400000 + 2440587.5 - 2451545.0; // days since J2000.0
  const L = mod(280.46 + 0.9856474 * n, 360);
  const g = rad(mod(357.528 + 0.9856003 * n, 360));
  const lambda = rad(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const eps = rad(23.439 - 0.0000004 * n);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstDeg = mod(280.46061837 + 360.98564736629 * n, 360);
  const ha = rad(gmstDeg + lon) - ra;
  const phi = rad(lat);
  return deg(Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha)));
}

/** Is it dark (the sun below the sunrise/sunset altitude) here, now? */
export function isDark(lat: number, lon: number, atMs: number): boolean {
  return sunAltitudeDeg(lat, lon, atMs) <= TRAITS.sunAltitudeDeg;
}

/** YYYY-MM-DD of a moment in Brussels time. */
const brusselsDate = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms));

const sunCache = new Map<string, { rise: string | null; set: string | null }>();

/**
 * Sunrise and sunset (ISO instants) at a place on the Brussels calendar day of
 * `atMs` — what the flight card shows so a player can judge who comes home in
 * the dark. Scans the day in 10-minute steps and bisects each crossing to the
 * second. Null = no crossing that day (never in Belgium). Cached per place+day.
 */
export function sunTimes(lat: number, lon: number, atMs: number): { rise: string | null; set: string | null } {
  const day = brusselsDate(atMs);
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${day}`;
  const hit = sunCache.get(key);
  if (hit) return hit;
  const [y, m, d] = day.split('-').map(Number);
  const h0 = TRAITS.sunAltitudeDeg;
  const alt = (ms: number) => sunAltitudeDeg(lat, lon, ms) - h0;
  const out: { rise: string | null; set: string | null } = { rise: null, set: null };
  const STEP = 10 * 60000;
  let t = Date.UTC(y, m - 1, d) - 3 * 3600000;
  const end = Date.UTC(y, m - 1, d) + 27 * 3600000;
  let a = alt(t);
  for (; t < end; t += STEP) {
    const b = alt(t + STEP);
    if ((a <= 0) !== (b <= 0)) {
      let lo = t, hi = t + STEP;
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2;
        if ((alt(mid) <= 0) === (a <= 0)) lo = mid; else hi = mid;
      }
      const at = Math.round(hi / 1000) * 1000;
      if (brusselsDate(at) === day) {
        if (a <= 0 && !out.rise) out.rise = new Date(at).toISOString();
        if (a > 0 && !out.set) out.set = new Date(at).toISOString();
      }
    }
    a = b;
  }
  if (sunCache.size > 500) sunCache.clear();
  sunCache.set(key, out);
  return out;
}

// --- Applying a speed trait to a pace profile ------------------------------------

/** Everything a profile needs to know to apply this bird's trait. */
export interface TraitRun {
  /** Wall clock (ms) when THIS bird is released — a relay leg adds its offset. */
  startMs: number;
  /** Her own route (a relay leg's end points); undefined = no coordinates known. */
  from?: GeoPoint;
  to?: GeoPoint;
  weather: TraitWeather;
  /** Social/loner only: the km ranges along HER route where the neighbour
   *  condition held, measured on the field's profiles WITHOUT this bonus (see
   *  groupConditionKm in flight.ts). Undefined on the first pass. */
  groupKm?: [number, number][];
}

/**
 * Apply this bird's SPEED trait to her pace profile, segment by segment, and
 * return per segment the share (0–1) of it where the bonus counted.
 *
 * Runs AFTER the pacing is normalised (so, unlike the pacing, it does change the
 * finish time — that is the point) and BEFORE the detours. Walks the segments in
 * order, so every segment's clock time is known from the ones before it, bonus
 * included: a forward pass, never a loop back.
 *   - static: all segments or none;
 *   - day/night: the sun at `sunSamplesPerSegment` points inside each segment, at
 *     the place she is then — a sunset halfway through a segment gives half of it;
 *   - social/loner: the overlap of each segment with `run.groupKm`.
 * Mutates `segMult`. Returns null for a bird without a speed trait.
 */
export function applyTraitBonus(
  traitId: string | null | undefined,
  run: TraitRun,
  distanceKm: number,
  velocity: number,
  segMult: number[],
): number[] | null {
  const def = traitById(traitId);
  if (!def || def.kind === 'passive') return null;
  const N = segMult.length;
  const frac = new Array<number>(N).fill(0);
  const boost = (i: number) => {
    if (frac[i] > 0) segMult[i] = Math.min(2, segMult[i] * (1 + (TRAITS.speedBonus - 1) * frac[i]));
  };

  if (def.kind === 'static') {
    if (!staticTraitActive(def.id, distanceKm, run.weather)) return frac;
    for (let i = 0; i < N; i++) { frac[i] = 1; boost(i); }
    return frac;
  }

  if (def.id === 'day' || def.id === 'night') {
    if (!run.from || !run.to) return frac; // no coordinates → no sun to go by
    const wantDark = def.id === 'night';
    const S = TRAITS.sunSamplesPerSegment;
    const segDistM = (distanceKm * 1000) / N;
    let tAcc = 0; // seconds since her release
    for (let i = 0; i < N; i++) {
      const segTime = (segDistM / Math.max(FLIGHT_DYNAMICS.minSegSpeed, velocity * segMult[i])) * 60;
      let hits = 0;
      for (let k = 0; k < S; k++) {
        const u = (k + 0.5) / S;
        const p = interpolatePoint(run.from, run.to, (i + u) / N);
        if (isDark(p.lat, p.lon, run.startMs + (tAcc + u * segTime) * 1000) === wantDark) hits++;
      }
      frac[i] = hits / S;
      boost(i);
      tAcc += (segDistM / Math.max(FLIGHT_DYNAMICS.minSegSpeed, velocity * segMult[i])) * 60;
    }
    return frac;
  }

  // social / loner: overlap with the ranges where the neighbour condition held.
  const ranges = run.groupKm ?? [];
  if (ranges.length === 0) return frac;
  const segKm = distanceKm / N;
  for (let i = 0; i < N; i++) {
    const a = i * segKm;
    const b = a + segKm;
    let covered = 0;
    for (const [x, y] of ranges) covered += Math.max(0, Math.min(b, y) - Math.max(a, x));
    frac[i] = Math.min(1, covered / segKm);
    boost(i);
  }
  return frac;
}

/**
 * Freeze WHEN a trait counted, from her FINAL profile (detours included): the
 * time range of every segment where it counted (merged when adjacent), in her own
 * leg-local seconds, and the share of her flight time it counted for.
 */
export function traitWindows(
  frac: number[] | null,
  distanceKm: number,
  velocity: number,
  segMult: number[],
  durationSeconds: number,
): { windows: [number, number][]; share: number } {
  if (!frac || !frac.some((f) => f > 0)) return { windows: [], share: 0 };
  const N = segMult.length;
  const segDistM = (distanceKm * 1000) / N;
  const windows: [number, number][] = [];
  let t = 0;
  let active = 0;
  let total = 0;
  for (let i = 0; i < N; i++) {
    const segTime = (segDistM / Math.max(FLIGHT_DYNAMICS.minSegSpeed, velocity * segMult[i])) * 60;
    total += segTime;
    if (frac[i] > 0) {
      active += frac[i] * segTime;
      const from = Math.round(t);
      const to = Math.round(Math.min(durationSeconds, t + segTime));
      const last = windows[windows.length - 1];
      if (last && last[1] >= from) last[1] = to;
      else windows.push([from, to]);
    }
    t += segTime;
  }
  return { windows, share: total > 0 ? Math.round((active / total) * 100) / 100 : 0 };
}

/** Is this bird's trait working right now (leg-local seconds)? For the live board. */
export function traitActiveAt(windows: [number, number][] | undefined, localSeconds: number): boolean {
  return !!windows?.some(([a, b]) => localSeconds >= a && localSeconds < b);
}

// --- Betting -------------------------------------------------------------------

/**
 * The speed factor the betting odds give a trait BEFORE the release, when the
 * weather and the field are not known yet. A distance trait is certain; the rest
 * counts at its expected share (`oddsShare`), so the bookmaker is not
 * systematically beatable by someone who reads the traits.
 */
export function expectedTraitFactor(pigeon: Pick<Pigeon, 'trait'>, distanceKm: number): number {
  const def = traitById(pigeon.trait);
  if (!def || def.kind === 'passive') return 1;
  if (def.id === 'sprint' || def.id === 'fond') {
    return staticTraitActive(def.id, distanceKm, {}) ? TRAITS.speedBonus : 1;
  }
  return 1 + (TRAITS.speedBonus - 1) * def.oddsShare;
}

/** The trait as the client shows it (public, like the breed and the quirk). */
export function traitDTO(id: string | null | undefined) {
  const t = traitById(id);
  return t
    ? { id: t.id, name: t.name, emoji: t.emoji, rarity: t.rarity, kind: t.kind, when: t.when, description: t.description }
    : null;
}
