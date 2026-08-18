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
  PIGEON_RESTAURANT,
  RELAY,
  REST_CURE,
  RENAME_COST,
  RENAME_LOFT_COST,
  STARTING_FOOD_STOCK,
  STARTING_LOFT_CAPACITY,
  STARTING_MONEY,
  STARTING_PIGEONS,
  TRAINING,
  compartmentCost,
  type FeedRationKey,
} from '../config/gameConfig.js';
import type { Database, Loft, Pigeon, User } from '../schema.js';
import { emptySponsorState, emptyStats } from '../schema.js';
import { newId, type Store } from '../store.js';
import { awardBadge, evaluateBadges } from './badges.js';
import { botTakeWeeklyActions } from './bots.js';
import { progressMissions } from './missions.js';
import { resolveEvent as resolveEventCard } from './events.js';
import { applyAcceptSponsor, applyCancelSponsor, applyRefuseSponsor } from './sponsors.js';
import { careSlots, runHealthWeek } from './health.js';
import { nameKey, namesInUse } from './names.js';
import { voidBetsForWithdrawnPigeon } from './betting.js';
import {
  canRace,
  experienceGain,
  generatePigeon,
  isAway,
  noteAttrChange,
  onRestCure,
  talent,
  trainCeil,
  trainingCost,
} from './pigeon.js';
import { clamp, randFloat, randInt, round1 } from './util.js';

export const NPC_OWNER_ID = 'npc_market';

/** A bird that lost its way on a flight is simply not in the loft yet. */
const AWAY_MSG = 'Deze duif is de weg kwijt na haar laatste vlucht — ze is nog niet thuis';

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
    // The set grows as we go, so the six starters can't collide with each other.
    const taken = namesInUse(db.pigeons);
    for (let i = 0; i < STARTING_PIGEONS; i++) {
      const p = generatePigeon({ ownerId: user.id, currentWeek: db.world.currentWeek, quality: randFloat(0.4, 0.6), taken });
      taken.add(nameKey(p.name));
      db.pigeons.push(p);
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
      // Bots start with the same headroom as players (max 8) and comparable
      // birds — no quality edge — so they don't dominate every flight.
      const count = STARTING_PIGEONS + Math.floor(Math.random() * 3); // 6..8
      const taken = namesInUse(db.pigeons);
      for (let j = 0; j < count; j++) {
        const p = generatePigeon({ ownerId: botUser.id, currentWeek: week, quality: randFloat(0.4, 0.6), taken });
        taken.add(nameKey(p.name));
        db.pigeons.push(p);
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

    // Recurring costs (upkeep, coach, infirmary staff) and sponsor stipends are
    // now charged/paid AUTOMATICALLY EACH DAY in schedule.tickDailyCare — not here.

    // Health: disease onset/spread, recovery, and mortality. Notify humans.
    const humanIds = new Set(db.lofts.filter((l) => !l.isBot).map((l) => l.userId));
    for (const ev of runHealthWeek(db, week)) {
      if (humanIds.has(ev.ownerId)) {
        notify(db, ev.ownerId, 'health', ev.title, ev.body);
      }
    }
    // (Breeding hatches in real time now — see tickBreedingHatch.)

    // Advance the game-week counter (drives ages/ailments/flight weeks). The
    // SEASON timeline + its rollover run in real time (see season.ts), not here.
    db.world.currentWeek += 1;

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
    // No upfront cost anymore — a coach is a purely daily recurring expense
    // (COACH.dailySalary), charged automatically in tickDailyCare.
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
    // A bird in the infirmary is already housed apart there; it can only take a
    // private compartment once it is back in the loft.
    if (pigeon.inInfirmary) return 'Een duif in de ziekenboeg heeft geen apart hok nodig — wijs er een toe als ze terug in het hok is';
    if (pigeon.compartment) return null;
    // Birds in the infirmary don't occupy a compartment slot, so don't count them.
    const used = db.pigeons.filter((p) => p.ownerId === userId && p.compartment && !p.inInfirmary).length;
    if (used >= (loft.compartments ?? 0)) return 'Geen vrij apart hok — bouw er eerst een bij';
    pigeon.compartment = true;
    progressMissions(db, loft, 'apart', 1);
    evaluateBadges(db, loft);
    return null;
  });
}

/**
 * Start a paid rest cure (rustkuur) for one pigeon. It rests for a day (can't
 * race during the cure) and then gets a big energie boost (see tickRestCures).
 * Returns an error string or null.
 */
