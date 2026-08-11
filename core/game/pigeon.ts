/** Pigeon creation, ageing and derived helpers. */

import {
  AGE_CURVE,
  BREED_RARITY,
  DEFAULT_BREED_ID,
  GENE,
  MORTALITY_CURVE,
  PIGEON_BREEDS,
  RACE_AGE_WEEKS,
  TRAINING,
  type BreedDef,
  type RacingAttr,
} from '../config/gameConfig.js';
import type { AttrChange, Pigeon, PigeonGenes, Sex } from '../schema.js';
import { newId } from '../store.js';
import { generatePigeonName } from './names.js';
import { bell, clamp, interpolate, randInt, round1 } from './util.js';

// ---------------------------------------------------------------------------
// Genetics: per-bird ceilings for the trainable racing skills, plus the ageing
// decline rate. No bird can reach 100 in a racing skill (hard ceiling GENE.ceil).
// ---------------------------------------------------------------------------

/**
 * Roll one gene CAP for a racing skill: a bell curve roughly centred on ~83,
 * shifted by the source's `quality`, and clamped to [GENE.floor, GENE.ceil]. So
 * 95 (elite) and 70 (weak) are both the rare boundaries; most birds land 78–90.
 */
export function rollGeneCap(quality = 0.5, rng: () => number = Math.random): number {
  const avg = (rng() + rng() + rng()) / 3; // bell 0..1
  const raw = GENE.rollMin + avg * (GENE.rollMax - GENE.rollMin) + (quality - 0.5) * GENE.qualityShift;
  return Math.round(clamp(raw, GENE.floor, GENE.ceil));
}

/** Roll a full genetic profile (the three racing caps + the ageing decline rate). */
export function rollGenes(quality = 0.5, rng: () => number = Math.random): { genes: PigeonGenes; declineRate: number } {
  return {
    genes: {
      speed: rollGeneCap(quality, rng),
      endurance: rollGeneCap(quality, rng),
      orientation: rollGeneCap(quality, rng),
    },
    declineRate: round1(GENE.declineRateMin + rng() * (GENE.declineRateMax - GENE.declineRateMin)),
  };
}

/** This bird's genetic ceiling for a racing skill (legacy fallback: GENE.ceil). */
export function geneCap(p: Pigeon, attr: RacingAttr): number {
  const g = p.genes?.[attr];
  return typeof g === 'number' ? g : GENE.ceil;
}

/** Average genetic ceiling across the three racing skills (drives market value). */
export function avgGeneCap(p: Pigeon): number {
  return (geneCap(p, 'speed') + geneCap(p, 'endurance') + geneCap(p, 'orientation')) / 3;
}

/** Ceiling manual training can reach for a skill: min(80, geneCap). */
export function trainCeil(p: Pigeon, attr: RacingAttr): number {
  return Math.min(GENE.trainCap, geneCap(p, attr));
}

/** Ceiling racing (flights) can reach for a skill: min(90, geneCap). */
export function raceCeil(p: Pigeon, attr: RacingAttr): number {
  return Math.min(GENE.raceCap, geneCap(p, attr));
}

/** The (level-scaled, exponential) cost of the next manual training step. */
export function trainingCost(value: number): number {
  const raw = TRAINING.costBase * Math.pow(TRAINING.costGrowth, value / 10);
  return Math.max(TRAINING.costMin, Math.round(raw / 5) * 5);
}

/** Cap on how many skill-change entries we keep per bird (newest kept). */
const ATTR_LOG_CAP = 40;

/**
 * Record a change to a racing skill (snelheid/conditie/oriëntatie) on the bird's
 * audit log, so a rise or fall is later fully explainable (what, from→to, why,
 * when). Call it right AFTER mutating `p[attr]`, passing the value it had BEFORE.
 * No-op when the displayed (1-decimal) value didn't actually move — so a tiny
 * ageing nudge that rounds away isn't logged as a phantom change.
 */
export function noteAttrChange(p: Pigeon, attr: RacingAttr, before: number, reason: string): void {
  const to = p[attr];
  if (round1(before) === round1(to)) return;
  const entry: AttrChange = { attr, from: round1(before), to: round1(to), reason, at: new Date().toISOString() };
  const log = p.attrLog ? [...p.attrLog, entry] : [entry];
  p.attrLog = log.length > ATTR_LOG_CAP ? log.slice(-ATTR_LOG_CAP) : log;
}

/** Look up a breed by id, falling back to the default (Stadsduif) breed. */
export function breedInfo(breedId: string | undefined): BreedDef {
  return (
    PIGEON_BREEDS.find((b) => b.id === breedId) ??
    PIGEON_BREEDS.find((b) => b.id === DEFAULT_BREED_ID)!
  );
}

/** Price premium for a breed's rarity (1.0 for common/mixed). */
export function breedPriceMult(breedId: string | undefined): number {
  return BREED_RARITY[breedInfo(breedId).rarity].priceMult;
}

/**
 * Roll a random breed by weight (mirrors roekoe.org/wiki/breeds). The `mixed`
 * breed has weight 0 so it is never rolled here — it only arises from crossing
 * two different breeds. `rng` defaults to Math.random.
 */
export function rollBreed(rng: () => number = Math.random): string {
  const total = PIGEON_BREEDS.reduce((s, b) => s + b.weight, 0);
  let r = rng() * total;
  for (const b of PIGEON_BREEDS) {
    r -= b.weight;
    if (r < 0) return b.id;
  }
  return DEFAULT_BREED_ID;
}

