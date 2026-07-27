/**
 * Bot behaviour. Bots are ordinary lofts with `isBot` set; each week the engine
 * lets them make simple, sensible decisions so human players always have
 * competition in the flights. Deliberately lightweight and easy to make
 * smarter later.
 */

import { FEED_RATIONS, TRAINING } from '../config/gameConfig.js';
import type { Flight, Loft, Pigeon } from '../db/schema.js';
import { canRace, talent } from './pigeon.js';
import { clamp, round1 } from './util.js';

/** Choose a feed ration based on how flush the bot is. */
function chooseRation(loft: Loft): void {
  if (loft.money > 4000) loft.feedRation = 'high';
  else if (loft.money > 1000) loft.feedRation = 'normal';
  else loft.feedRation = 'low';
}

/**
 * Let one bot loft act for the current week: buy food, enter its best rested
 * pigeons into each scheduled flight, and occasionally train a youngster.
 * Mutates the loft, its pigeons and the flights' entry lists.
 */
export function botTakeWeeklyActions(
  loft: Loft,
  pigeons: Pigeon[],
  scheduledFlights: Flight[],
  currentWeek: number,
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

  // Track which of the bot's pigeons are already committed this week so it
  // spreads its birds across the different flights instead of stacking them.
  const committed = new Set<string>(
    scheduledFlights.flatMap((f) =>
      f.entries.filter((e) => e.ownerId === loft.userId).map((e) => e.pigeonId),
    ),
  );

  for (const flight of scheduledFlights) {
    if (loft.money < flight.entryFee) continue;
    const eligible = pigeons
      .filter((p) => canRace(p, currentWeek) && p.form > 45 && !committed.has(p.id))
      .sort((a, b) => talent(b) + b.form - (talent(a) + a.form));

    // A bot enters up to 3 birds per flight, budget permitting.
    for (const p of eligible.slice(0, 3)) {
      if (loft.money < flight.entryFee) break;
      flight.entries.push({ pigeonId: p.id, ownerId: loft.userId });
      committed.add(p.id);
      loft.money -= flight.entryFee;
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