export function startRestCure(store: Store, userId: string, pigeonId: string): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    const pigeon = db.pigeons.find((p) => p.id === pigeonId && p.ownerId === userId);
    if (!loft || !pigeon) return 'Duif niet gevonden';
    if (pigeon.cureUntil && Date.parse(pigeon.cureUntil) > Date.now())
      return 'Deze duif is al op rustkuur';
    if (isAway(pigeon)) return `${AWAY_MSG}`;
    if (pigeon.form >= 100 && pigeon.health >= 100) return 'Deze duif zit al vol energie en gezondheid';
    // EVERY bird may go on a cure (the old one-per-loft-per-week limit is gone), but
    // each bird only once a week — the cooldown runs per pigeon, from the start of
    // its previous cure. So a big loft can rest several birds at once, yet no single
    // bird can be topped up over and over.
    const now = Date.now();
    const lastCure = pigeon.lastRestCureAt ? Date.parse(pigeon.lastRestCureAt) : NaN;
    if (!Number.isNaN(lastCure) && now - lastCure < REST_CURE.cooldownDays * 86400000) {
      const nextDate = new Date(lastCure + REST_CURE.cooldownDays * 86400000).toLocaleDateString('nl-BE', {
        timeZone: 'Europe/Brussels', day: 'numeric', month: 'long',
      });
      return `${pigeon.name} had deze week al een rustkuur — de volgende kan vanaf ${nextDate}`;
    }
    const racing = db.flights.some(
      (f) => f.status !== 'completed' && f.entries.some((e) => e.pigeonId === pigeonId),
    );
    if (racing) return 'Deze duif is ingeschreven voor een vlucht — schrijf ze eerst uit';
    if (loft.money < REST_CURE.cost) return `Niet genoeg geld — een rustkuur kost €${REST_CURE.cost}`;
    loft.money -= REST_CURE.cost;
    loft.lastRestCure = new Date(now).toISOString(); // loft history only — the gate is per bird
    pigeon.lastRestCureAt = new Date(now).toISOString();
    pigeon.cureUntil = new Date(now + REST_CURE.durationHours * 3600000).toISOString();
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
    if (onRestCure(pigeon))
      return 'Deze duif is op rustkuur — ze kan pas weer vliegen als de kuur voorbij is';
    if (isAway(pigeon)) return `${AWAY_MSG} — schrijf haar in zodra ze terug is`;
    if (!canRace(pigeon, db.world.currentWeek))
      return 'Deze duif is niet vluchtklaar (te jong, ziek, gewond of in de ziekenboeg)';
    if (pigeon.form < 1) return 'Deze duif is volledig uitgeput — laat ze eerst wat rusten';
    const breeding = db.breedingPairs.some((bp) => bp.sireId === pigeonId || bp.damId === pigeonId);
    if (breeding) return 'Deze duif koppelt — stop eerst het broeden voordat ze weer kan vliegen';
    if (loft.money < 0) return 'Je kassa staat negatief — verkoop eerst een duif voor je inschrijft';
    if (flight.entries.some((e) => e.pigeonId === pigeonId)) return 'Duif is al ingeschreven';
    // The titanenwedstrijd allows only one bird per loft.
    if (flight.titan && flight.entries.some((e) => e.ownerId === userId))
      return 'In de titanenwedstrijd mag je maar één duif inschrijven';
    // An estafettevlucht is entered as ONE team of exactly RELAY.teamSize birds.
    // The entry fee is charged once, on the first bird of the team.
    const ownEntries = flight.entries.filter((e) => e.ownerId === userId);
    if (flight.relay && ownEntries.length >= RELAY.teamSize)
      return `Je ploeg is al volledig (${RELAY.teamSize} duiven) — haal er eerst een duif uit`;
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
    // A relay team pays one fee for the whole team, when its first bird is entered.
    const fee = flight.relay && ownEntries.length > 0 ? 0 : flight.entryFee;
    if (loft.money < fee) return 'Niet genoeg geld voor het inschrijfgeld';
    loft.money -= fee;
    flight.entries.push(
      flight.relay
        ? { pigeonId, ownerId: userId, leg: ownEntries.length + 1 }
        : { pigeonId, ownerId: userId },
    );
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
    const loft = db.lofts.find((l) => l.userId === userId);
    // Pulling one bird out of a relay team pulls the WHOLE team — you cannot fly
    // a leg short — and refunds the single team fee.
    if (flight.relay) {
      flight.entries = flight.entries.filter((e) => e.ownerId !== userId);
      if (loft) loft.money += flight.entryFee;
      voidBetsForWithdrawnPigeon(db, flight, pigeonId);
      return null;
    }
    flight.entries.splice(idx, 1);
    if (loft) loft.money += flight.entryFee;
    // Cancel and refund any open bets that depended on this bird (entries already
    // reflect the removal, so mine_wins is re-evaluated correctly).
    voidBetsForWithdrawnPigeon(db, flight, pigeonId);
    return null;
  });
}

