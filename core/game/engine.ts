/**
 * The game engine: world seeding, per-player setup and the weekly tick that
 * runs flights, feeds pigeons, hatches young and refreshes the market.
 *
 * All mutation of the world funnels through here so the rules stay in one
 * place. Routes call these functions; they never touch game maths directly.
 */

import {
  BOT_LOFT_NAMES,
  BREEDING,
  DEFAULT_BOT_COUNT,
  FOOD_PRICE_PER_KG,
  NPC_MARKET_LISTINGS_PER_WEEK,
  STARTING_FOOD,
  STARTING_LOFT_CAPACITY,
  STARTING_MONEY,
  STARTING_PIGEONS,
  TRAINING,
  WEEKS_PER_YEAR,
} from '../config/gameConfig.js';
import type { Database, Loft, User } from '../schema.js';
import { newId, type Store } from '../store.js';
import { botTakeWeeklyActions } from './bots.js';
import { breed } from './breeding.js';
import { applyWeeklyCare } from './economy.js';
import { estimateValue, generatePigeon } from './pigeon.js';
import { clamp, randFloat, round1 } from './util.js';

export const NPC_OWNER_ID = 'npc_market';

export function ownerName(db: Database, ownerId: string): string {
  if (ownerId === NPC_OWNER_ID) return 'Duivenmarkt';
  const loft = db.lofts.find((l) => l.userId === ownerId);
  return loft?.name ?? 'Onbekend';
}

/** Create a starting loft + pigeons for a freshly registered user. */
export function createLoftForUser(store: Store, user: User, loftName: string): Loft {
  return store.mutate((db) => {
    const loft: Loft = {
      userId: user.id,
      name: loftName,
      money: STARTING_MONEY,
      food: STARTING_FOOD,
      feedRation: 'normal',
      capacity: STARTING_LOFT_CAPACITY,
      seasonPoints: 0,
      totalWins: 0,
      isBot: user.isBot,
    };
    db.lofts.push(loft);
    for (let i = 0; i < STARTING_PIGEONS; i++) {
      db.pigeons.push(
        generatePigeon({ ownerId: user.id, currentWeek: db.world.currentWeek, quality: randFloat(0.4, 0.6) }),
      );
    }
    return loft;
  });
}

/** Refresh the NPC market with fresh pigeons for the given week. */
export function refreshNpcMarket(db: Database, week: number): void {
  // Remove last week's unsold NPC birds so the market doesn't pile up.
  db.pigeons = db.pigeons.filter((p) => !(p.ownerId === NPC_OWNER_ID));
  for (let i = 0; i < NPC_MARKET_LISTINGS_PER_WEEK; i++) {
    const p = generatePigeon({ ownerId: NPC_OWNER_ID, currentWeek: week, quality: randFloat(0.35, 0.85) });
    p.forSale = true;
    p.price = estimateValue(p, week);
    db.pigeons.push(p);
  }
}

/** Seed bots, the first week's flights and the market. Runs once. */
export function seedWorld(store: Store): void {
  store.mutate((db) => {
    if (db.world.seeded) return;
    const week = db.world.currentWeek;
    for (let i = 0; i < DEFAULT_BOT_COUNT; i++) {
      const botUser: User = {
        id: newId('bot'),
        username: `bot_${i + 1}`,
        passwordHash: '!', // bots cannot log in
        isAdmin: false,
        isBot: true,
        createdAt: new Date().toISOString(),
      };
      db.users.push(botUser);
      const loft: Loft = {
        userId: botUser.id,
        name: BOT_LOFT_NAMES[i % BOT_LOFT_NAMES.length],
        money: STARTING_MONEY,
        food: STARTING_FOOD,
        feedRation: 'normal',
        capacity: STARTING_LOFT_CAPACITY,
        seasonPoints: 0,
        totalWins: 0,
        isBot: true,
      };
      db.lofts.push(loft);
      const count = STARTING_PIGEONS + Math.floor(Math.random() * 4);
      for (let j = 0; j < count; j++) {
        db.pigeons.push(
          generatePigeon({ ownerId: botUser.id, currentWeek: week, quality: randFloat(0.4, 0.75) }),
        );
      }
    }
    refreshNpcMarket(db, week);
    db.world.seeded = true;
    db.world.dataVersion = 1; // freshly-seeded birds already have funny names
  });
}

export interface WeekSummary {
  week: number;
  hatched: number;
  seasonRolledOver: boolean;
}

/**
 * Advance the world by one week (the economy tick). Flights run on real time on
 * their own; this feeds pigeons, hatches young, refreshes the market and rolls
 * the calendar/season. Bots do their weekly housekeeping (food, training).
 */
