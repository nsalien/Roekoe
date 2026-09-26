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
  /** Seizoen 3 (kenmerken): wind along the route in km/h (+ = tailwind), whether
   *  it rains at the release, and the temperature there (°C). Optional so an
   *  older caller still type-checks; every source below fills them in. */
  along?: number;
  rain?: boolean;
  tempC?: number;
}

const FALLBACK: Omit<WeatherResult, 'tempC'>[] = [
  { label: 'Zonnig, rugwind', factor: 1.12, along: 14, rain: false },
  { label: 'Helder en kalm', factor: 1.05, along: 0, rain: false },
  { label: 'Licht bewolkt', factor: 1.0, along: 2, rain: false },
  { label: 'Bewolkt, zijwind', factor: 0.95, along: -4, rain: false },
  { label: 'Tegenwind', factor: 0.85, along: -16, rain: false },
  { label: 'Regen en mist', factor: 0.72, along: -3, rain: true },
];

/** Average temperature per month in Belgium (°C) — only for the fallback sky. */
const BELGIAN_MONTH_TEMP = [3, 4, 7, 10, 14, 17, 19, 18, 15, 11, 7, 4];

/** A plausible temperature for a moment without network: the Belgian monthly
 *  average ± 3 °C. */
export function fallbackTemperature(atMs: number = Date.now()): number {
  const month = new Date(atMs).getUTCMonth();
  return round1(BELGIAN_MONTH_TEMP[month] + (Math.random() * 6 - 3));
}

export function randomWeather(atMs: number = Date.now()): WeatherResult {
  const w = pick(FALLBACK);
  const tempC = fallbackTemperature(atMs);
  return { ...w, tempC, label: `${w.label}, ${Math.round(tempC)} °C` };
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
  tempC?: number,
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
  const tempWord = typeof tempC === 'number' && Number.isFinite(tempC) ? `, ${Math.round(tempC)} °C` : '';
  const suffix = forecast ? ' (voorspelling)' : ' (echt weer)';
  const label = `${windWord.charAt(0).toUpperCase()}${windWord.slice(1)}${rainWord}${tempWord}${suffix}`;
  return {
    label, factor: round1(factor), along: round1(along), rain: precip > 0.2,
    tempC: typeof tempC === 'number' && Number.isFinite(tempC) ? round1(tempC) : fallbackTemperature(),
  };
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
      '&hourly=wind_speed_10m,wind_direction_10m,precipitation,temperature_2m&wind_speed_unit=kmh&forecast_days=7&timezone=UTC';
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
    if (i < 0) return randomWeather(atMs);
    const t = Number(j.hourly.temperature_2m?.[i]);
    return toWeather(
      from, to,
      Number(j.hourly.wind_speed_10m?.[i]) || 0,
      Number(j.hourly.wind_direction_10m?.[i]) || 0,
      Number(j.hourly.precipitation?.[i]) || 0,
      true,
      Number.isFinite(t) ? t : undefined,
    );
  } catch {
    return randomWeather(atMs);
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
      `&current=wind_speed_10m,wind_direction_10m,precipitation,temperature_2m&wind_speed_unit=kmh`;
    const j = await fetchJson(url);
    const cur = j.current ?? {};
    const t = Number(cur.temperature_2m);
    return toWeather(
      from, to,
      Number(cur.wind_speed_10m) || 0, // km/h
      Number(cur.wind_direction_10m) || 0, // deg (from)
      Number(cur.precipitation) || 0, // mm
      false,
      Number.isFinite(t) ? t : undefined,
    );
  } catch {
    return randomWeather();
  }
}

