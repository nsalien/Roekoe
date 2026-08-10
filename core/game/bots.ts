/**
 * Bot behaviour. Bots are ordinary lofts with `isBot` set; each week the engine
 * lets them make simple, sensible decisions so human players always have
 * competition in the flights. Deliberately lightweight and easy to make
 * smarter later.
 */

import { FEED_RATIONS, INFIRMARY, TRAINING } from '../config/gameConfig.js';
import type { Loft, Pigeon } from '../schema.js';
import { talent, trainCeil, trainingCost } from './pigeon.js';
import { clamp, round1 } from './util.js';

/** Bots isolate and (if they can afford it) treat their ailing birds. */
function manageInfirmary(loft: Loft, pigeons: Pigeon[]): void {
  const active = pigeons;
  // Free up healthy birds resting in the infirmary.
  for (const p of active) if (p.inInfirmary && !p.ailment) p.inInfirmary = false;
  // Move ailing birds into the infirmary up to capacity.
  let free = loft.infirmaryCapacity - active.filter((p) => p.inInfirmary).length;
  for (const p of active) {
    if (free <= 0) break;
    if (p.ailment && !p.inInfirmary) {
      p.inInfirmary = true;
      free--;
    }
  }
  const sickIn = active.filter((p) => p.inInfirmary && p.ailment?.kind === 'ziekte').length;
  const injIn = active.filter((p) => p.inInfirmary && p.ailment?.kind === 'kwetsuur').length;
  if (loft.money > 1500 && sickIn + injIn > 0) {
    loft.medicatedFood = true;
    loft.doctors = loft.money > 2600 ? Math.ceil(sickIn / INFIRMARY.birdsPerDoctor) : 0;
    loft.physios = loft.money > 2600 ? Math.ceil(injIn / INFIRMARY.birdsPerPhysio) : 0;
  } else {
    loft.medicatedFood = false;
    loft.doctors = 0;
    loft.physios = 0;
  }
}

/** Bots feed everyone the standard 'normal' ration. */
function chooseRation(loft: Loft, pigeons: Pigeon[]): void {
  loft.feedRation = 'normal';
  for (const p of pigeons) p.ration = 'normal';
}

/**
 * A bot's weekly housekeeping: pick a feed ration, top up food and occasionally
 * train a promising bird. (Entering flights happens in real time — see
 * schedule.ts — so it is not done here.)
 */
export function botTakeWeeklyActions(
  loft: Loft,
  pigeons: Pigeon[],
  foodPricePerKg: number,
): void {
  chooseRation(loft, pigeons);
  manageInfirmary(loft, pigeons);

  // Keep a healthy 'normal' food buffer (bots only eat normal).
  const desiredFood = pigeons.length * FEED_RATIONS.normal.foodPerPigeon * 4;
  if ((loft.food.normal ?? 0) < desiredFood && loft.money > 800) {
    const buy = Math.min(desiredFood - (loft.food.normal ?? 0), Math.floor((loft.money - 500) / foodPricePerKg));
    if (buy > 0) {
      loft.food.normal = round1((loft.food.normal ?? 0) + buy);
      loft.money -= Math.round(buy * foodPricePerKg);
    }
  }

  // Occasionally invest in training a promising young pigeon. Bots follow the same
  // rules as players: manual training only up to min(80, geneCap) and the cost
  // scales exponentially with the skill's current level.
  if (loft.money > 400) {
    const candidate = pigeons
      .filter((p) => p.form > TRAINING.formCost + 20)
      .sort((a, b) => talent(b) - talent(a))[0];
    if (candidate && Math.random() < 0.5) {
      const attr = (['speed', 'endurance', 'orientation'] as const)[Math.floor(Math.random() * 3)];
      const cap = trainCeil(candidate, attr);
      const cost = trainingCost(candidate[attr]);
      if (candidate[attr] < cap && loft.money > cost * 2) {
        candidate[attr] = round1(clamp(candidate[attr] + TRAINING.attributeGain, 0, cap));
        candidate.form = round1(clamp(candidate.form - TRAINING.formCost, 0, 100));
        candidate.experience = round1(clamp(candidate.experience + TRAINING.experienceGain, 0, 100));
        loft.money -= cost;
      }
    }
  }
}
