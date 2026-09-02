/** Pigeon creation, ageing and derived helpers. */

import {
  AGE_CURVE,
  BREEDING,
  BREED_RARITY,
  DEFAULT_BREED_ID,
  EXPERIENCE,
  FORM,
  GENE,
  RECOVERY,
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

/**
 * Scale a RAW ervaring gain by the bird's remaining room: fast for a rookie,
 * slow for a veteran (see EXPERIENCE in gameConfig for the curve and why
 * `minFactor` may not go below 0.10).
 *
 * Call this at the SOURCE of every gain — the scaled value is what actually gets
 * added, so anything that also reads the delta (e.g. `seasonPracticeGain`) sees
 * the real number. The result is deliberately NOT rounded: the caller's final
 * `round1(experience + delta)` does that, so a small gain isn't inflated twice.
 */
export function experienceGain(current: number, raw: number): number {
  if (raw <= 0) return raw; // nothing lowers ervaring today; never scale a loss
  const room = clamp((100 - current) / 100, 0, 1);
  const factor =
    EXPERIENCE.minFactor + (EXPERIENCE.maxFactor - EXPERIENCE.minFactor) * Math.pow(room, EXPERIENCE.curve);
  return raw * factor;
}

/**
 * CONDITIE-SCORE: how well this bird is being kept right now, from the two things
 * the fancier manages — energie and gezondheid. The LOWER of the two counts double,
 * so one weak link is never masked by the other (a rested but sickly bird is as
 * much a liability as a healthy but empty one).
 *
 * This is the raw score, without the rest deduction. It drives ILLNESS (a bird
 * standing in the loft can fall ill regardless of when it last raced).
 */
export function conditionScore(p: Pigeon): number {
  const lo = Math.min(p.form, p.health);
  const hi = Math.max(p.form, p.health);
  const total = FORM.lowWeight + FORM.highWeight;
  return clamp((FORM.lowWeight * lo + FORM.highWeight * hi) / total, 0, 100);
}

/**
 * How much vluchtvorm this bird loses for having raced recently. Energie recovery
 * can be bought (Herstelvoer + a private compartment), rest cannot — so flying on
 * consecutive days is docked here rather than through the energie tank.
 */
export function restPenalty(p: Pigeon, nowMs: number = Date.now()): number {
  if (!p.lastRaceAt) return 0;
  const last = Date.parse(p.lastRaceAt);
  if (Number.isNaN(last)) return 0;
  const days = Math.floor((nowMs - last) / 86400000);
  let penalty = 0;
  if (days <= 0) penalty = RECOVERY.penaltyYesterday; // raced today (relay legs, re-runs)
  else if (days === 1) penalty = RECOVERY.penaltyYesterday;
  else if (days === 2) penalty = RECOVERY.penaltyTwoDays;
  if (penalty === 0) return 0;
  return p.lastRaceWasPractice ? penalty * RECOVERY.practiceFactor : penalty;
}

/**
 * VLUCHTVORM: the conditie-score minus the rest deduction. This one number decides
 * a bird's strain-injury odds, how bad that injury turns out, and the risk badge the
 * player sees before entering a race. See INJURY/RECOVERY in gameConfig.
 */
export function flightForm(p: Pigeon, nowMs: number = Date.now()): number {
  return clamp(conditionScore(p) - restPenalty(p, nowMs), 0, 100);
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
  const at = new Date().toISOString();
  const entry: AttrChange = { attr, from: round1(before), to: round1(to), reason, at };
  // Queued, not stored on the bird: the two history logs live in their own table
  // now (see Pigeon.pendingLog). An append must not need the previous value —
  // the engine is synchronous and cannot read the database mid-tick — so this is
  // one row per change, capped later by the pruner in persist().
  (p.pendingLog ??= []).push({
    id: `${p.id}:attr:${at}:${attr}:${p.pendingLog?.length ?? 0}`,
    pigeonId: p.id,
    kind: 'attr',
    at,
    data: JSON.stringify(entry),
  });
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
    !isAway(pigeon) && // still finding her way home from a previous flight
    ageInWeeks(pigeon, currentWeek) >= RACE_AGE_WEEKS &&
    pigeon.health > 15
  );
}

/** Whether a paid rest cure is still running (bird rests, can do nothing). */
export function onRestCure(pigeon: Pigeon, nowMs: number = Date.now()): boolean {
  return !!pigeon.cureUntil && Date.parse(pigeon.cureUntil) > nowMs;
}

/**
 * When this bird may raise another clutch, or `null` if she is free right now.
 * Counted from her last HATCH (`lastBredAt`), per bird — pairing her with a
 * different partner does not reset it, because the rest is hers, not the pair's.
 *
 * A bird that has never bred (or bred before this shipped) returns null.
 */
export function breedingCooldownUntil(pigeon: Pigeon, nowMs: number = Date.now()): number | null {
  const last = pigeon.lastBredAt ? Date.parse(pigeon.lastBredAt) : NaN;
  if (Number.isNaN(last)) return null;
  const until = last + BREEDING.cooldownDays * 86400000;
  return until > nowMs ? until : null;
}

/** Whole days (rounded up) until this bird may breed again; 0 when she is free. */
export function breedingCooldownDaysLeft(pigeon: Pigeon, nowMs: number = Date.now()): number {
  const until = breedingCooldownUntil(pigeon, nowMs);
  return until ? Math.ceil((until - nowMs) / 86400000) : 0;
}

/**
 * VERLOREN: she lost her way on a flight and has not made it back yet. While this
 * holds she is not in the loft at all — see Pigeon.awayUntil for everything that
 * is skipped. She always comes home eventually (tickStrayReturn).
 */
export function isAway(pigeon: Pigeon, nowMs: number = Date.now()): boolean {
  return !!pigeon.awayUntil && Date.parse(pigeon.awayUntil) > nowMs;
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
  /**
   * Names already in use (see names.namesInUse). Pass it and the new bird is
   * guaranteed a first-name + epithet combination nobody else has. Generating
   * several birds in a row? Add each returned name to the set as you go.
   */
  taken?: ReadonlySet<string>;
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
    name: opts.name ?? generatePigeonName(sex, { speed, endurance, orientation }, opts.taken),
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