/**
 * Set the running order of your estafette team: which of your three birds flies
 * leg 1, 2 and 3. Allowed right up to the start, so you can react to the weather
 * forecast per leg (see RelayLeg) — the legs are equal in length, so the running
 * order only matters because each leg has its own wind.
 */
export function setRelayOrder(store: Store, userId: string, flightId: string, pigeonIds: string[]): string | null {
  return store.mutate((db) => {
    const flight = db.flights.find((f) => f.id === flightId);
    if (!flight || !flight.relay) return 'Dit is geen estafettevlucht';
    if (flight.status !== 'scheduled') return 'De vlucht is al gestart — de volgorde ligt vast';
    const own = flight.entries.filter((e) => e.ownerId === userId);
    if (own.length === 0) return 'Je hebt geen ploeg in deze vlucht';
    const wanted = [...new Set(pigeonIds)];
    if (wanted.length !== own.length) return 'Geef precies je eigen ingeschreven duiven op';
    if (!wanted.every((id) => own.some((e) => e.pigeonId === id))) return 'Die duif zit niet in je ploeg';
    wanted.forEach((id, i) => {
      const entry = own.find((e) => e.pigeonId === id);
      if (entry) entry.leg = i + 1;
    });
    return null;
  });
}

/** Pull one of your pigeons out of a live race to save its energy. */
export function giveUpFlight(store: Store, userId: string, flightId: string, pigeonId: string): string | null {
  return store.mutate((db) => {
    const flight = db.flights.find((f) => f.id === flightId);
    if (!flight || flight.status !== 'live') return 'Deze vlucht is niet bezig';
    const entry = flight.sim.find((s) => s.pigeonId === pigeonId && s.ownerId === userId);
    if (!entry) return 'Duif niet gevonden in deze vlucht';
    if (entry.gaveUp) return 'Deze duif is al opgegeven';
    entry.gaveUp = true;
    // Freeze where it was when pulled, so the live board shows it stop there.
    // A relay bird runs on its OWN leg clock (it is released at the handover), so
    // store the elapsed time within its leg — every per-bird calculation compares
    // this against that bird's own duration.
    const startMs = flight.startAt ? Date.parse(flight.startAt) : NaN;
    if (!Number.isNaN(startMs)) {
      const raceSeconds = Math.max(0, (Date.now() - startMs) / 1000);
      entry.gaveUpAtSeconds = Math.max(0, raceSeconds - (entry.legStartSeconds ?? 0));
    }
    return null;
  });
}

