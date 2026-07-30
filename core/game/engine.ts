/**
 * The game engine: world seeding, per-player setup and the weekly tick that
 * runs flights, feeds pigeons, hatches young and refreshes the market.
 *
 * All mutation of the world funnels through here so the rules stay in one
 * place. Routes call these functions; they never touch game maths directly.
 */

import {
  BOT_LOFT_CAPACITY,
  BOT_LOFT_NAMES,
  BREEDING,
  COACH,
  DEFAULT_BOT_COUNT,
  FEED_RATIONS,
  FOOD_PRICE_PER_KG,
  INFIRMARY,
  INFIRMARY_CAPACITY_TIERS,
  LOFT_CAPACITY_TIERS,
  RENAME_COST,
  RENAME_LOFT_COST,
  STARTING_FOOD_STOCK,
  STARTING_LOFT_CAPACITY,
  STARTING_MONEY,
  STARTING_PIGEONS,
  TRAINING,
  WEEKS_PER_YEAR,
  compartmentCost,
  type FeedRationKey,
} from '../config/gameConfig.js';
import type { Database, Loft, User } from '../schema.js';
import { emptySponsorState, emptyStats } from '../schema.js';
import { newId, type Store } from '../store.js';
import { awardBadge, evaluateBadges } from './badges.js';
import { botTakeWeeklyActions } from './bots.js';
import { chargeWeeklyUpkeep } from './economy.js';
import { progressMissions } from './missions.js';
import { resolveEvent as resolveEventCard } from './events.js';
import { activeContracts, applyAcceptSponsor, applyCancelSponsor, applyRefuseSponsor } from './sponsors.js';
import { runHealthWeek } from './health.js';
import { canRace, generatePigeon } from './pigeon.js';
import { clamp, randFloat, round1 } from './util.js';

export const NPC_OWNER_ID = 'npc_market';

export function ownerName(db: Database, ownerId: string): string {
  if (ownerId === NPC_OWNER_ID) return 'Duivenmarkt';
  if (ownerId === 'auction_house') return 'Veilinghuis';
  if (ownerId === 'shelter_center') return 'Opvangcentrum';
  const loft = db.lofts.find((l) => l.userId === ownerId);
  return loft?.name ?? 'Onbekend';
}

/** Push an in-app notification (bell inbox). */
function notify(
  db: Database,
  userId: string,
  kind: 'result' | 'improve' | 'info' | 'health',
  title: string,
  body: string,
  flightId: string | null = null,
): void {
  db.notifications.push({
    id: newId('ntf'), userId, kind, title, body, flightId,
    createdAt: new Date().toISOString(), read: false,
  });
  // Keep each user's inbox bounded (newest kept).
  const mine = db.notifications.filter((n) => n.userId === userId);
  if (mine.length > 40) {
    const drop = new Set(mine.slice(0, mine.length - 40).map((n) => n.id));
    db.notifications = db.notifications.filter((n) => !drop.has(n.id));
  }
}