export function advanceWeek(store: Store): WeekSummary {
  return store.mutate((db) => {
    const week = db.world.currentWeek;
    const summary: WeekSummary = { week, hatched: 0, seasonRolledOver: false };

    // 1. Bots do their weekly housekeeping (feed/train). They enter flights in
    //    real time (see schedule.ts), not here.
    for (const loft of db.lofts.filter((l) => l.isBot)) {
      const owned = db.pigeons.filter((p) => p.ownerId === loft.userId);
      botTakeWeeklyActions(loft, owned, FOOD_PRICE_PER_KG);
    }

    // 2. Weekly care + upkeep for every loft.
    for (const loft of db.lofts) {
      const owned = db.pigeons.filter((p) => p.ownerId === loft.userId);
      applyWeeklyCare(loft, owned);
    }

    // 3. Hatch breeding pairs due this week.
    const due = db.breedingPairs.filter((bp) => bp.hatchWeek <= week);
    for (const bp of due) {
      const sire = db.pigeons.find((p) => p.id === bp.sireId);
      const dam = db.pigeons.find((p) => p.id === bp.damId);
      if (sire && dam) {
        const young = breed(sire, dam, bp.ownerId, week);
        const loft = db.lofts.find((l) => l.userId === bp.ownerId);
        const owned = db.pigeons.filter((p) => p.ownerId === bp.ownerId).length;
        const space = (loft?.capacity ?? 0) - owned;
        const admitted = young.slice(0, Math.max(0, space));
        db.pigeons.push(...admitted);
        summary.hatched += admitted.length;
      }
    }
    db.breedingPairs = db.breedingPairs.filter((bp) => bp.hatchWeek > week);

    // Advance the calendar and prepare the new week.
    db.world.currentWeek += 1;
    const newWeek = db.world.currentWeek;
    if (newWeek % WEEKS_PER_YEAR === 1) {
      // Season rollover: reset season points, keep money/pigeons.
      db.world.seasonYear += 1;
      for (const loft of db.lofts) loft.seasonPoints = 0;
      summary.seasonRolledOver = true;
    }
    refreshNpcMarket(db, newWeek);

    return summary;
  });
}

/** Buy food for a loft. Returns an error string or null on success. */
export function buyFood(store: Store, userId: string, kg: number): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Geen hok gevonden';
    if (kg <= 0) return 'Ongeldige hoeveelheid';
    const cost = Math.round(kg * FOOD_PRICE_PER_KG);
    if (loft.money < cost) return 'Niet genoeg geld';
    loft.money -= cost;
    loft.food = round1(loft.food + kg);
    return null;
  });
}

/** Enter a pigeon into a scheduled flight. Returns error string or null. */
export function enterFlight(
  store: Store,
  userId: string,
  flightId: string,
  pigeonId: string,
): string | null {
  return store.mutate((db) => {
    const flight = db.flights.find((f) => f.id === flightId);
    if (!flight || flight.status !== 'scheduled') return 'Deze vlucht is niet (meer) open voor inschrijving';
    const loft = db.lofts.find((l) => l.userId === userId);
    const pigeon = db.pigeons.find((p) => p.id === pigeonId);
    if (!loft || !pigeon || pigeon.ownerId !== userId) return 'Duif niet gevonden';
    if (flight.entries.some((e) => e.pigeonId === pigeonId)) return 'Duif is al ingeschreven';
    // A pigeon may race at most once per day.
    const day = flight.startAt.slice(0, 10);
    const racingElsewhere = db.flights.some(
      (f) =>
        f.id !== flight.id &&
        f.status !== 'completed' &&
        f.startAt.slice(0, 10) === day &&
        f.entries.some((e) => e.pigeonId === pigeonId),
    );
    if (racingElsewhere) return 'Deze duif vliegt die dag al een andere vlucht';
    if (loft.money < flight.entryFee) return 'Niet genoeg geld voor het inschrijfgeld';
    loft.money -= flight.entryFee;
    flight.entries.push({ pigeonId, ownerId: userId });
    return null;
  });
}

/** Remove a pigeon from a scheduled flight and refund the entry fee. */
export function withdrawFlight(
  store: Store,
  userId: string,
  flightId: string,
  pigeonId: string,
): string | null {
  return store.mutate((db) => {
    const flight = db.flights.find((f) => f.id === flightId);
    if (!flight || flight.status !== 'scheduled') return 'Vlucht niet beschikbaar';
    const idx = flight.entries.findIndex((e) => e.pigeonId === pigeonId && e.ownerId === userId);
    if (idx === -1) return 'Duif is niet ingeschreven';
    flight.entries.splice(idx, 1);
    const loft = db.lofts.find((l) => l.userId === userId);
    if (loft) loft.money += flight.entryFee;
    return null;
  });
}

