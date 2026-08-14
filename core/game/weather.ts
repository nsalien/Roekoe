/**
 * Real weather for a flight.
 *
 * Fetches current wind + precipitation at the release point (Open-Meteo, free,
 * no key) and turns the along-route wind into a speed factor: a tailwind speeds
 * the birds up, a headwind and rain slow them down. Falls back to a random sky
 * if the network is unavailable (e.g. offline dev).
 */

import { CITY_COORDS } from '../config/gameConfig.js';
import { clamp, pick, round1 } from './util.js';

export interface WeatherResult {
  label: string;
  factor: number;
}

const FALLBACK: WeatherResult[] = [
  { label: 'Zonnig, rugwind', factor: 1.12 },
  { label: 'Helder en kalm', factor: 1.05 },
  { label: 'Licht bewolkt', factor: 1.0 },
  { label: 'Bewolkt, zijwind', factor: 0.95 },
  { label: 'Tegenwind', factor: 0.85 },
  { label: 'Regen en mist', factor: 0.72 },
];

export function randomWeather(): WeatherResult {
  return pick(FALLBACK);
}

const toRad = (d: number) => (d * Math.PI) / 180;

/** Initial great-circle bearing from A to B, in degrees. */
function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function signedAngle(a: number, b: number): number {
  let d = (a - b + 540) % 360 - 180;
  return d;
}

async function fetchJson(url: string, timeoutMs = 4000): Promise<any> {
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs));
  const res = (await Promise.race([fetch(url), timeout])) as Response;
  if (!res.ok) throw new Error(`weather ${res.status}`);
  return res.json();
}

/** Turn wind + rain along a route into Roekoe's speed factor and a label. */
function toWeather(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  windSpeed: number,
  windFrom: number,
  precip: number,
  forecast: boolean,
): WeatherResult {
  const travel = bearing(from, to);
  const windTo = (windFrom + 180) % 360;
  const along = windSpeed * Math.cos(toRad(signedAngle(windTo, travel))); // + = tailwind km/h
  const factor = clamp(1 + along / 120 - Math.min(precip, 4) * 0.04, 0.7, 1.2);

  let windWord: string;
  if (along > 6) windWord = `rugwind ${Math.round(windSpeed)} km/u`;
  else if (along < -6) windWord = `tegenwind ${Math.round(windSpeed)} km/u`;
  else windWord = windSpeed > 12 ? `zijwind ${Math.round(windSpeed)} km/u` : 'kalm weer';
  const rainWord = precip > 0.2 ? ', regen' : '';
  const suffix = forecast ? ' (voorspelling)' : ' (echt weer)';
  const label = `${windWord.charAt(0).toUpperCase()}${windWord.slice(1)}${rainWord}${suffix}`;
  return { label, factor: round1(factor) };
}

/**
 * The forecast for one leg of a route at a given moment — used by the
 * estafettevlucht, which shows the weather per leg days before the start so a
 * player can decide which bird flies which stretch. Handover points are plain
 * coordinates, not cities, so this takes lat/lon directly.
 */
export async function fetchLegForecast(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  atMs: number,
): Promise<WeatherResult> {
  try {
    const hour = new Date(Math.round(atMs / 3600000) * 3600000).toISOString().slice(0, 13) + ':00';
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${from.lat.toFixed(3)}&longitude=${from.lon.toFixed(3)}` +
      '&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kmh&forecast_days=7&timezone=UTC';
    const j = await fetchJson(url);
    const times: string[] = j.hourly?.time ?? [];
    let i = times.indexOf(hour);
    if (i < 0) {
      // Fall back to the closest hour the API returned.
      let bestDiff = Infinity;
      times.forEach((t, k) => {
        const diff = Math.abs(Date.parse(t + 'Z') - atMs);
        if (diff < bestDiff) { bestDiff = diff; i = k; }
      });
    }
    if (i < 0) return randomWeather();
    return toWeather(
      from, to,
      Number(j.hourly.wind_speed_10m?.[i]) || 0,
      Number(j.hourly.wind_direction_10m?.[i]) || 0,
      Number(j.hourly.precipitation?.[i]) || 0,
      true,
    );
  } catch {
    return randomWeather();
  }
}

/** Current weather for a route, mapped to a Roekoe speed factor + label. */
export async function fetchFlightWeather(fromCity: string, toCity: string): Promise<WeatherResult> {
  const from = CITY_COORDS[fromCity];
  const to = CITY_COORDS[toCity];
  if (!from || !to) return randomWeather();
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${from.lat}&longitude=${from.lon}` +
      `&current=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kmh`;
    const j = await fetchJson(url);
    const cur = j.current ?? {};
    const windSpeed: number = Number(cur.wind_speed_10m) || 0; // km/h
    const windFrom: number = Number(cur.wind_direction_10m) || 0; // deg (from)
    const precip: number = Number(cur.precipitation) || 0; // mm

    const travel = bearing(from, to);
    const windTo = (windFrom + 180) % 360;
    const along = windSpeed * Math.cos(toRad(signedAngle(windTo, travel))); // + = tailwind km/h

    const factor = clamp(1 + along / 120 - Math.min(precip, 4) * 0.04, 0.7, 1.2);

    let windWord: string;
    if (along > 6) windWord = `rugwind ${Math.round(windSpeed)} km/u`;
    else if (along < -6) windWord = `tegenwind ${Math.round(windSpeed)} km/u`;
    else windWord = windSpeed > 12 ? `zijwind ${Math.round(windSpeed)} km/u` : 'kalm weer';
    const rainWord = precip > 0.2 ? ', regen' : '';
    const label = `${windWord.charAt(0).toUpperCase()}${windWord.slice(1)}${rainWord} (echt weer)`;

    return { label, factor: round1(factor) };
  } catch {
    return randomWeather();
  }
}