/** Create a starting loft + pigeons for a freshly registered user. */
export function createLoftForUser(store: Store, user: User, loftName: string): Loft {
  return store.mutate((db) => {
    const loft: Loft = {
      userId: user.id,
      name: loftName,
      money: STARTING_MONEY,
      food: { ...STARTING_FOOD_STOCK },
      feedRation: 'normal',
      capacity: STARTING_LOFT_CAPACITY,
      compartments: 0,
      seasonPoints: 0,
      totalWins: 0,
      isBot: user.isBot,
      infirmaryCapacity: INFIRMARY.baseCapacity,
      medicatedFood: false,
      doctors: 0,
      physios: 0,
      xp: 0,
      level: 1,
      stats: emptyStats(),
      badges: [],
      missions: [],
      missionsDay: '',
      streak: 0,
      pendingEvent: null,
      sponsorship: emptySponsorState(),
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

/** Seed bots and their pigeons. Runs once. */
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
        food: { ...STARTING_FOOD_STOCK },
        feedRation: 'normal',
        capacity: BOT_LOFT_CAPACITY,
        compartments: 0,
        seasonPoints: 0,
        totalWins: 0,
        isBot: true,
        infirmaryCapacity: INFIRMARY.baseCapacity,
        medicatedFood: false,
        doctors: 0,
        physios: 0,
        xp: 0,
        level: 1,
        stats: emptyStats(),
        badges: [],
        missions: [],
        missionsDay: '',
        streak: 0,
        pendingEvent: null,
        sponsorship: emptySponsorState(),
      };
      db.lofts.push(loft);
      const count = STARTING_PIGEONS + Math.floor(Math.random() * 4);
      for (let j = 0; j < count; j++) {
        db.pigeons.push(
          generatePigeon({ ownerId: botUser.id, currentWeek: week, quality: randFloat(0.4, 0.75) }),
        );
      }
    }
    db.world.seeded = true;
    db.world.dataVersion = 13; // fresh world: gendered names, libido, tiered flights, badges
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

    // 2. Weekly maintenance charge (food + condition recovery run daily, in
    //    real time — see tickDailyCare).
    for (const loft of db.lofts) {
      const activeCount = db.pigeons.filter((p) => p.ownerId === loft.userId).length;
      chargeWeeklyUpkeep(loft, activeCount);
    }

    // 2c. Sponsors pay their weekly stipend to the lofts they back.
    for (const loft of db.lofts) {
      const contracts = activeContracts(loft);
      if (contracts.length === 0) continue;
      const total = contracts.reduce((s, c) => s + c.contract.weeklyStipend, 0);
      loft.money += total;
      if (!loft.isBot) {
        const who = contracts.length === 1 ? contracts[0].def.name : `${contracts.length} sponsors`;
        notify(db, loft.userId, 'info', '🤝 Sponsorbijdrage',
          `${who} stortten samen €${total} weekbijdrage.`);
      }
    }

    // 2d. Private coaches draw a weekly salary per coached pigeon.
    for (const loft of db.lofts) {
      const coached = db.pigeons.filter((p) => p.ownerId === loft.userId && p.coached).length;
      if (coached > 0) loft.money -= coached * COACH.weeklySalary;
    }

    // 2b. Health: disease onset/spread, recovery, and mortality. Notify humans.
    const humanIds = new Set(db.lofts.filter((l) => !l.isBot).map((l) => l.userId));
    for (const ev of runHealthWeek(db, week)) {
      if (humanIds.has(ev.ownerId)) {
        notify(db, ev.ownerId, 'health', ev.title, ev.body);
      }
    }
    // (Breeding hatches in real time now — see tickBreedingHatch.)

    // Advance the calendar and prepare the new week.
    db.world.currentWeek += 1;
    const newWeek = db.world.currentWeek;
    if (newWeek % WEEKS_PER_YEAR === 1) {
      // Season rollover: crown the champion, then reset season points.
      db.world.seasonYear += 1;
      const champion = [...db.lofts].sort(
        (a, b) => b.seasonPoints - a.seasonPoints || b.totalWins - a.totalWins,
      )[0];
      if (champion && champion.seasonPoints > 0) awardBadge(db, champion, 'season_champion');
      for (const loft of db.lofts) loft.seasonPoints = 0;
      summary.seasonRolledOver = true;
    }

    return summary;
  });
}

/** Rename a player's loft for a fee. Returns an error string or null. */
export function renameLoft(store: Store, userId: string, name: string): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Geen hok gevonden';
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 32) return 'Naam moet tussen 2 en 32 tekens zijn';
    if (trimmed === loft.name) return 'Dat is al de naam van je hok';
    if (loft.money < RENAME_LOFT_COST) return `Niet genoeg geld (hok hernoemen kost €${RENAME_LOFT_COST})`;
    loft.money -= RENAME_LOFT_COST;
    loft.name = trimmed;
    return null;
  });
}

/** Cancel a breeding pair so the parents can race again (no refund). */
export function stopBreeding(store: Store, userId: string, pairId: string): string | null {
  return store.mutate((db) => {
    const idx = db.breedingPairs.findIndex((bp) => bp.id === pairId && bp.ownerId === userId);
    if (idx === -1) return 'Koppel niet gevonden';
    db.breedingPairs.splice(idx, 1);
    return null;
  });
}

/** The next loft-capacity upgrade tier a loft can buy, or null if maxed. */
export function nextCapacityTier(capacity: number): { capacity: number; price: number } | null {
  return LOFT_CAPACITY_TIERS.find((t) => t.capacity > capacity) ?? null;
}

