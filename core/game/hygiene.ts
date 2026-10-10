/**
 * Hokhygiëne, vers stro en de hokpoetser (hokinrichting — ⚠️ dev, nog niet live).
 *
 * The loft carries a hygiene meter (Loft.equipment.hygiene, 0–100). Fresh straw
 * puts it at 100; it drops once a day on the dagovergang (tickDailyCare), faster
 * in a full loft and faster still with a sick bird among the others. Above the
 * neutral 50 it lowers the chance to fall ill (runHealthDay); at or below 50 it
 * does nothing — so a loft that never buys straw plays exactly as before.
 *
 * A hokpoetser costs a daily wage (in the Dagbalans via dailyRunningCostBreakdown),
 * strews fresh straw whenever the meter falls under 70 (paying the normal bale
 * price) and disinfects: contagion between birds ×0,85.
 */

import { EQUIPMENT, EQUIPMENT_LEVELS, HYGIENE, hygieneIllnessMult, strawCost, type LevelKey } from '../config/gameConfig.js';
import type { Loft, LoftEquipment, Pigeon } from '../schema.js';
import { defaultEquipment } from '../schema.js';
import type { Store } from '../store.js';
import { debtBlock } from './economy.js';
import { isAway } from './pigeon.js';
import { round1 } from './util.js';

/** The loft's equipment, with defaults for a loft that never touched it. Read-only use. */
export function equipmentOf(loft: Loft): LoftEquipment {
  return { ...defaultEquipment(), ...(loft.equipment ?? {}) };
}

/** An item's level: 0 = not bought, 1 = the first purchase, up to EQUIPMENT_LEVELS.maxLevel. */
export function equipmentLevel(loft: Loft, key: LevelKey): number {
  const eq = loft.equipment;
  if (!eq) return 0;
  const owned = key === 'irBoxes' ? (eq.irBoxes ?? 0) > 0 : !!eq[key];
  if (!owned) return 0;
  return Math.min(Math.max(1, Math.round(eq.levels?.[key] ?? 1)), EQUIPMENT_LEVELS.maxLevel);
}

/** How hard an item works at its level, as a multiple of level 1 (0 = not bought). */
export function effectScale(loft: Loft, key: LevelKey): number {
  const level = equipmentLevel(loft, key);
  return level === 0 ? 0 : EQUIPMENT_LEVELS.effectScale[level - 1];
}

/**
 * How many hygiene points this loft loses in one day: `dailyDecay` in a full
 * loft, scaled by how full it is, and `sickDecayMult` faster while a sick bird
 * (ziekte, not a kwetsuur) lives among the others instead of in the infirmary.
 */
export function hygieneDecay(loft: Loft, birds: Pigeon[]): number {
  const home = birds.filter((p) => !isAway(p));
  const occupancy = loft.capacity > 0 ? Math.min(1, home.length / loft.capacity) : 0;
  const sickAmongOthers = home.some((p) => p.ailment?.kind === 'ziekte' && !p.inInfirmary);
  const ventilated = 1 - (1 - EQUIPMENT.ventilation.hygieneDecayMult) * effectScale(loft, 'ventilation'); // drier straw
  return HYGIENE.dailyDecay * occupancy * (sickAmongOthers ? HYGIENE.sickDecayMult : 1) * ventilated;
}

/**
 * One dagovergang for the loft's hygiene. Returns the straw bill the hokpoetser
 * ran up today (0 if none). A loft that never touched its hokinrichting is left
 * alone entirely: its meter sits at the neutral 50, where dropping changes
 * nothing, and skipping it means its row is not rewritten (bots included).
 */
export function tickHygiene(loft: Loft, birds: Pigeon[], dayMs: number): number {
  if (!loft.equipment) return 0;
  const eq = loft.equipment;
  eq.hygiene = round1(Math.max(0, (eq.hygiene ?? HYGIENE.neutral) - hygieneDecay(loft, birds)));
  if (eq.cleaner && eq.hygiene < HYGIENE.cleanerRefreshBelow) {
    const cost = strawCost(loft.capacity);
    loft.money -= cost;
    eq.hygiene = 100;
    eq.lastStrawAt = new Date(dayMs).toISOString();
    return cost;
  }
  return 0;
}

/**
 * Everything that lowers a bird's chance to fall ill, together: hygiene, a
 * private compartment and the IJzeren gestel kenmerk multiply, and the
 * hokpoetser trims the contagion. Combined they never take the chance below
 * HYGIENE.illnessFactorFloor of what it would be without any of them.
 */
export function illnessChance(opts: {
  spontaneous: number; // daily chance to fall ill on its own
  fromOthers: number; // daily chance to catch it from the sick birds around it
  hygiene: number;
  cleaner: boolean;
  compartmentMult: number;
  traitMult: number;
}): number {
  const cap = 0.85;
  const combine = (others: number) => Math.min(cap, Math.max(0, 1 - (1 - others) * (1 - opts.spontaneous)));
  const base = combine(opts.fromOthers);
  const reduced =
    combine(opts.fromOthers * (opts.cleaner ? HYGIENE.cleanerContagionMult : 1)) *
    hygieneIllnessMult(opts.hygiene) *
    opts.compartmentMult *
    opts.traitMult;
  return Math.max(reduced, base * HYGIENE.illnessFactorFloor);
}

/** Strew fresh straw now: the meter goes to 100. Returns an error or null. */
export function buyStraw(store: Store, userId: string, nowMs: number = Date.now()): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Geen hok gevonden';
    const debt = debtBlock(loft); if (debt) return debt;
    const cost = strawCost(loft.capacity);
    if (loft.money < cost) return 'Niet genoeg geld voor vers stro';
    loft.money -= cost;
    loft.equipment = { ...equipmentOf(loft), hygiene: 100, lastStrawAt: new Date(nowMs).toISOString() };
    return null;
  });
}

/** Hire or let go of the hokpoetser (both free; he costs a daily wage). */
export function setCleaner(store: Store, userId: string, on: boolean): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Geen hok gevonden';
    if (on) {
      const debt = debtBlock(loft); if (debt) return debt;
    }
    loft.equipment = { ...equipmentOf(loft), cleaner: on };
    return null;
  });
}
