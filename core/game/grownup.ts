/**
 * VOLWASSEN — een duif wordt in je hok 8 weken en mag vliegen (⚠️ enkel op dev).
 *
 * Eigenaar, 4 nov: "Wanneer een duif volwassen wordt, dus 8 weken wordt, terwijl die
 * in het hok van de speler zit, zorg voor een leuke animatie die de speler te zien
 * krijgt per duif die volwassen wordt en die daardoor klaar is om te beginnen
 * vliegen. Nu gebeurt dit gewoon stil."
 *
 * The engine notes the moment on the bird — `care.grownUpAt`, owner-private like the
 * tags and gone when she changes hands (clearOwnerCare), so a bird bought already
 * grown never throws a party for her new owner. The client throws it once per bird
 * (GrownUpCelebration.tsx, remembered in localStorage).
 *
 * It runs where the birds age: on every game week rolled at the day boundary
 * (tickDailyCare). That is the only place `currentWeek` moves, so a bird reaches
 * RACE_AGE_WEEKS exactly there — one write per bird, once, never on a poll.
 */
import type { Database } from '../schema.js';
import { RACE_AGE_WEEKS } from '../config/gameConfig.js';
import { ageInWeeks } from './pigeon.js';

/**
 * Mark every bird of a real player that turns RACE_AGE_WEEKS in `week`. `atMs` is the
 * midnight being processed, so two concurrent requests closing the same day write the
 * same value. Returns how many were marked.
 */
export function markGrownUp(db: Database, week: number, atMs: number): number {
  const humans = new Set(db.lofts.filter((l) => !l.isBot).map((l) => l.userId));
  const at = new Date(atMs).toISOString();
  let marked = 0;
  for (const p of db.pigeons) {
    if (!humans.has(p.ownerId) || ageInWeeks(p, week) !== RACE_AGE_WEEKS) continue;
    if (p.care?.grownUpAt) continue;
    p.care = { ...(p.care ?? {}), grownUpAt: at };
    marked++;
  }
  return marked;
}