/** Buy the next loft-capacity upgrade. Returns an error string or null. */
export function upgradeCapacity(store: Store, userId: string): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Geen hok gevonden';
    const tier = nextCapacityTier(loft.capacity);
    if (!tier) return 'Je hok heeft al de maximale capaciteit';
    if (loft.money < tier.price) return 'Niet genoeg geld voor deze uitbreiding';
    loft.money -= tier.price;
    loft.capacity = tier.capacity;
    return null;
  });
}

/** Buy one more private compartment (capped at loft capacity). */
export function buyCompartment(store: Store, userId: string): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Geen hok gevonden';
    if ((loft.compartments ?? 0) >= loft.capacity) return 'Je hebt al voor elke plaats een apart hok';
    const cost = compartmentCost(loft.compartments ?? 0);
    if (loft.money < cost) return 'Niet genoeg geld voor een apart hok';
    loft.money -= cost;
    loft.compartments = (loft.compartments ?? 0) + 1;
    return null;
  });
}

/** The next infirmary-bed upgrade tier, or null if maxed. */
export function nextInfirmaryTier(capacity: number): { capacity: number; price: number } | null {
  return INFIRMARY_CAPACITY_TIERS.find((t) => t.capacity > capacity) ?? null;
}

/** Buy the next infirmary-capacity upgrade. Returns an error string or null. */
export function upgradeInfirmary(store: Store, userId: string): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Geen hok gevonden';
    const tier = nextInfirmaryTier(loft.infirmaryCapacity);
    if (!tier) return 'De ziekenboeg is al maximaal uitgebreid';
    if (loft.money < tier.price) return 'Niet genoeg geld voor deze uitbreiding';
    loft.money -= tier.price;
    loft.infirmaryCapacity = tier.capacity;
    return null;
  });
}

/** Hire or dismiss a private coach for one pigeon. Returns error string or null. */
export function setCoach(store: Store, userId: string, pigeonId: string, on: boolean): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    const pigeon = db.pigeons.find((p) => p.id === pigeonId && p.ownerId === userId);
    if (!loft || !pigeon) return 'Duif niet gevonden';
    if (!on) {
      pigeon.coached = false;
      return null;
    }
    if (pigeon.coached) return 'Deze duif heeft al een coach';
    if (loft.money < COACH.hireCost) return `Niet genoeg geld (een coach kost €${COACH.hireCost})`;
    loft.money -= COACH.hireCost;
    pigeon.coached = true;
    return null;
  });
}

/** Rename one of your pigeons for a fee. Returns an error string or null. */
export function renamePigeon(store: Store, userId: string, pigeonId: string, name: string): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    const pigeon = db.pigeons.find((p) => p.id === pigeonId && p.ownerId === userId);
    if (!loft || !pigeon) return 'Duif niet gevonden';
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 28) return 'Naam moet tussen 2 en 28 tekens zijn';
    if (loft.money < RENAME_COST) return `Niet genoeg geld (hernoemen kost €${RENAME_COST})`;
    loft.money -= RENAME_COST;
    pigeon.name = trimmed;
    return null;
  });
}

/** Set one pigeon's own feed schedule. Returns an error string or null. */
export function setPigeonRation(store: Store, userId: string, pigeonId: string, ration: string): string | null {
  return store.mutate((db) => {
    const pigeon = db.pigeons.find((p) => p.id === pigeonId && p.ownerId === userId);
    if (!pigeon) return 'Duif niet gevonden';
    if (!(ration in FEED_RATIONS)) return 'Ongeldig voerschema';
    pigeon.ration = ration as FeedRationKey;
    return null;
  });
}

/** Put a pigeon in (or out of) a private compartment. Returns error or null. */
export function setPigeonCompartment(store: Store, userId: string, pigeonId: string, on: boolean): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    const pigeon = db.pigeons.find((p) => p.id === pigeonId && p.ownerId === userId);
    if (!loft || !pigeon) return 'Duif niet gevonden';
    if (!on) {
      pigeon.compartment = false;
      return null;
    }
    if (pigeon.compartment) return null;
    const used = db.pigeons.filter((p) => p.ownerId === userId && p.compartment).length;
    if (used >= (loft.compartments ?? 0)) return 'Geen vrij apart hok — bouw er eerst een bij';
    pigeon.compartment = true;
    return null;
  });
}

