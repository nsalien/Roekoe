/**
 * Entity types persisted by the data layer. These describe the shape of the
 * JSON database. Keeping them in one place makes it easy to see the whole data
 * model and to evolve it (add fields, add entities) as the game grows.
 */

import type { FeedRationKey } from './config/gameConfig.js';

export type Sex = 'doffer' | 'duivin'; // male / female

/** Core, mostly-genetic attributes plus the dynamic condition of a pigeon. */
export interface Pigeon {
  id: string;
  ownerId: string; // user id of the owner
  name: string;
  sex: Sex;
  birthWeek: number; // world week the pigeon was born
  // Genetic attributes (0-100). Improve slowly through training / breeding.
  speed: number;
  endurance: number;
  orientation: number;
  // Dynamic condition (0-100). Fluctuates week to week with care and racing.
  form: number;
  health: number;
  experience: number; // grows by racing; small performance bonus
  // Pedigree, for breeding UI and inheritance display.
  sireId: string | null;
  damId: string | null;
  // Market: if listed for sale, price is set. ownerId may be the NPC market.
  forSale: boolean;
  price: number | null;
  createdAtWeek: number;
  retired: boolean;
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
  hatchWeek: number; // world week the young arrive
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

/**
 * A flight. When first generated it is `scheduled` and open for entries; once
 * the host advances the week it is simulated and becomes `completed` with a
 * full result table.
 */
export interface Flight {
  id: string;
  week: number;
  templateKey: string;
  name: string;
  type: 'club' | 'national';
  distanceKm: number;
  entryFee: number;
  status: 'scheduled' | 'completed';
  entries: FlightEntry[];
  weather: string; // set on completion
  weatherFactor: number;
  results: FlightResult[]; // empty until completed
  createdAt: string;
}

/** Global world state. */
export interface World {
  currentWeek: number;
  seasonYear: number;
  seeded: boolean;
}

/** The full database document persisted to disk. */
export interface Database {
  world: World;
  users: User[];
  lofts: Loft[];
  pigeons: Pigeon[];
  breedingPairs: BreedingPair[];
  flights: Flight[];
}

export function emptyDatabase(): Database {
  return {
    world: { currentWeek: 1, seasonYear: 1, seeded: false },
    users: [],
    lofts: [],
    pigeons: [],
    breedingPairs: [],
    flights: [],
  };
}
