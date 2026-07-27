/** Weekly economy: feeding, condition recovery and upkeep costs. */

import {
  FEED_RATIONS,
  WEEKLY_UPKEEP_BASE,
  WEEKLY_UPKEEP_PER_PIGEON,
} from '../config/gameConfig.js';
import type { Loft, Pigeon } from '../db/schema.js';
import { clamp, round1 } from './util.js';

export interface WeeklyReport {
  userId: string;
  foodConsumed: number;
  foodShortfall: boolean;
  upkeep: number;
  moneyAfter: number;
}

/**
 * Process one week of care for a single loft and its pigeons (mutates them).
 * Well-fed, healthy pigeons recover form; underfeeding or an empty food store
 * hurts condition. Upkeep is charged regardless.
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
      p.form = round1(clamp(p.form + ration.formRecovery, 0, 100));
      p.health = round1(clamp(p.health + ration.healthRecovery, 0, 100));
    } else {
      p.form = round1(clamp(p.form - 8, 0, 100));
      p.health = round1(clamp(p.health - 6, 0, 100));
    }
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
