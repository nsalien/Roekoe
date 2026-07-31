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
  const stock = loft.food;
  const rationKeyOf = (p: Pigeon): keyof typeof FEED_RATIONS =>
    (p.ration && p.ration in FEED_RATIONS ? p.ration : (loft.feedRation in FEED_RATIONS ? loft.feedRation : 'normal'));

  let allFed = true;
  for (const p of active) {
    const key = rationKeyOf(p);
    const ration = FEED_RATIONS[key];
    // Feeding is per pigeon, drawn from its own food type's stock (weekly rate,
    // 1/7 per day). No stock of that type → this bird goes unfed today.
    const dailyNeed = ration.foodPerPigeon / 7;
    let fed = true;
    if ((stock[key] ?? 0) >= dailyNeed) {
      stock[key] = round1(stock[key] - dailyNeed);
    } else {
      fed = false;
      allFed = false;
    }
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
  return allFed;
}

/**
 * The planned per-day change of each attribute for one pigeon, given its CURRENT
 * feeding/housing/coach selection. Used to show the player, per pigeon, what
 * their choices are set to do each day (so they can see e.g. that a private
 * compartment adds energie, or that switching to the libido-mix lifts libido).
 * The numbers mirror `applyDayOfCare` above — keep the two in sync.
 */
export interface DailyCareProjection {
  ration: keyof typeof FEED_RATIONS;
  fed: boolean; // is there stock of the selected ration for one more day?
  compartment: boolean; // housed apart (better rest)?
  coachActive: boolean; // is a coach drilling this bird right now?
  /** Effective daily change per attribute (already clamped to its cap). */
  deltas: {
    form: number; // energie
    health: number; // gezondheid
    endurance: number; // conditie
    libido: number;
    speed: number; // snelheid (coach)
    orientation: number; // oriëntatie (coach)
    experience: number; // ervaring (coach)
  };
}

/**
 * Project one day of care WITHOUT mutating the pigeon: what each attribute is
 * planned to gain (or lose) tomorrow with the current ration, compartment and
 * coach. `live` = the bird is away on a live flight (its coach can't drill it).
 */
export function projectDailyCare(loft: Loft, p: Pigeon, live = false): DailyCareProjection {
  const key: keyof typeof FEED_RATIONS =
    p.ration && p.ration in FEED_RATIONS ? p.ration : (loft.feedRation in FEED_RATIONS ? loft.feedRation : 'normal');
  const ration = FEED_RATIONS[key];
  const dailyNeed = ration.foodPerPigeon / 7;
  const fed = (loft.food[key] ?? 0) >= dailyNeed;
  const coachActive = !!p.coached && !p.ailment && !p.inInfirmary && !live && fed;

  // How much an attribute really moves, clamped to its cap (so a bird near the
  // ceiling shows the small remaining rise, not the raw amount).
  const rise = (current: number, rawGain: number, cap: number) => round1(clamp(current + rawGain, 0, cap) - current);

  let form = 0;
  let health = 0;
  let endurance = 0;
  let libidoFromFeed = 0;
  let speed = 0;
  let orientation = 0;
  let experience = 0;

  if (fed) {
    const formMult = 1 + (p.compartment ? COMPARTMENT.formRecoveryBonus : 0);
    const healthMult = 1 + (p.compartment ? COMPARTMENT.healthRecoveryBonus : 0);
    form = rise(p.form, (ration.formRecovery / 7) * (1 + p.experience / 200) * formMult, 100);
    health = rise(p.health, (ration.healthRecovery / 7) * healthMult + p.endurance / 280, 100);
    // Conditie from premium feed (capped at FOOD_ENDURANCE_CAP, never lowering).
    let endAfterFood = p.endurance;
    let enduranceRaw = 0;
    if (ration.enduranceRecovery) {
      const target = Math.min(p.endurance + ration.enduranceRecovery / 7, FOOD_ENDURANCE_CAP);
      if (target > p.endurance) { enduranceRaw += target - p.endurance; endAfterFood = target; }
    }
    if (ration.libidoRecovery) libidoFromFeed = ration.libidoRecovery / 7;
    if (coachActive) {
      speed = rise(p.speed, COACH.dailyGain, COACH.attributeCap);
      orientation = rise(p.orientation, COACH.dailyGain, COACH.attributeCap);
      enduranceRaw += clamp(COACH.attributeCap - endAfterFood, 0, COACH.dailyGain);
      experience = rise(p.experience, COACH.experienceDailyGain, 100);
    }
    endurance = round1(enduranceRaw);
  } else {
    // No stock of the chosen ration → the bird goes unfed and loses ground.
    form = rise(p.form, -8 / 7, 100);
    health = rise(p.health, -6 / 7, 100);
  }

  // Libido always drifts toward conditie + energie (a frisky minority stays
  // high); the libido-mix feed adds on top. Report the real net change.
  let target = p.endurance * 0.5 + p.form * 0.5;
  const h = hashString(p.id);
  if (h % 100 < 12) target = Math.max(target, 65 + ((h >> 7) % 25));
  const libido = round1(clamp(p.libido + libidoFromFeed + (target - p.libido) * 0.04, 0, 100) - p.libido);

  return {
    ration: key,
    fed,
    compartment: !!p.compartment,
    coachActive,
    deltas: { form, health, endurance, libido, speed, orientation, experience },
  };
}

/** Charge a loft its weekly maintenance overhead (money). */
export function chargeWeeklyUpkeep(loft: Loft, activeCount: number): number {
  const upkeep = WEEKLY_UPKEEP_BASE + activeCount * WEEKLY_UPKEEP_PER_PIGEON;
  loft.money -= upkeep;
  return upkeep;
}
