/** Pigeon creation, ageing and derived helpers. */

import { AGE_CURVE, MORTALITY_CURVE, RACE_AGE_WEEKS } from '../config/gameConfig.js';
import type { Pigeon, Sex } from '../schema.js';
import { newId } from '../store.js';
import { generatePigeonName } from './names.js';
import { bell, clamp, interpolate, randInt, round1 } from './util.js';

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
    ageInWeeks(pigeon, currentWeek) >= RACE_AGE_WEEKS &&
    pigeon.health > 15
  );
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
    coached: false,
    ration: 'normal',
    compartment: false,
  };
}

/** Overall talent score used for market pricing and bot decisions. */
export function talent(pigeon: Pigeon): number {
  return round1((pigeon.speed + pigeon.endurance + pigeon.orientation) / 3);
}

/** A suggested market value in coins based on talent, age and condition. */
export function estimateValue(pigeon: Pigeon, currentWeek: number): number {
  const t = talent(pigeon);
  const base = Math.pow(t / 50, 2.2) * 800; // talent scales value steeply
  const ageFactor = ageMultiplier(pigeon, currentWeek);
  const expFactor = 1 + pigeon.experience / 200;
  return Math.max(50, Math.round((base * (0.6 + 0.4 * ageFactor) * expFactor) / 10) * 10);
}