/** Buy food of a given type for a loft. Returns an error string or null. */
export function buyFood(store: Store, userId: string, type: string, kg: number): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Geen hok gevonden';
    if (!(type in FEED_RATIONS)) return 'Ongeldig voedingstype';
    if (kg <= 0) return 'Ongeldige hoeveelheid';
    const key = type as FeedRationKey;
    const cost = Math.round(kg * FEED_RATIONS[key].pricePerKg);
    if (loft.money < cost) return 'Niet genoeg geld';
    loft.money -= cost;
    loft.food[key] = round1((loft.food[key] ?? 0) + kg);
    progressMissions(db, loft, 'buyfood', 1);
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
    if (!canRace(pigeon, db.world.currentWeek))
      return 'Deze duif is niet vluchtklaar (te jong, ziek, gewond of in de ziekenboeg)';
    if (pigeon.form < 1) return 'Deze duif is volledig uitgeput — laat ze eerst wat rusten';
    const breeding = db.breedingPairs.some((bp) => bp.sireId === pigeonId || bp.damId === pigeonId);
    if (breeding) return 'Deze duif koppelt — stop eerst het broeden voordat ze weer kan vliegen';
    if (loft.money < 0) return 'Je kassa staat negatief — verkoop eerst een duif voor je inschrijft';
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
    loft.stats.entries += 1;
    progressMissions(db, loft, 'enter', 1);
    evaluateBadges(db, loft);
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
    const price = pigeon.price;
    const sellerId = pigeon.ownerId;
    buyer.money -= price;
    // Pay the seller.
    const seller = db.lofts.find((l) => l.userId === sellerId);
    if (seller) seller.money += price;
    pigeon.ownerId = userId;
    pigeon.forSale = false;
    pigeon.price = null;
    // Record the sale as buy/sell history.
    db.trades.push({
      id: newId('trd'),
      pigeonId: pigeon.id,
      pigeonName: pigeon.name,
      sellerId,
      sellerName: ownerName(db, sellerId),
      buyerId: userId,
      buyerName: buyer.name,
      price,
      at: new Date().toISOString(),
    });
    // Keep history bounded.
    if (db.trades.length > 200) db.trades = db.trades.slice(-200);
    // Badges for buyer + seller.
    buyer.stats.buys += 1;
    progressMissions(db, buyer, 'market', 1);
    evaluateBadges(db, buyer);
    if (seller) {
      seller.stats.sells += 1;
      if (price > 1000) awardBadge(db, seller, 'handelaar');
      progressMissions(db, seller, 'market', 1);
      evaluateBadges(db, seller);
    }
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
    if (pigeon.ailment || pigeon.inInfirmary) return 'Een zieke, gekwetste of herstellende duif kan niet trainen';
    const racing = db.flights.some(
      (f) => f.status !== 'completed' && f.entries.some((e) => e.pigeonId === pigeonId),
    );
    if (racing) return 'Deze duif is ingeschreven voor een vlucht — trainen kan pas als ze weer thuis is';
    if (loft.money < TRAINING.cost) return 'Niet genoeg geld om te trainen';
    if (pigeon.form < TRAINING.formCost + 5) return 'Deze duif heeft te weinig energie om te trainen';
    if (pigeon[attr] >= TRAINING.attributeCap)
      return `Deze eigenschap kan niet verder getraind worden (max ${TRAINING.attributeCap})`;
    loft.money -= TRAINING.cost;
    const gain = TRAINING.attributeGain * randFloat(0.7, 1.3);
    pigeon[attr] = round1(clamp(pigeon[attr] + gain, 0, TRAINING.attributeCap));
    pigeon.form = round1(clamp(pigeon.form - TRAINING.formCost, 0, 100));
    pigeon.experience = round1(clamp(pigeon.experience + TRAINING.experienceGain, 0, 100));
    progressMissions(db, loft, 'train', 1);
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
      return `Beide ouders hebben minstens ${BREEDING.minParentForm} energie nodig`;
    if (sire.ailment || dam.ailment) return 'Een zieke of gekwetste duif kan niet koppelen';
    if (sire.inInfirmary || dam.inInfirmary) return 'Een duif in de ziekenboeg kan niet koppelen';
    const alreadyBreeding = db.breedingPairs.some(
      (bp) => bp.sireId === sireId || bp.damId === sireId || bp.sireId === damId || bp.damId === damId,
    );
    if (alreadyBreeding) return 'Een van deze duiven koppelt al';
    const racing = db.flights.some(
      (f) => f.status !== 'completed' && f.entries.some((e) => e.pigeonId === sireId || e.pigeonId === damId),
    );
    if (racing) return 'Een ingeschreven duif kan niet koppelen — schrijf ze eerst uit voor een vlucht';
    if (loft.money < BREEDING.cost) return 'Niet genoeg geld om te koppelen';
    loft.money -= BREEDING.cost;
    // Breeding costs the parents some energie.
    sire.form = round1(clamp(sire.form - 15, 0, 100));
    dam.form = round1(clamp(dam.form - 15, 0, 100));
    db.breedingPairs.push({
      id: newId('brd'),
      ownerId: userId,
      sireId,
      damId,
      // `hatchAt` is the "last checked" time for the random hatch roll.
      hatchAt: new Date().toISOString(),
      createdAtWeek: db.world.currentWeek,
    });
    return null;
  });
}

