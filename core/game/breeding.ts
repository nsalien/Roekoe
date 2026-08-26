/** Breeding: pairing pigeons and producing young that inherit attributes. */

import { BREEDING, DEFAULT_BREED_ID, GENE, MIXED_BREED_ID } from '../config/gameConfig.js';
import type { Database, Loft, Pigeon, PigeonGenes } from '../schema.js';
import { newId } from '../store.js';
import { awardBadge, evaluateBadges } from './badges.js';
import { geneCap, talent } from './pigeon.js';
import { generatePigeonName, nameKey } from './names.js';
import { clamp, randFloat, round1 } from './util.js';

/**
 * A youngster's breed: it inherits the parents' breed only when BOTH parents
 * are the same breed; two different breeds produce a `mixed` (Gemengd) bird.
 * (A mixed parent bred with anything but another identical mixed → mixed again.)
 */
function inheritBreed(sire: Pigeon, dam: Pigeon): string {
  const s = sire.breed ?? DEFAULT_BREED_ID;
  const d = dam.breed ?? DEFAULT_BREED_ID;
  return s === d ? s : MIXED_BREED_ID;
}

/** Inherit one attribute: average of parents plus a random mutation, capped to
 *  the youngster's own gene ceiling for that skill. */
function inherit(a: number, b: number, cap: number): number {
  const avg = (a + b) / 2;
  return round1(clamp(avg + randFloat(-BREEDING.mutation, BREEDING.mutation), 5, cap));
}

/** Inherit one gene CEILING: average of the parents' caps ± mutation, clamped to
 *  [GENE.floor, GENE.ceil] — so a line of well-gened birds tends to stay high, but
 *  no youngster can ever reach 100. */
function inheritGeneCap(a: number, b: number): number {
  const avg = (a + b) / 2;
  return Math.round(clamp(avg + randFloat(-GENE.mutation, GENE.mutation), GENE.floor, GENE.ceil));
}

export function canBreed(sire: Pigeon, dam: Pigeon, currentWeek: number): string | null {
  if (sire.sex !== 'doffer') return 'De eerste ouder moet een doffer zijn';
  if (dam.sex !== 'duivin') return 'De tweede ouder moet een duivin zijn';
  if (sire.form < BREEDING.minParentForm || dam.form < BREEDING.minParentForm)
    return `Beide ouders hebben minstens ${BREEDING.minParentForm} conditie nodig`;
  return null;
}

/**
 * Produce offspring from two parents. Libido drives fertility: the average
 * parent libido sets both the chance of getting any young at all and the odds
 * of a second youngster. A low-libido pair can come up empty (a wasted koppel).
 */
export function breed(
  sire: Pigeon,
  dam: Pigeon,
  ownerId: string,
  hatchWeek: number,
  /** Names already in the world, so a youngster never duplicates one (names.namesInUse). */
  taken?: Set<string>,
): Pigeon[] {
  const avgLibido = (sire.libido + dam.libido) / 2;
  // Low energie (form) makes a pair less likely to produce young.
  const avgEnergy = (sire.form + dam.form) / 2;
  const energyFactor = clamp(0.5 + avgEnergy / 200, 0.5, 1);
  const successChance = clamp((0.55 + (avgLibido / 100) * 0.45) * energyFactor, 0.2, 1);
  if (Math.random() > successChance) return []; // no young this time
  const secondChance = clamp((avgLibido / 100) * 0.7 * energyFactor, 0, 0.7);
  const count = Math.random() < secondChance ? 2 : 1;

  const young: Pigeon[] = [];
  const childBreed = inheritBreed(sire, dam);
  for (let i = 0; i < count; i++) {
    // GENETICS inherit first (average of parents' caps ± mutation), then the
    // starting skills are inherited and clamped to the youngster's own ceilings.
    const genes: PigeonGenes = {
      speed: inheritGeneCap(geneCap(sire, 'speed'), geneCap(dam, 'speed')),
      endurance: inheritGeneCap(geneCap(sire, 'endurance'), geneCap(dam, 'endurance')),
      orientation: inheritGeneCap(geneCap(sire, 'orientation'), geneCap(dam, 'orientation')),
    };
    const declineRate = round1(
      clamp(
        ((sire.declineRate ?? 1) + (dam.declineRate ?? 1)) / 2 + randFloat(-0.3, 0.3),
        GENE.declineRateMin,
        GENE.declineRateMax,
      ),
    );
    const speed = inherit(sire.speed, dam.speed, genes.speed);
    const endurance = inherit(sire.endurance, dam.endurance, genes.endurance);
    const orientation = inherit(sire.orientation, dam.orientation, genes.orientation);
    const libido = inherit(sire.libido, dam.libido, 100); // libido isn't gene-capped
    const sex: 'doffer' | 'duivin' = Math.random() < 0.5 ? 'doffer' : 'duivin';
    young.push({
      id: newId('pig'),
      ownerId,
      name: (() => {
        const n = generatePigeonName(sex, { speed, endurance, orientation }, taken);
        taken?.add(nameKey(n)); // a twin must not get its sibling's name either
        return n;
      })(),
      sex,
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
      ailment: null,
      inInfirmary: false,
      races: 0,
      everAiled: false,
      breed: childBreed,
      coached: false,
      ration: 'normal',
      compartment: false,
      hungerDays: 0,
      restDays: 0,
      genes,
      declineRate,
    });
  }
  return young;
}

/**
 * Award the breeding badges + the babies counter for young that actually entered
 * the loft. Shared by the immediate hatch and by a held clutch resolved later
 * (`resolveBrood`), so both paths credit a breeder identically.
 *
 * `clutchSize` is the size of the whole clutch, not just what was admitted: the
 * `tweeling` badge is for producing twins, however many of them you kept.
 */
export function awardBroodBadges(
  db: Database,
  loft: Loft,
  admitted: Pigeon[],
  clutchSize: number,
  dynasty: boolean,
): void {
  loft.stats.babies += admitted.length;
  if (clutchSize >= 2) awardBadge(db, loft, 'tweeling');
  if (admitted.some((y) => talent(y) > 85)) awardBadge(db, loft, 'topfokker');
  if (dynasty) awardBadge(db, loft, 'dynastie');
  evaluateBadges(db, loft);
}