/** List one of your pigeons on the market at a price. */
export function listForSale(store: Store, userId: string, pigeonId: string, price: number): string | null {
  return store.mutate((db) => {
    const pigeon = db.pigeons.find((p) => p.id === pigeonId && p.ownerId === userId);
    if (!pigeon) return 'Duif niet gevonden';
    if (price <= 0) return 'Ongeldige prijs';
    // A pigeon that is currently racing or breeding cannot be sold.
    const racing = db.flights.some(
      (f) => f.status !== 'completed' && f.entries.some((e) => e.pigeonId === pigeonId),
    );
    if (racing) return 'Deze duif staat ingeschreven voor een vlucht';
    const breeding = db.breedingPairs.some((bp) => bp.sireId === pigeonId || bp.damId === pigeonId);
    if (breeding) return 'Deze duif koppelt momenteel';
    pigeon.forSale = true;
    pigeon.price = Math.round(price);
    return null;
  });
}

/** Take one of your pigeons off the market. */
export function unlist(store: Store, userId: string, pigeonId: string): string | null {
  return store.mutate((db) => {
    const pigeon = db.pigeons.find((p) => p.id === pigeonId && p.ownerId === userId);
    if (!pigeon) return 'Duif niet gevonden';
    pigeon.forSale = false;
    pigeon.price = null;
    return null;
  });
}

/** Buy a pigeon that is listed for sale (by a player or the NPC market). */
export function buyPigeon(store: Store, userId: string, pigeonId: string): string | null {
  return store.mutate((db) => {
    const buyer = db.lofts.find((l) => l.userId === userId);
    const pigeon = db.pigeons.find((p) => p.id === pigeonId);
    if (!buyer || !pigeon) return 'Duif niet gevonden';
    if (!pigeon.forSale || pigeon.price == null) return 'Deze duif is niet te koop';
    if (pigeon.ownerId === userId) return 'Dit is al jouw duif';
    if (buyer.money < pigeon.price) return 'Niet genoeg geld';
    const owned = db.pigeons.filter((p) => p.ownerId === userId).length;
    if (owned >= buyer.capacity) return 'Je hok zit vol';
    buyer.money -= pigeon.price;
    // Pay the seller (unless it's the NPC market).
    const seller = db.lofts.find((l) => l.userId === pigeon.ownerId);
    if (seller) seller.money += pigeon.price;
    pigeon.ownerId = userId;
    pigeon.forSale = false;
    pigeon.price = null;
    return null;
  });
}

/** Train a pigeon: spend money + form for a small permanent attribute gain. */
export function trainPigeon(
  store: Store,
  userId: string,
  pigeonId: string,
  attr: 'speed' | 'endurance' | 'orientation',
): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    const pigeon = db.pigeons.find((p) => p.id === pigeonId && p.ownerId === userId);
    if (!loft || !pigeon) return 'Duif niet gevonden';
    if (loft.money < TRAINING.cost) return 'Niet genoeg geld om te trainen';
    if (pigeon.form < TRAINING.formCost + 5) return 'Deze duif heeft te weinig conditie om te trainen';
    if (pigeon[attr] >= TRAINING.attributeCap)
      return `Deze eigenschap kan niet verder getraind worden (max ${TRAINING.attributeCap})`;
    loft.money -= TRAINING.cost;
    const gain = TRAINING.attributeGain * randFloat(0.7, 1.3);
    pigeon[attr] = round1(clamp(pigeon[attr] + gain, 0, TRAINING.attributeCap));
    pigeon.form = round1(clamp(pigeon.form - TRAINING.formCost, 0, 100));
    pigeon.experience = round1(clamp(pigeon.experience + TRAINING.experienceGain, 0, 100));
    return null;
  });
}

/** Start a breeding pair. Returns error string or null. */
export function startBreeding(
  store: Store,
  userId: string,
  sireId: string,
  damId: string,
): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    const sire = db.pigeons.find((p) => p.id === sireId && p.ownerId === userId);
    const dam = db.pigeons.find((p) => p.id === damId && p.ownerId === userId);
    if (!loft || !sire || !dam) return 'Duif niet gevonden';
    if (sire.sex !== 'doffer') return 'De eerste ouder moet een doffer zijn';
    if (dam.sex !== 'duivin') return 'De tweede ouder moet een duivin zijn';
    if (sire.form < BREEDING.minParentForm || dam.form < BREEDING.minParentForm)
      return `Beide ouders hebben minstens ${BREEDING.minParentForm} conditie nodig`;
    const alreadyBreeding = db.breedingPairs.some(
      (bp) => bp.sireId === sireId || bp.damId === sireId || bp.sireId === damId || bp.damId === damId,
    );
    if (alreadyBreeding) return 'Een van deze duiven koppelt al';
    if (loft.money < BREEDING.cost) return 'Niet genoeg geld om te koppelen';
    loft.money -= BREEDING.cost;
    // Breeding costs the parents some condition.
    sire.form = round1(clamp(sire.form - 15, 0, 100));
    dam.form = round1(clamp(dam.form - 15, 0, 100));
    db.breedingPairs.push({
      id: newId('brd'),
      ownerId: userId,
      sireId,
      damId,
      hatchWeek: db.world.currentWeek + BREEDING.weeksToHatch,
      createdAtWeek: db.world.currentWeek,
    });
    return null;
  });
}
