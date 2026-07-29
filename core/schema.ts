/**
 * Entity types persisted by the data layer. These describe the shape of the
 * JSON database. Keeping them in one place makes it easy to see the whole data
 * model and to evolve it (add fields, add entities) as the game grows.
 */

import type { FeedRationKey, Severity } from './config/gameConfig.js';

export type Sex = 'doffer' | 'duivin'; // male / female

/** A current disease or injury a pigeon is suffering from. */
export interface Ailment {
  kind: 'ziekte' | 'kwetsuur';
  name: string;
  severity: Severity;
  description: string;
  sinceWeek: number;
}

/** Core, mostly-genetic attributes plus the dynamic condition of a pigeon. */
export interface Pigeon {
  id: string;
  ownerId: string; // user id of the owner
  name: string;
  sex: Sex;
  birthWeek: number; // world week the pigeon was born
  // Skill attributes (0-100). Improve slowly through training / racing.
  speed: number;
  // `endurance` is the pigeon's CONDITIE (fitness/stamina). Racing builds it;
  // higher conditie lets a bird hold its speed on longer flights and lifts its
  // health + libido over time. (Kept as `endurance` for storage compatibility.)
  endurance: number;
  orientation: number;
  libido: number; // drive to breed; rises with good conditie + energie
  // Dynamic resources (0-100). Fluctuate week to week with care and racing.
  // `form` is the pigeon's ENERGIE ("fut"): drained by racing, restored by rest
  // + food. Low energie means poor performance and more illness/injury; it also
  // gates breeding. (Kept as `form` for storage compatibility.)
  form: number;
  health: number;
  experience: number; // ervaring: confidence → better racing + faster energy recovery
  // Pedigree, for breeding UI and inheritance display.
  sireId: string | null;
  damId: string | null;
  // Market: if listed for sale, price is set. ownerId may be the NPC market.
  forSale: boolean;
  price: number | null;
  createdAtWeek: number;
  retired: boolean;
  // Health status.
  ailment: Ailment | null; // current disease/injury, or null if healthy
  inInfirmary: boolean; // resting in the ziekenboeg (isolated, recovering)
  // Career counters (for badges).
  races: number; // flights this bird has finished
  everAiled: boolean; // has ever been ill or injured (for "Comeback" badge)
}

/** Everything about a player's operation that is not an individual pigeon. */
export interface Loft {
  userId: string;
  name: string;
  money: number;
  food: number; // kg in stock
  feedRation: FeedRationKey;
  capacity: number;
  seasonPoints: number; // ranking points accumulated this season
  totalWins: number;
  isBot: boolean;
  // Infirmary (ziekenboeg).
  infirmaryCapacity: number; // max birds that can rest in the infirmary at once
  medicatedFood: boolean; // feed medicated food to infirmary birds (weekly cost)
  doctors: number; // hired pigeon doctors (help disease recovery)
  physios: number; // hired pigeon physiotherapists (help injury recovery)
  // Prestige (badges / level).
  xp: number; // total player experience from badges
  level: number; // derived from xp (cached for the ranking)
  stats: PlayerStats; // lifetime counters that drive badges
  badges: EarnedBadge[]; // badges earned, with timestamps
}

/** Lifetime counters per loft that unlock badges. */
export interface PlayerStats {
  regionalWins: number;
  nationalWins: number;
  intlWins: number;
  gold: number;
  silver: number;
  bronze: number;
  entries: number;
  babies: number;
  buys: number;
  sells: number;
  cures: number;
  curesSevere: number;
  staffHired: number;
}

export interface EarnedBadge {
  key: string;
  at: string; // ISO timestamp
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  isAdmin: boolean;
  isBot: boolean;
  createdAt: string;
}

/** A pending breeding pair that will hatch young after some weeks. */
export interface BreedingPair {
  id: string;
  ownerId: string;
  sireId: string;
  damId: string;
  hatchWeek: number; // legacy; hatching is now driven by hatchAt
  hatchAt: string; // ISO timestamp the young arrive (real time)
  createdAtWeek: number;
}

/** One pigeon's result within a flight. */
export interface FlightResult {
  pigeonId: string;
  pigeonName: string;
  ownerId: string;
  ownerName: string;
  velocity: number; // metres per minute
  timeSeconds: number;
  rank: number;
  points: number;
  prize: number;
}

export interface FlightEntry {
  pigeonId: string;
  ownerId: string;
}

/** A single pigeon's frozen performance, computed when a flight goes live. */
export interface SimEntry {
  pigeonId: string;
  pigeonName: string;
  ownerId: string;
  ownerName: string;
  velocity: number; // metres per minute (realistic homing speed)
  durationSeconds: number; // compressed live race duration for this bird
}

/**
 * A flight, tied to a real start time and a route (release point -> home).
 *  - `scheduled`: open for entries, waiting for its start time.
 *  - `live`: started; positions derive from the frozen `sim` + elapsed time.
 *  - `completed`: everyone home; `results` is final.
 */
export interface Flight {
  id: string;
  week: number;
  templateKey: string;
  name: string;
  type: 'regional' | 'national' | 'international';
  distanceKm: number;
  entryFee: number;
  fromCity: string; // release point
  toCity: string; // home base
  startAt: string; // ISO timestamp the flight is released
  status: 'scheduled' | 'live' | 'completed';
  entries: FlightEntry[];
  sim: SimEntry[]; // frozen when the flight goes live
  weather: string;
  weatherFactor: number;
  results: FlightResult[]; // empty until completed
  recap: string; // sports-reporter summary, written at finish
  createdAt: string;
}

/** A completed market sale, kept as buy/sell history. */
export interface Trade {
  id: string;
  pigeonId: string;
  pigeonName: string;
  sellerId: string;
  sellerName: string;
  buyerId: string;
  buyerName: string;
  price: number;
  at: string; // ISO timestamp
}

/** An in-app notification shown in the bell inbox. */
export interface Notification {
  id: string;
  userId: string;
  kind: 'result' | 'improve' | 'info' | 'health' | 'badge';
  title: string;
  body: string;
  flightId: string | null;
  createdAt: string;
  read: boolean;
}

/** Global world state. */
export interface World {
  currentWeek: number;
  seasonYear: number;
  seeded: boolean;
  /** One-time data migrations applied (funny names, purge old flights, ...). */
  dataVersion: number;
  /** ISO timestamp of the last daily food/care tick (real time). */
  lastDailyTick: string;
}

/** The full database document persisted to disk. */
export interface Database {
  world: World;
  users: User[];
  lofts: Loft[];
  pigeons: Pigeon[];
  breedingPairs: BreedingPair[];
  flights: Flight[];
  notifications: Notification[];
  trades: Trade[];
}

export function emptyStats(): PlayerStats {
  return {
    regionalWins: 0, nationalWins: 0, intlWins: 0,
    gold: 0, silver: 0, bronze: 0,
    entries: 0, babies: 0, buys: 0, sells: 0,
    cures: 0, curesSevere: 0, staffHired: 0,
  };
}

export function emptyDatabase(): Database {
  return {
    world: { currentWeek: 1, seasonYear: 1, seeded: false, dataVersion: 0, lastDailyTick: '' },
    users: [],
    lofts: [],
    pigeons: [],
    breedingPairs: [],
    flights: [],
    notifications: [],
    trades: [],
  };
}
