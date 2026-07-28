/** Breeding: pairing pigeons and producing young that inherit attributes. */

import { BREEDING } from '../config/gameConfig.js';
import type { Pigeon } from '../schema.js';
import { newId } from '../store.js';
import { generatePigeonName } from './names.js';
import { clamp, randFloat, round1 } from './util.js';

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

/**
 * Produce offspring from two parents. Libido drives fertility: the average
 * parent libido sets both the chance of getting any young at all and the odds
 * of a second youngster. A low-libido pair can come up empty (a wasted koppel).
 */
export function breed(sire: Pigeon, dam: Pigeon, ownerId: string, hatchWeek: number): Pigeon[] {
  const avgLibido = (sire.libido + dam.libido) / 2;
  const successChance = clamp(0.55 + (avgLibido / 100) * 0.45, 0.55, 1);
  if (Math.random() > successChance) return []; // no young this time
  const secondChance = clamp((avgLibido / 100) * 0.7, 0, 0.7);
  const count = Math.random() < secondChance ? 2 : 1;

  const young: Pigeon[] = [];
  for (let i = 0; i < count; i++) {
    const speed = inherit(sire.speed, dam.speed);
    const endurance = inherit(sire.endurance, dam.endurance);
    const orientation = inherit(sire.orientation, dam.orientation);
    const libido = inherit(sire.libido, dam.libido);
    young.push({
      id: newId('pig'),
      ownerId,
      name: generatePigeonName({ speed, endurance, orientation }),
      sex: Math.random() < 0.5 ? 'doffer' : 'duivin',
      birthWeek: hatchWeek,
      speed,
      endurance,
      orientation,
      libido,
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