const ageCurvePoints = AGE_CURVE.map((p) => ({ x: p.weeks, y: p.multiplier }));
const mortalityPoints = MORTALITY_CURVE.map((p) => ({ x: p.weeks, y: p.p }));

export function ageInWeeks(pigeon: Pigeon, currentWeek: number): number {
  return Math.max(0, currentWeek - pigeon.birthWeek);
}

/** Weekly probability this pigeon dies of old age (0..1). */
export function ageMortality(pigeon: Pigeon, currentWeek: number): number {
  return interpolate(mortalityPoints, ageInWeeks(pigeon, currentWeek));
}

export function canRace(pigeon: Pigeon, currentWeek: number): boolean {
  return (
    !pigeon.ailment &&
    !pigeon.inInfirmary &&
    !onRestCure(pigeon) &&
    ageInWeeks(pigeon, currentWeek) >= RACE_AGE_WEEKS &&
    pigeon.health > 15
  );
}

/** Whether a paid rest cure is still running (bird rests, can do nothing). */
export function onRestCure(pigeon: Pigeon, nowMs: number = Date.now()): boolean {
  return !!pigeon.cureUntil && Date.parse(pigeon.cureUntil) > nowMs;
}

/** Performance multiplier from the age curve (0..1). */
export function ageMultiplier(pigeon: Pigeon, currentWeek: number): number {
  return interpolate(ageCurvePoints, ageInWeeks(pigeon, currentWeek));
}

export interface GenerateOptions {
  ownerId: string;
  currentWeek: number;
  /** Overall quality bias 0..1: nudges attribute rolls up or down. */
  quality?: number;
  sex?: Sex;
  name?: string;
  birthWeek?: number;
  /** Force a specific breed; otherwise one is rolled by weight. */
  breed?: string;
}

/** Create a fresh pigeon with rolled attributes. */
export function generatePigeon(opts: GenerateOptions): Pigeon {
  const quality = opts.quality ?? 0.5;
  const { genes, declineRate } = rollGenes(quality);
  const roll = (cap: number) => {
    // Base bell curve 25..80, shifted by quality — then clamped to the gene cap,
    // so a fresh bird never starts above its own genetic ceiling.
    const base = bell(25, 80);
    return round1(clamp(base + (quality - 0.5) * 40, 5, cap));
  };
  const birthWeek = opts.birthWeek ?? opts.currentWeek - randInt(RACE_AGE_WEEKS, 130);
  const speed = roll(genes.speed);
  const endurance = roll(genes.endurance);
  const orientation = roll(genes.orientation);
  // Libido spans the full range independently of racing quality.
  const libido = round1(bell(20, 90));
  const sex: Sex = opts.sex ?? (Math.random() < 0.5 ? 'doffer' : 'duivin');
  return {
    id: newId('pig'),
    ownerId: opts.ownerId,
    name: opts.name ?? generatePigeonName(sex, { speed, endurance, orientation }),
    sex,
    birthWeek,
    speed,
    endurance,
    orientation,
    libido,
    form: round1(bell(55, 85)),
    health: round1(bell(70, 95)),
    experience: 0,
    sireId: null,
    damId: null,
    forSale: false,
    price: null,
    createdAtWeek: opts.currentWeek,
    ailment: null,
    inInfirmary: false,
    races: 0,
    everAiled: false,
    breed: opts.breed ?? rollBreed(),
    coached: false,
    ration: 'normal',
    compartment: false,
    hungerDays: 0,
    restDays: 0,
    genes,
    declineRate,
  };
}

/** Overall talent score used for market pricing and bot decisions. */
export function talent(pigeon: Pigeon): number {
  return round1((pigeon.speed + pigeon.endurance + pigeon.orientation) / 3);
}

/**
 * A pigeon's overall development score — the sum of every attribute it can grow
 * through racing, training and breeding. Used to measure a bird's progress over
 * a season (current score minus its score at the season's start).
 */
export function seasonScore(pigeon: Pigeon): number {
  return round1(
    pigeon.speed + pigeon.endurance + pigeon.orientation + pigeon.libido + pigeon.experience,
  );
}

/** A suggested market value in coins based on talent, potential, age and condition. */
export function estimateValue(pigeon: Pigeon, currentWeek: number): number {
  const t = talent(pigeon);
  const base = Math.pow(t / 50, 2.2) * 800; // talent scales value steeply
  const ageFactor = ageMultiplier(pigeon, currentWeek);
  const expFactor = 1 + pigeon.experience / 200;
  // A rarer breed fetches a small premium (cosmetic only — attributes unchanged).
  const breedFactor = breedPriceMult(pigeon.breed);
  // GENETIC POTENTIAL: the higher a bird's caps allow it to climb, the more it is
  // worth (and vice versa) — so a young bird with elite genes but low current stats
  // still commands a premium. Neutral at the ~82 average; ~×0.6 for weak genes,
  // ~×1.6 for a 95-capped topper.
  const potentialFactor = clamp(Math.pow(avgGeneCap(pigeon) / 82, 3), 0.6, 1.7);
  return Math.max(
    50,
    Math.round((base * (0.6 + 0.4 * ageFactor) * expFactor * breedFactor * potentialFactor) / 10) * 10,
  );
}
