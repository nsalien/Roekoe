/** Weekly economy: feeding, condition recovery and upkeep costs. */

import {
  FEED_RATIONS,
  WEEKLY_UPKEEP_BASE,
  WEEKLY_UPKEEP_PER_PIGEON,
} from '../config/gameConfig.js';
import type { Loft, Pigeon } from '../schema.js';
import { clamp, hashString, round1 } from './util.js';

export interface WeeklyReport {
  userId: string;
  foodConsumed: number;
  foodShortfall: boolean;
  upkeep: number;
  moneyAfter: number;
}

/**
 * Process one week of care for a single loft and its pigeons (mutates them).
 *
 * Rest + food restore a bird's ENERGIE (`form`); experienced birds recover
 * faster. Good CONDITIE (`endurance`) lifts health, and libido drifts toward a
 * bird's conditie + energie. Underfeeding drains energie and health. Upkeep is
 * charged regardless.
 */
export function applyWeeklyCare(loft: Loft, pigeons: Pigeon[]): WeeklyReport {
  const active = pigeons.filter((p) => !p.retired);
  const ration = FEED_RATIONS[loft.feedRation];
  const needed = round1(active.length * ration.foodPerPigeon);

  let fed = true;
  if (loft.food >= needed) {
    loft.food = round1(loft.food - needed);
  } else {
    // Not enough food: feed what we can, condition suffers.
    fed = false;
    loft.food = 0;
  }

  for (const p of active) {
    if (fed) {
      // Energie recovers with rest + food, faster for experienced birds.
      const energyGain = ration.formRecovery * (1 + p.experience / 200); // up to +50%
      p.form = round1(clamp(p.form + energyGain, 0, 100));
      // Health recovers with food, boosted by good conditie.
      p.health = round1(clamp(p.health + ration.healthRecovery + p.endurance / 40, 0, 100));
    } else {
      p.form = round1(clamp(p.form - 8, 0, 100));
      p.health = round1(clamp(p.health - 6, 0, 100));
    }
    // Libido drifts toward a blend of conditie + energie. But ~12% of birds are
    // innately frisky (a stable per-bird trait) and keep a high drive even on
    // low energie, so a few low-energy duiven still have good libido.
    let libidoTarget = p.endurance * 0.5 + p.form * 0.5;
    const h = hashString(p.id);
    if (h % 100 < 12) libidoTarget = Math.max(libidoTarget, 65 + ((h >> 7) % 25)); // 65-89, stable
    p.libido = round1(clamp(p.libido + (libidoTarget - p.libido) * 0.25, 0, 100));
  }

  const upkeep = WEEKLY_UPKEEP_BASE + active.length * WEEKLY_UPKEEP_PER_PIGEON;
  loft.money -= upkeep;

  return {
    userId: loft.userId,
    foodConsumed: fed ? needed : loft.food,
    foodShortfall: !fed,
    upkeep,
    moneyAfter: loft.money,
  };
}
