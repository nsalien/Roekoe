/** Breeding: pairing pigeons and producing young that inherit attributes. */

import { BREEDING, PIGEON_NAMES } from '../config/gameConfig.js';
import type { Pigeon } from '../db/schema.js';
import { newId } from '../db/store.js';
import { clamp, pick, randInt, randFloat, round1 } from './util.js';

/** Inherit one attribute: average of parents plus a random mutation. */
function inherit(a: number, b: number): number {
  const avg = (a + b) / 2;
  return round1(clamp(avg + randFloat(-BREEDING.mutation, BREEDING.mutation), 5, 99));
}

export function canBreed(sire: Pigeon, dam: Pigeon, currentWeek: number): string | null {
  if (sire.sex !== 'doffer') return 'De eerste ouder moet een doffer zijn';
  if (dam.sex !== 'duivin') return 'De tweede ouder moet een duivin zijn';
  if (sire.retired || dam.retired) return 'Een gepensioneerde duif kan niet kweken';
  if (sire.form < BREEDING.minParentForm || dam.form < BREEDING.minParentForm)
    return `Beide ouders hebben minstens ${BREEDING.minParentForm} conditie nodig`;
  return null;
}

/** Produce 1..maxYoung offspring from two parents. */
export function breed(sire: Pigeon, dam: Pigeon, ownerId: string, hatchWeek: number): Pigeon[] {
  const count = randInt(BREEDING.minYoung, BREEDING.maxYoung);
  const young: Pigeon[] = [];
  for (let i = 0; i < count; i++) {
    young.push({
      id: newId('pig'),
      ownerId,
      name: pick(PIGEON_NAMES),
      sex: Math.random() < 0.5 ? 'doffer' : 'duivin',
      birthWeek: hatchWeek,
      speed: inherit(sire.speed, dam.speed),
      endurance: inherit(sire.endurance, dam.endurance),
      orientation: inherit(sire.orientation, dam.orientation),
      form: round1(randFloat(55, 75)),
      health: round1(randFloat(75, 95)),
      experience: 0,
      sireId: sire.id,
      damId: dam.id,
      forSale: false,
      price: null,
      createdAtWeek: hatchWeek,
      retired: false,
    });
  }
  return young;
}
