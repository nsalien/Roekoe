/** Economy: daily feeding + condition recovery, and the weekly upkeep charge. */

import {
  COACH,
  COMPARTMENT,
  FEED_RATIONS,
  FOOD_ENDURANCE_CAP,
  STARVATION,
  WEEKLY_UPKEEP_BASE,
  WEEKLY_UPKEEP_PER_PIGEON,
} from '../config/gameConfig.js';
import type { Loft, Pigeon } from '../schema.js';
import { clamp, hashString, round1 } from './util.js';

/** A bird that starved to death during a day of care. */
export interface StarvationDeath {
  id: string;
  name: string;
  ownerId: string;
  hungerDays: number;
}

/** Result of one day of care: could everyone be fed, and who starved to death. */
export interface DayOfCareResult {
  allFed: boolean;
  deaths: StarvationDeath[];
}

/**
 * Apply ONE day of care to a loft: eat food, then recover (or lose) energie and
 * health, and drift libido. Returns whether the loft could feed everyone and any
 * birds that starved to death.
 *
 * Fed: rest + food restore ENERGIE (`form`), faster for experienced birds. Good
 * CONDITIE (`endurance`) lifts health; libido drifts toward conditie + energie
 * (a stable ~12% "frisky" minority keeps a high drive anyway). Weekly ration
 * figures are applied at 1/7 per day.
 *
 * Unfed: the bird goes hungry. The decline ACCELERATES with each consecutive
 * hungry day (`hungerDays`) — energie, gezondheid, conditie and libido all drop
 * by `xPerDay · hungerDays` — and after a few days it can (then will) die.
 */
export function applyDayOfCare(loft: Loft, pigeons: Pigeon[], livePigeonIds?: Set<string>): DayOfCareResult {
  const active = pigeons;
  if (active.length === 0) return { allFed: true, deaths: [] };
  const stock = loft.food;
  const rationKeyOf = (p: Pigeon): keyof typeof FEED_RATIONS =>
    (p.ration && p.ration in FEED_RATIONS ? p.ration : (loft.feedRation in FEED_RATIONS ? loft.feedRation : 'normal'));

  let allFed = true;
  const deaths: StarvationDeath[] = [];
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

    if (fed) {
      p.hungerDays = 0; // a fed bird is no longer hungry
      // A private compartment lets this bird rest better and stay healthier.
      const formMult = 1 + (p.compartment ? COMPARTMENT.formRecoveryBonus : 0);
      const healthMult = 1 + (p.compartment ? COMPARTMENT.healthRecoveryBonus : 0);
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
      // Libido drifts toward conditie + energie; a frisky minority stays high.
      let target = p.endurance * 0.5 + p.form * 0.5;
      const h = hashString(p.id);
      if (h % 100 < 12) target = Math.max(target, 65 + ((h >> 7) % 25));
      p.libido = round1(clamp(p.libido + (target - p.libido) * 0.04, 0, 100));
    } else {
      // Hungry: decline accelerates with each consecutive unfed day.
      p.hungerDays = (p.hungerDays ?? 0) + 1;
      const d = p.hungerDays;
      p.form = round1(clamp(p.form - STARVATION.energiePerDay * d, 0, 100));
      p.health = round1(clamp(p.health - STARVATION.healthPerDay * d, 0, 100));
      p.endurance = round1(clamp(p.endurance - STARVATION.conditiePerDay * d, 0, 100));
      p.libido = round1(clamp(p.libido - STARVATION.libidoPerDay * d, 0, 100));
      // After a few days without food, death becomes likely, then certain.
      const deathChance =
        d >= STARVATION.certainDeathDays
          ? 1
          : d >= STARVATION.deathAfterDays
            ? clamp((d - STARVATION.deathAfterDays + 1) * STARVATION.deathChancePerDay, 0, STARVATION.deathMaxChance)
            : 0;
      if (deathChance > 0 && Math.random() < deathChance) {
        deaths.push({ id: p.id, name: p.name, ownerId: p.ownerId, hungerDays: d });
      }
    }
  }
  return { allFed, deaths };
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
  let libido = 0;
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
    let libidoFromFeed = 0;
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
    // Libido drifts toward conditie + energie (a frisky minority stays high);
    // the libido-mix feed adds on top.
    let target = p.endurance * 0.5 + p.form * 0.5;
    const h = hashString(p.id);
    if (h % 100 < 12) target = Math.max(target, 65 + ((h >> 7) % 25));
    libido = round1(clamp(p.libido + libidoFromFeed + (target - p.libido) * 0.04, 0, 100) - p.libido);
  } else {
    // No stock of the chosen ration → the bird goes hungry, and the loss
    // accelerates the longer it stays unfed (this is next day's hunger level).
    const d = (p.hungerDays ?? 0) + 1;
    form = rise(p.form, -STARVATION.energiePerDay * d, 100);
    health = rise(p.health, -STARVATION.healthPerDay * d, 100);
    endurance = rise(p.endurance, -STARVATION.conditiePerDay * d, 100);
    libido = rise(p.libido, -STARVATION.libidoPerDay * d, 100);
  }

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