/** Move one of your pigeons into or out of the infirmary. */
export function setInfirmary(
  store: Store,
  userId: string,
  pigeonId: string,
  wantIn: boolean,
): string | null {
  return store.mutate((db) => {
    const pigeon = db.pigeons.find((p) => p.id === pigeonId && p.ownerId === userId);
    if (!pigeon) return 'Duif niet gevonden';
    if (!wantIn) {
      pigeon.inInfirmary = false;
      return null;
    }
    if (pigeon.inInfirmary) return null;
    const loft = db.lofts.find((l) => l.userId === userId);
    const inCount = db.pigeons.filter((p) => p.ownerId === userId && p.inInfirmary).length;
    if (loft && inCount >= loft.infirmaryCapacity)
      return `De ziekenboeg zit vol (max ${loft.infirmaryCapacity} duiven)`;
    const racing = db.flights.some(
      (f) => f.status !== 'completed' && f.entries.some((e) => e.pigeonId === pigeonId),
    );
    if (racing) return 'Deze duif staat ingeschreven voor een vlucht';
    pigeon.inInfirmary = true;
    progressMissions(db, loft ?? undefined, 'care', 1);
    return null;
  });
}

/** Resolve the player's pending dilemma with a chosen option. */
export function chooseEvent(store: Store, userId: string, choice: number): string {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return '!Geen hok gevonden';
    return resolveEventCard(db, loft, choice, db.world.currentWeek);
  });
}

/** Accept a sponsor's offer. `replace` confirms dropping a same-category rival. */
export function acceptSponsor(store: Store, userId: string, sponsorId: string, replace: boolean): string {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return '!Geen hok gevonden';
    const result = applyAcceptSponsor(db, loft, sponsorId, replace);
    if (!result.startsWith('!')) evaluateBadges(db, loft);
    return result;
  });
}

/** Refuse a pending sponsor offer. Returns a message or '!error'. */
export function refuseSponsor(store: Store, userId: string, sponsorId: string): string {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return '!Geen hok gevonden';
    return applyRefuseSponsor(db, loft, sponsorId);
  });
}

/** Terminate an active sponsor contract (charges its break penalty). */
export function cancelSponsor(store: Store, userId: string, sponsorId: string): string {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return '!Geen hok gevonden';
    return applyCancelSponsor(db, loft, sponsorId);
  });
}

/** Turn medicated feed for the infirmary on or off. */
export function setMedicatedFood(store: Store, userId: string, on: boolean): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Geen hok gevonden';
    loft.medicatedFood = !!on;
    return null;
  });
}

/** Set how many pigeon doctors / physiotherapists are on the payroll. */
export function setInfirmaryStaff(
  store: Store,
  userId: string,
  doctors: number,
  physios: number,
): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Geen hok gevonden';
    loft.doctors = Math.round(clamp(doctors, 0, 20));
    loft.physios = Math.round(clamp(physios, 0, 20));
    if (loft.doctors > 0 || loft.physios > 0) {
      loft.stats.staffHired = Math.max(loft.stats.staffHired, 1);
      evaluateBadges(db, loft);
    }
    return null;
  });
}
