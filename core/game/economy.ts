/** Economy: daily feeding + condition recovery, and the weekly upkeep charge. */

import {
  FEED_RATIONS,
  WEEKLY_UPKEEP_BASE,
  WEEKLY_UPKEEP_PER_PIGEON,
} from '../config/gameConfig.js';
import type { Loft, Pigeon } from '../schema.js';
import { clamp, hashString, round1 } from './util.js';

/**
 * Apply ONE day of care to a loft: eat food, then recover (or lose) energie and
 * health, and drift libido. Returns whether the loft could feed everyone.
 *
 * Rest + food restore ENERGIE (`form`), faster for experienced birds. Good
 * CONDITIE (`endurance`) lifts health. Libido drifts toward a bird's conditie +
 * energie, though a stable ~12% "frisky" minority keeps a high drive anyway.
 * Weekly ration figures are applied at 1/7 per day.
 */
export function applyDayOfCare(loft: Loft, pigeons: Pigeon[]): boolean {
  const active = pigeons.filter((p) => !p.retired);
  if (active.length === 0) return true;
  const ration = FEED_RATIONS[loft.feedRation];
  const need = round1(active.length * ration.foodPerPigeon);

  let fed = true;
  if (loft.food >= need) {
    loft.food = round1(loft.food - need);
  } else {
    fed = false;
    loft.food = 0;
  }

  for (const p of active) {
    if (fed) {
      const energyGain = (ration.formRecovery / 7) * (1 + p.experience / 200); // exp speeds recovery
      p.form = round1(clamp(p.form + energyGain, 0, 100));
      p.health = round1(clamp(p.health + ration.healthRecovery / 7 + p.endurance / 280, 0, 100));
    } else {
      p.form = round1(clamp(p.form - 8 / 7, 0, 100));
      p.health = round1(clamp(p.health - 6 / 7, 0, 100));
    }
    // Libido drifts toward conditie + energie; a frisky minority stays high.
    let target = p.endurance * 0.5 + p.form * 0.5;
    const h = hashString(p.id);
    if (h % 100 < 12) target = Math.max(target, 65 + ((h >> 7) % 25));
    p.libido = round1(clamp(p.libido + (target - p.libido) * 0.04, 0, 100));
  }
  return fed;
}

/** Charge a loft its weekly maintenance overhead (money). */
export function chargeWeeklyUpkeep(loft: Loft, activeCount: number): number {
  const upkeep = WEEKLY_UPKEEP_BASE + activeCount * WEEKLY_UPKEEP_PER_PIGEON;
  loft.money -= upkeep;
  return upkeep;
}
