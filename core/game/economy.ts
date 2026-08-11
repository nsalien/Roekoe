/** Economy: daily feeding + condition recovery. (Recurring costs are charged
 *  daily in schedule.tickDailyCare.) */

import {
  COACH,
  COMPARTMENT,
  DAILY_UPKEEP_BASE,
  DAILY_UPKEEP_PER_PIGEON,
  FEED_RATIONS,
  GENE,
  INFIRMARY,
  REST_BONUS,
  STARVATION,
  type RacingAttr,
} from '../config/gameConfig.js';
import type { Loft, Pigeon } from '../schema.js';
import { geneCap, noteAttrChange } from './pigeon.js';
import { clamp, hashString, round1 } from './util.js';

const RACING_ATTRS: RacingAttr[] = ['speed', 'endurance', 'orientation'];

/**
 * A private coach's daily gain for ONE racing attribute. The coach works at ANY
 * level, drilling the skill toward the bird's own gene `cap` with DIMINISHING
 * returns — the gain shrinks as the skill nears its cap and is 0 once it reaches
 * it (the cap is the max; the coach never pushes above it). It is also the only
 * thing that can raise a skill above 90 (training stops at 80, racing at 90).
 */
export function coachDailyGain(attr: number, cap: number): number {
  if (attr >= cap) return 0;
  const room = (cap - attr) / cap; // diminishes toward the cap, 0 at the cap
  return COACH.maxDailyGain * room; // callers round when storing (1 decimal)
}

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
export function applyDayOfCare(
  loft: Loft,
  pigeons: Pigeon[],
  livePigeonIds?: Set<string>,
  coveredInfirmaryIds?: Set<string>,
): DayOfCareResult {
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
      // A private compartment lets this bird rest better and stay healthier — but
      // not while it's isolated in the infirmary (it still holds the slot flag so
      // it can reclaim it on the way out, yet gets no compartment rest bonus there).
      const inCompartment = !!p.compartment && !p.inInfirmary;
      const formMult = 1 + (inCompartment ? COMPARTMENT.formRecoveryBonus : 0);
      const healthMult = 1 + (inCompartment ? COMPARTMENT.healthRecoveryBonus : 0);
      // A bird convalescing in the infirmary still recovers ENERGIE from its feed,
      // but only when properly staffed (doctor for illness / physio for injury) and
      // then only at INFIRMARY.energyRecoveryFactor of the healthy rate; an uncovered
      // infirmary bird gets none. (Compartment bonus is already off in the boeg.)
      const infirmaryEnergyMult = p.inInfirmary
        ? (coveredInfirmaryIds?.has(p.id) ? INFIRMARY.energyRecoveryFactor : 0)
        : 1;
      const energyGain =
        (ration.formRecovery / 7) * (1 + p.experience / 200) * formMult * infirmaryEnergyMult; // exp + compartment speed recovery
      p.form = round1(clamp(p.form + energyGain, 0, 100));
      p.health = round1(clamp(p.health + (ration.healthRecovery / 7) * healthMult + p.endurance / 280, 0, 100));
      // Premium feed slowly builds conditie — but only up to the MANUAL tier
      // (min(80, geneCap)); passive feeding, like training, cannot push a skill
      // into the 80→90 racing band. Never lowers a bird already built higher.
      if (ration.enduranceRecovery) {
        const foodCap = Math.min(GENE.trainCap, geneCap(p, 'endurance'));
        const target = Math.min(p.endurance + ration.enduranceRecovery / 7, foodCap);
        if (target > p.endurance) {
          const before = p.endurance;
          p.endurance = round1(target);
          noteAttrChange(p, 'endurance', before, 'premiumvoer');
        }
      }
      if (ration.libidoRecovery) p.libido = round1(clamp(p.libido + ration.libidoRecovery / 7, 0, 100));
      // A hired coach POLISHES racing attributes above 90 up to the gene cap (never
      // libido, never while away on a live flight). Below 90 it has no effect, so it
      // only helps a bird whose genes allow >90. Experience is only earned when it
      // actually polishes something.
      if (p.coached && !p.ailment && !p.inInfirmary && !livePigeonIds?.has(p.id)) {
        let polished = false;
        for (const attr of RACING_ATTRS) {
          const g = coachDailyGain(p[attr], geneCap(p, attr));
          if (g > 0) {
            const before = p[attr];
            p[attr] = round1(clamp(p[attr] + g, 0, geneCap(p, attr)));
            noteAttrChange(p, attr, before, 'coach');
            polished = true;
          }
        }
        if (polished) p.experience = round1(clamp(p.experience + COACH.experienceDailyGain, 0, 100));
      }
      // Libido drifts toward conditie + energie; a frisky minority stays high.
      let target = p.endurance * 0.5 + p.form * 0.5;
      const h = hashString(p.id);
      if (h % 100 < 12) target = Math.max(target, 65 + ((h >> 7) % 25));
      p.libido = round1(clamp(p.libido + (target - p.libido) * 0.04, 0, 100));
      // Rest bonus: a fed bird resting at home (not racing) builds rest; every
      // few such days it gets an extra energie boost. Racing resets this (see
      // applyFlightEffects). A bird in the infirmary is convalescing, not resting
      // fit — it recovers energie ONLY through the reduced feeding above, so it
      // neither builds the rest streak nor earns the bonus while in the boeg.
      if (!livePigeonIds?.has(p.id) && !p.inInfirmary) {
        p.restDays = (p.restDays ?? 0) + 1;
        if (p.restDays % REST_BONUS.everyDays === 0) {
          p.form = round1(clamp(p.form + REST_BONUS.energy, 0, 100));
        }
      }
    } else {
      p.restDays = 0; // a hungry day breaks the rest streak
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
export function projectDailyCare(loft: Loft, p: Pigeon, live = false, covered = false): DailyCareProjection {
  const key: keyof typeof FEED_RATIONS =
    p.ration && p.ration in FEED_RATIONS ? p.ration : (loft.feedRation in FEED_RATIONS ? loft.feedRation : 'normal');
  const ration = FEED_RATIONS[key];
  const dailyNeed = ration.foodPerPigeon / 7;
  const fed = (loft.food[key] ?? 0) >= dailyNeed;
  const coachEligible = !!p.coached && !p.ailment && !p.inInfirmary && !live && fed;
  const coachGainOf = (attr: RacingAttr) => (coachEligible ? coachDailyGain(p[attr], geneCap(p, attr)) : 0);
  // A coach only "works" (and is worth paying) when it actually polishes a skill ≥90.
  const coachActive = coachEligible && RACING_ATTRS.some((a) => coachGainOf(a) > 0);
  // Convalescing in the infirmary → energie recovers at a reduced rate (staffed)
  // or not at all (unstaffed); mirror applyDayOfCare.
  const infirmaryEnergyMult = p.inInfirmary ? (covered ? INFIRMARY.energyRecoveryFactor : 0) : 1;

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
    const inCompartment = !!p.compartment && !p.inInfirmary; // no rest bonus while in the infirmary
    const formMult = 1 + (inCompartment ? COMPARTMENT.formRecoveryBonus : 0);
    const healthMult = 1 + (inCompartment ? COMPARTMENT.healthRecoveryBonus : 0);
    let rawForm = (ration.formRecovery / 7) * (1 + p.experience / 200) * formMult * infirmaryEnergyMult;
    // A rest-bonus day (fed, home) adds an extra energie boost — show it in the
    // projected ▲ on the day it lands. Not while convalescing in the infirmary.
    if (!live && !p.inInfirmary && ((p.restDays ?? 0) + 1) % REST_BONUS.everyDays === 0) rawForm += REST_BONUS.energy;
    form = rise(p.form, rawForm, 100);
    health = rise(p.health, (ration.healthRecovery / 7) * healthMult + p.endurance / 280, 100);
    // Conditie from premium feed — only up to the manual tier (min(80, geneCap)),
    // never lowering a bird already built higher.
    let enduranceRaw = 0;
    let libidoFromFeed = 0;
    if (ration.enduranceRecovery) {
      const foodCap = Math.min(GENE.trainCap, geneCap(p, 'endurance'));
      const target = Math.min(p.endurance + ration.enduranceRecovery / 7, foodCap);
      if (target > p.endurance) enduranceRaw += target - p.endurance;
    }
    if (ration.libidoRecovery) libidoFromFeed = ration.libidoRecovery / 7;
    if (coachActive) {
      // Coach drills every skill toward its gene cap (any level, diminishing). For
      // conditie it stacks on top of the food gain (both move it toward the cap).
      speed = rise(p.speed, coachGainOf('speed'), geneCap(p, 'speed'));
      orientation = rise(p.orientation, coachGainOf('orientation'), geneCap(p, 'orientation'));
      enduranceRaw += coachGainOf('endurance');
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
/**
 * The recurring costs charged to a loft for ONE day: fixed upkeep + coach
 * salaries + infirmary staff/medicated feed. (Deducted in schedule.tickDailyCare;
 * sponsor stipends are paid there too.) Returned so callers can total it up.
 */
export function dailyRunningCost(loft: Loft, pigeonCount: number, coachedCount: number, infirmaryBirds: number): number {
  const upkeep = DAILY_UPKEEP_BASE + pigeonCount * DAILY_UPKEEP_PER_PIGEON;
  const coaches = coachedCount * COACH.dailySalary;
  const staff = loft.doctors * INFIRMARY.doctorSalary + loft.physios * INFIRMARY.physioSalary;
  const feed = loft.medicatedFood ? infirmaryBirds * INFIRMARY.medicatedFoodPerBird : 0;
  return upkeep + coaches + staff + feed;
}
