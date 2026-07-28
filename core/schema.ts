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
  libido: number; // drive to breed: higher = more (and more likely) young
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
  type: 'club' | 'national';
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
  kind: 'result' | 'improve' | 'info';
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

export function emptyDatabase(): Database {
  return {
    world: { currentWeek: 1, seasonYear: 1, seeded: false, dataVersion: 0 },
    users: [],
    lofts: [],
    pigeons: [],
    breedingPairs: [],
    flights: [],
    notifications: [],
    trades: [],
  };
}
