/**
 * Bot behaviour. Bots are ordinary lofts with `isBot` set; each week the engine
 * lets them make simple, sensible decisions so human players always have
 * competition in the flights. Deliberately lightweight and easy to make
 * smarter later.
 */

import { FEED_RATIONS, INFIRMARY, TRAINING } from '../config/gameConfig.js';
import type { Loft, Pigeon } from '../schema.js';
import { talent } from './pigeon.js';
import { clamp, round1 } from './util.js';

/** Bots isolate and (if they can afford it) treat their ailing birds. */
function manageInfirmary(loft: Loft, pigeons: Pigeon[]): void {
  const active = pigeons.filter((p) => !p.retired);
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

/** Choose a feed ration based on how flush the bot is. */
function chooseRation(loft: Loft): void {
  if (loft.money > 4000) loft.feedRation = 'high';
  else if (loft.money > 1000) loft.feedRation = 'normal';
  else loft.feedRation = 'low';
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
  chooseRation(loft);
  manageInfirmary(loft, pigeons);

  // Keep a healthy food buffer.
  const ration = FEED_RATIONS[loft.feedRation];
  const desiredFood = pigeons.length * ration.foodPerPigeon * 4;
  if (loft.food < desiredFood && loft.money > 800) {
    const buy = Math.min(desiredFood - loft.food, Math.floor((loft.money - 500) / foodPricePerKg));
    if (buy > 0) {
      loft.food = round1(loft.food + buy);
      loft.money -= Math.round(buy * foodPricePerKg);
    }
  }

  // Occasionally invest in training a promising young pigeon.
  if (loft.money > TRAINING.cost * 3) {
    const candidate = pigeons
      .filter((p) => !p.retired && p.form > TRAINING.formCost + 20)
      .sort((a, b) => talent(b) - talent(a))[0];
    if (candidate && Math.random() < 0.5) {
      const attr = (['speed', 'endurance', 'orientation'] as const)[Math.floor(Math.random() * 3)];
      if (candidate[attr] < TRAINING.attributeCap) {
        candidate[attr] = round1(clamp(candidate[attr] + TRAINING.attributeGain, 0, TRAINING.attributeCap));
        candidate.form = round1(clamp(candidate.form - TRAINING.formCost, 0, 100));
        candidate.experience = round1(clamp(candidate.experience + TRAINING.experienceGain, 0, 100));
        loft.money -= TRAINING.cost;
      }
    }
  }
}
