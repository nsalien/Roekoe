/** Economy: daily feeding + condition recovery, and the weekly upkeep charge. */

import {
  COACH,
  COMPARTMENT,
  FEED_RATIONS,
  FOOD_ENDURANCE_CAP,
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
export function applyDayOfCare(loft: Loft, pigeons: Pigeon[], livePigeonIds?: Set<string>): boolean {
  const active = pigeons;
  if (active.length === 0) return true;
  const rationOf = (p: Pigeon) => FEED_RATIONS[p.ration ?? loft.feedRation] ?? FEED_RATIONS.normal;
  const need = round1(active.reduce((sum, p) => sum + rationOf(p).foodPerPigeon, 0));

  let fed = true;
  if (loft.food >= need) {
    loft.food = round1(loft.food - need);
  } else {
    fed = false;
    loft.food = 0;
  }

  for (const p of active) {
    const ration = rationOf(p);
    // A private compartment lets this bird rest better and stay healthier.
    const formMult = 1 + (p.compartment ? COMPARTMENT.formRecoveryBonus : 0);
    const healthMult = 1 + (p.compartment ? COMPARTMENT.healthRecoveryBonus : 0);
    if (fed) {
      const energyGain = (ration.formRecovery / 7) * (1 + p.experience / 200) * formMult; // exp + compartment speed recovery
      p.form = round1(clamp(p.form + energyGain, 0, 100));
      p.health = round1(clamp(p.health + (ration.healthRecovery / 7) * healthMult + p.endurance / 280, 0, 100));
      // Premium feed slowly builds conditie (up to its own cap, never lowering
      // a bird already built higher by racing/coach); a libido-mix lifts drive.
      if (ration.enduranceRecovery) {
        const target = Math.min(p.endurance + ration.enduranceRecovery / 7, FOOD_ENDURANCE_CAP);
        if (target > p.endurance) p.endurance = round1(target);
      }
      if (ration.libidoRecovery) p.libido = round1(clamp(p.libido + ration.libidoRecovery / 7, 0, 100));
      // A hired coach drills every racing attribute (never libido) — but not
      // while the bird is actually away racing (a live flight).
      if (p.coached && !p.ailment && !p.inInfirmary && !livePigeonIds?.has(p.id)) {
        p.speed = round1(clamp(p.speed + COACH.dailyGain, 0, COACH.attributeCap));
        p.endurance = round1(clamp(p.endurance + COACH.dailyGain, 0, COACH.attributeCap));
        p.orientation = round1(clamp(p.orientation + COACH.dailyGain, 0, COACH.attributeCap));
        p.experience = round1(clamp(p.experience + COACH.experienceDailyGain, 0, 100));
      }
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
