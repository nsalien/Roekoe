/** Pigeon creation, ageing and derived helpers. */

import {
  AGE_CURVE,
  BREED_RARITY,
  DEFAULT_BREED_ID,
  MORTALITY_CURVE,
  PIGEON_BREEDS,
  RACE_AGE_WEEKS,
  type BreedDef,
} from '../config/gameConfig.js';
import type { Pigeon, Sex } from '../schema.js';
import { newId } from '../store.js';
import { generatePigeonName } from './names.js';
import { bell, clamp, interpolate, randInt, round1 } from './util.js';

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
  const roll = () => {
    // Base bell curve 25..80, shifted by quality.
    const base = bell(25, 80);
    return round1(clamp(base + (quality - 0.5) * 40, 5, 97));
  };
  const birthWeek = opts.birthWeek ?? opts.currentWeek - randInt(RACE_AGE_WEEKS, 130);
  const speed = roll();
  const endurance = roll();
  const orientation = roll();
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

/** A suggested market value in coins based on talent, age and condition. */
export function estimateValue(pigeon: Pigeon, currentWeek: number): number {
  const t = talent(pigeon);
  const base = Math.pow(t / 50, 2.2) * 800; // talent scales value steeply
  const ageFactor = ageMultiplier(pigeon, currentWeek);
  const expFactor = 1 + pigeon.experience / 200;
  // A rarer breed fetches a small premium (cosmetic only — attributes unchanged).
  const breedFactor = breedPriceMult(pigeon.breed);
  return Math.max(50, Math.round((base * (0.6 + 0.4 * ageFactor) * expFactor * breedFactor) / 10) * 10);
}
