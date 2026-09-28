/**
 * Who may be entered where — the client-side mirror of `enterFlight` on the
 * server, shared by the Vluchten page and Mijn hok so the two pickers can never
 * disagree. The server still decides; this only keeps the pickers honest
 * instead of offering a bird that is guaranteed to bounce.
 */

import type { Flight, Pigeon } from '../types';

/** The calendar day a flight belongs to — the very key the one-race-per-day rule
 *  uses server-side (`flightDay` in core/game/flight.ts). */
export const flightDay = (f: Pick<Flight, 'startAt'>) => f.startAt.slice(0, 10);

/**
 * One race per bird per day (the hard rule, see enterFlight). A bird's day is
 * spent the moment it is on ANY flight of that day — scheduled, live, or long
 * since flown. Flights that were called off don't count: nobody flew those.
 */
export function buildDaysTaken(flights: Flight[], userId: string | undefined): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>(); // pigeonId → days (YYYY-MM-DD)
  for (const f of flights) {
    if (f.cancelled) continue;
    const day = flightDay(f);
    for (const e of f.entries) {
      if (e.ownerId !== userId) continue;
      let days = map.get(e.pigeonId);
      if (!days) map.set(e.pigeonId, (days = new Set<string>()));
      days.add(day);
    }
  }
  return map;
}

/** Can this bird be entered on this (scheduled) flight right now? */
export function canEnter(
  p: Pigeon,
  f: Flight,
  daysTaken: Map<string, Set<string>>,
  userId: string | undefined,
): boolean {
  if (f.status !== 'scheduled') return false;
  if (!p.canRace || p.racing || p.breeding || (p.form ?? 0) < 1) return false;
  if (daysTaken.get(p.id)?.has(flightDay(f))) return false;
  // A leeftijdscriterium takes one age bracket only.
  if (f.ageCat && p.ageCat !== f.ageCat) return false;
  const mine = f.entries.filter((e) => e.ownerId === userId);
  if (f.titan && mine.length >= 1) return false; // one bird per loft
  if (f.relay && mine.length >= (f.teamSize ?? 3)) return false; // team complete
  return true;
}

/** What entering THIS bird costs (a relay team pays once, with its first bird). */
export function entryCost(f: Flight, userId: string | undefined): number {
  if (f.practice) return 0;
  if (f.relay && f.entries.some((e) => e.ownerId === userId)) return 0;
  return f.entryFee;
}