/** List one of your pigeons on the market at a price. */
export function listForSale(store: Store, userId: string, pigeonId: string, price: number): string | null {
  return store.mutate((db) => {
    const pigeon = db.pigeons.find((p) => p.id === pigeonId && p.ownerId === userId);
    if (!pigeon) return 'Duif niet gevonden';
    if (price <= 0) return 'Ongeldige prijs';
    if (isAway(pigeon)) return `${AWAY_MSG} — je kan haar pas verkopen als ze terug is`;
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
      talent: talent(pigeon), // price observation for the market valuation
      buyerId: userId,
      buyerName: buyer.name,
      price,
      at: new Date().toISOString(),
    });
    // History is bounded by the store (core/d1.ts), not here: only a slice of the
    // trades table is in memory now, so trimming the array would delete rows we
    // simply never loaded.
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

/** Is this bird tied up in a race or a breeding pair (so it can't leave the loft)? */
function pigeonBusy(db: Database, pigeonId: string): string | null {
  const bird = db.pigeons.find((p) => p.id === pigeonId);
  if (bird && isAway(bird)) return `${AWAY_MSG} — wacht tot ze terug is`;
  const racing = db.flights.some(
    (f) => f.status !== 'completed' && f.entries.some((e) => e.pigeonId === pigeonId),
  );
  if (racing) return 'Deze duif staat ingeschreven voor een vlucht — schrijf ze eerst uit';
  const breeding = db.breedingPairs.some((bp) => bp.sireId === pigeonId || bp.damId === pigeonId);
  if (breeding) return 'Deze duif koppelt momenteel — stop eerst het broeden';
  return null;
}

/**
 * Remove a bird from the world and clean up everything that pointed at it:
 * pending offers (the bidders are told), breeding pairs and any not-yet-completed
 * flight entries (defensive — callers block racing/breeding birds first).
 */
function purgePigeon(db: Database, pigeon: Pigeon): void {
  for (const o of db.offers.filter((x) => x.pigeonId === pigeon.id)) {
    notify(db, o.fromUserId, 'info', '🚫 Bod vervallen', `${pigeon.name} is niet meer beschikbaar. Je bod van €${o.amount} is vervallen.`);
  }
  db.offers = db.offers.filter((o) => o.pigeonId !== pigeon.id);
  db.breedingPairs = db.breedingPairs.filter((bp) => bp.sireId !== pigeon.id && bp.damId !== pigeon.id);
  for (const f of db.flights) {
    if (f.status !== 'completed') f.entries = f.entries.filter((e) => e.pigeonId !== pigeon.id);
  }
  db.pigeons = db.pigeons.filter((p) => p.id !== pigeon.id);
}

/** Release one of your pigeons into the wild: you're rid of it, for no money. */
export function releasePigeon(store: Store, userId: string, pigeonId: string): string | null {
  return store.mutate((db) => {
    const pigeon = db.pigeons.find((p) => p.id === pigeonId && p.ownerId === userId);
    if (!pigeon) return 'Duif niet gevonden';
    const busy = pigeonBusy(db, pigeonId);
    if (busy) return busy;
    const name = pigeon.name;
    purgePigeon(db, pigeon);
    notify(db, userId, 'info', '🕊️ Duif vrijgelaten', `Je liet ${name} vrij. Ze vliegt de vrijheid tegemoet — je krijgt er niets voor terug.`);
    return null;
  });
}

/**
 * Sell one of your pigeons to the local pigeon-soup restaurant for a fixed sum.
 * Grim work: sending a loft-mate to the pot rattles every remaining bird, which
 * each loses a random `moraleEnergyMin..moraleEnergyMax` energie (form).
 */
export function sellToRestaurant(store: Store, userId: string, pigeonId: string): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    const pigeon = db.pigeons.find((p) => p.id === pigeonId && p.ownerId === userId);
    if (!loft || !pigeon) return 'Duif niet gevonden';
    const busy = pigeonBusy(db, pigeonId);
    if (busy) return busy;
    const name = pigeon.name;
    loft.money += PIGEON_RESTAURANT.payout;
    purgePigeon(db, pigeon);
    // Morale hit on every remaining bird in this loft (the sold one is gone).
    let affected = 0;
    for (const p of db.pigeons) {
      if (p.ownerId !== userId) continue;
      const loss = randInt(PIGEON_RESTAURANT.moraleEnergyMin, PIGEON_RESTAURANT.moraleEnergyMax);
      p.form = clamp(p.form - loss, 0, 100);
      affected++;
    }
    const moraleLine = affected > 0
      ? ` De rest van je hok is er beroerd van: ${affected} duif${affected === 1 ? '' : 'ven'} verloor elk ${PIGEON_RESTAURANT.moraleEnergyMin}–${PIGEON_RESTAURANT.moraleEnergyMax} energie.`
      : '';
    notify(
      db, userId, 'info', `🍲 Verkocht aan ${PIGEON_RESTAURANT.name}`,
      `${name} ging voor €${PIGEON_RESTAURANT.payout} naar ${PIGEON_RESTAURANT.name} — er wordt duivensoep van gemaakt.${moraleLine}`,
    );
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
    if (onRestCure(pigeon)) return 'Deze duif is op rustkuur — ze kan pas weer trainen als de kuur voorbij is';
    if (isAway(pigeon)) return `${AWAY_MSG}`;
    const racing = db.flights.some(
      (f) => f.status !== 'completed' && f.entries.some((e) => e.pigeonId === pigeonId),
    );
    if (racing) return 'Deze duif is ingeschreven voor een vlucht — trainen kan pas als ze weer thuis is';
    // Manual training only reaches min(80, geneCap); beyond that only racing (→90)
    // and the coach (→gene cap) can grow the skill.
    const cap = trainCeil(pigeon, attr);
    if (pigeon[attr] >= cap)
      return `Deze eigenschap zit op haar handmatige plafond (${cap}). Verder groei je enkel via vluchten (tot 90) en daarna een privécoach (tot haar gen-cap).`;
    const cost = trainingCost(pigeon[attr]); // rises exponentially with the current level
    if (loft.money < cost) return 'Niet genoeg geld om te trainen';
    if (pigeon.form < TRAINING.formCost + 5) return 'Deze duif heeft te weinig energie om te trainen';
    // Each attribute can be trained at most once per week.
    const lastTrained = pigeon.trainedAt?.[attr];
    if (lastTrained && Date.now() - Date.parse(lastTrained) < TRAINING.cooldownDays * 86400000) {
      const nextDate = new Date(Date.parse(lastTrained) + TRAINING.cooldownDays * 86400000)
        .toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'long' });
      const label = attr === 'speed' ? 'snelheid' : attr === 'endurance' ? 'conditie' : 'oriëntatie';
      return `${label.charAt(0).toUpperCase() + label.slice(1)} is deze week al getraind — opnieuw vanaf ${nextDate}`;
    }
    loft.money -= cost;
    const gain = TRAINING.attributeGain * randFloat(0.7, 1.3);
    const before = pigeon[attr];
    pigeon[attr] = round1(clamp(pigeon[attr] + gain, 0, cap));
    noteAttrChange(pigeon, attr, before, 'training');
    pigeon.form = round1(clamp(pigeon.form - TRAINING.formCost, 0, 100));
    pigeon.experience = round1(
      clamp(pigeon.experience + experienceGain(pigeon.experience, TRAINING.experienceGain), 0, 100),
    );
    pigeon.trainedAt = { ...pigeon.trainedAt, [attr]: new Date().toISOString() };
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
      return `Beide ouders hebben minstens ${BREEDING.minParentForm} energie nodig (meer energie + libido = sneller een jong)`;
    if (sire.ailment || dam.ailment) return 'Een zieke of gekwetste duif kan niet koppelen';
    if (sire.inInfirmary || dam.inInfirmary) return 'Een duif in de ziekenboeg kan niet koppelen';
    if (onRestCure(sire) || onRestCure(dam)) return 'Een duif op rustkuur kan niet koppelen';
    if (isAway(sire) || isAway(dam)) return 'Een duif die nog niet thuis is van haar vlucht kan niet koppelen';
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
    loft.stats.broods += 1;
    progressMissions(db, loft, 'brood', 1);
    evaluateBadges(db, loft);
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
    if (isAway(pigeon)) return `${AWAY_MSG}`;
    if (!wantIn) {
      pigeon.inInfirmary = false;
      // Auto-reclaim the private compartment it held on the way in — but only if a
      // slot is still free (another bird may have taken the freed slot while it was
      // in the infirmary). If the loft is now full on compartments, it comes back
      // without one and can be reassigned later.
      if (pigeon.compartment) {
        const loft = db.lofts.find((l) => l.userId === userId);
        const used = db.pigeons.filter(
          (p) => p.ownerId === userId && p.compartment && !p.inInfirmary && p.id !== pigeon.id,
        ).length;
        if (used >= (loft?.compartments ?? 0)) pigeon.compartment = false;
      }
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
    // The bird KEEPS its compartment flag while isolated in the infirmary, but the
    // slot frees up in the meantime — compartmentsUsed and the assign-check both
    // ignore infirmary birds, and the rest-bonus is withheld — so another bird can
    // use the slot. On the way out it reclaims the compartment only if one is still
    // free (see the wantIn=false branch above).
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

/**
 * Pin (or unpin) one infirmary bird to a doctor/physio slot. A doctor treats
 * only `INFIRMARY.birdsPerDoctor` sick birds and a physio as many injured ones,
 * so once there are more patients than slots the owner decides who gets the
 * care instead of the game handing it to the worst case. Returns error or null.
 */
export function setCareAssignment(store: Store, userId: string, pigeonId: string, on: boolean): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    const pigeon = db.pigeons.find((p) => p.id === pigeonId && p.ownerId === userId);
    if (!loft || !pigeon) return 'Duif niet gevonden';
    if (!on) {
      pigeon.careAssigned = false;
      return null;
    }
    if (!pigeon.ailment) return 'Deze duif is niet ziek of gewond';
    if (!pigeon.inInfirmary) return 'Zet deze duif eerst in de ziekenboeg';
    if (pigeon.careAssigned) return null;
    const kind = pigeon.ailment.kind;
    const owned = db.pigeons.filter((p) => p.ownerId === userId);
    const { slots, assigned } = careSlots(loft, owned, kind);
    if (slots === 0) {
      return kind === 'ziekte'
        ? 'Je hebt nog geen duivendokter in dienst'
        : 'Je hebt nog geen duivenkinesist in dienst';
    }
    if (assigned >= slots) {
      const who = kind === 'ziekte' ? 'dokter' : 'kinesist';
      return `Je ${who} behandelt er al ${slots} — haal er eerst een duif uit, of neem een tweede ${who} in dienst`;
    }
    pigeon.careAssigned = true;
    return null;
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
