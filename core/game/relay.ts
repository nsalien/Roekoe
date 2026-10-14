/**
 * Estafettevlucht (relay race) — route geometry and team helpers.
 *
 * A relay is one long route (see RELAY.minKm/maxKm) cut into `RELAY.teamSize`
 * EQUAL legs. Release point and home are real race cities; the handover points
 * in between are the exact one-third and two-third points of the great circle,
 * so every bird of a team flies precisely the same distance. Those points are
 * not cities, so they are described relative to the nearest known city
 * ("ten noorden van Limoges") — recognisable without bending the distances.
 *
 * The simulation itself lives in flight.ts (it needs the frozen pace profiles);
 * this module only builds routes and groups birds into teams.
 */

import { RACE_CITIES, RELAY, type RaceCity } from '../config/gameConfig.js';
import type { Flight, FlightEntry, RelayLeg, SimEntry } from '../schema.js';
import { haversineKm, pick } from './util.js';

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** The point a fraction `t` of the way along the great circle from `a` to `b`. */
export function interpolatePoint(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  const la1 = toRad(a.lat), lo1 = toRad(a.lon), la2 = toRad(b.lat), lo2 = toRad(b.lon);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2,
  ));
  if (d === 0) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
  const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
  const z = A * Math.sin(la1) + B * Math.sin(la2);
  return { lat: toDeg(Math.atan2(z, Math.hypot(x, y))), lon: toDeg(Math.atan2(y, x)) };
}

const COMPASS = [
  'ten noorden van', 'ten noordoosten van', 'ten oosten van', 'ten zuidoosten van',
  'ten zuiden van', 'ten zuidwesten van', 'ten westen van', 'ten noordwesten van',
];

/** Bearing from `a` to `b` in degrees (0 = north, clockwise). */
function bearing(a: GeoPoint, b: GeoPoint): number {
  const la1 = toRad(a.lat), la2 = toRad(b.lat), dLo = toRad(b.lon - a.lon);
  const y = Math.sin(dLo) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLo);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Describe a handover point by the nearest known city. Close by → "bij Brugge";
 * further out → "ten zuiden van Limoges", so a player can place it on a map.
 */
export function describePoint(p: GeoPoint): string {
  let best: RaceCity | null = null;
  let bestKm = Infinity;
  for (const c of RACE_CITIES) {
    const km = haversineKm(p, c);
    if (km < bestKm) { best = c; bestKm = km; }
  }
  if (!best) return 'onderweg';
  if (bestKm <= RELAY.nearCityKm) return `bij ${best.name}`;
  const dir = COMPASS[Math.round(bearing(best, p) / 45) % 8];
  return `${dir} ${best.name}`;
}

export interface RelayRoute {
  fromCity: string;
  toCity: string;
  legKm: number; // identical for every leg
  totalKm: number; // legKm * teamSize (what the flight advertises)
  legs: RelayLeg[];
}

/**
 * Build a relay route: a real release point and a real home city the right
 * distance apart, cut into equal legs at the exact thirds of the great circle.
 *
 * The birds race home to Vlaanderen, so the finish is always a Flemish city and
 * the release point is whatever sits RELAY.minKm..maxKm away — in practice the
 * classic deep-south grote-fond towns. Falls back to the closest-fitting pair if
 * no sampled pair lands in the window.
 */
export function pickRelayRoute(): RelayRoute {
  const homes = RACE_CITIES.filter((c) => c.flanders);
  let best: { a: RaceCity; b: RaceCity; d: number; penalty: number } | null = null;
  let chosen: { a: RaceCity; b: RaceCity; d: number } | null = null;
  for (let i = 0; i < 200; i++) {
    const a = pick(RACE_CITIES);
    const b = pick(homes);
    if (a.name === b.name) continue;
    const d = haversineKm(a, b);
    if (d >= RELAY.minKm && d <= RELAY.maxKm) { chosen = { a, b, d }; break; }
    const penalty = d < RELAY.minKm ? RELAY.minKm - d : d - RELAY.maxKm;
    if (!best || penalty < best.penalty) best = { a, b, d, penalty };
  }
  const route = chosen ?? (best ? { a: best.a, b: best.b, d: best.d } : null)
    ?? { a: RACE_CITIES[0], b: homes[0], d: haversineKm(RACE_CITIES[0], homes[0]) };

  // Equal legs by construction: one shared leg length, so no bird can be handed
  // a longer stretch than its team-mates.
  const n = RELAY.teamSize;
  const legKm = Math.max(1, Math.round(route.d / n));
  const points: GeoPoint[] = [route.a];
  for (let i = 1; i < n; i++) points.push(interpolatePoint(route.a, route.b, i / n));
  points.push(route.b);

  const legs: RelayLeg[] = [];
  for (let i = 0; i < n; i++) {
    const from = points[i], to = points[i + 1];
    legs.push({
      index: i + 1,
      fromName: i === 0 ? route.a.name : describePoint(from),
      toName: i === n - 1 ? route.b.name : describePoint(to),
      fromLat: from.lat, fromLon: from.lon,
      toLat: to.lat, toLon: to.lon,
      distanceKm: legKm,
      weather: '',
      weatherFactor: 1,
    });
  }
  return { fromCity: route.a.name, toCity: route.b.name, legKm, totalKm: legKm * n, legs };
}

/** The leg length of a relay flight (every leg is the same). */
export function relayLegKm(flight: Flight): number {
  return flight.legs?.[0]?.distanceKm ?? Math.round(flight.distanceKm / RELAY.teamSize);
}

/** Entered birds grouped per loft, ordered by leg. One team per owner. */
export function relayEntryTeams(flight: Flight): Map<string, FlightEntry[]> {
  const teams = new Map<string, FlightEntry[]>();
  for (const e of flight.entries) {
    const list = teams.get(e.ownerId) ?? [];
    list.push(e);
    teams.set(e.ownerId, list);
  }
  for (const list of teams.values()) list.sort((a, b) => (a.leg ?? 0) - (b.leg ?? 0));
  return teams;
}

/** Raced birds grouped per loft, ordered by leg. */
export function relaySimTeams(flight: Flight): Map<string, SimEntry[]> {
  const teams = new Map<string, SimEntry[]>();
  for (const s of flight.sim) {
    const list = teams.get(s.ownerId) ?? [];
    list.push(s);
    teams.set(s.ownerId, list);
  }
  for (const list of teams.values()) list.sort((a, b) => (a.leg ?? 0) - (b.leg ?? 0));
  return teams;
}

/** True when a loft has a full team entered (an incomplete team cannot start). */
export function relayTeamComplete(entries: FlightEntry[]): boolean {
  return entries.length === RELAY.teamSize;
}
