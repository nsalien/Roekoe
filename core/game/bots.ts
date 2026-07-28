/**
 * Bot behaviour. Bots are ordinary lofts with `isBot` set; each week the engine
 * lets them make simple, sensible decisions so human players always have
 * competition in the flights. Deliberately lightweight and easy to make
 * smarter later.
 */

import { FEED_RATIONS, TRAINING } from '../config/gameConfig.js';
import type { Loft, Pigeon } from '../schema.js';
import { talent } from './pigeon.js';
import { clamp, round1 } from './util.js';

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
