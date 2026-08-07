/**
 * Presenters turn internal entities into the DTO shapes the client consumes,
 * adding computed fields (age, talent, value, eligibility) so the frontend
 * stays dumb and consistent. Keep these in sync with client/src/types.ts.
 */

import type { Database, Flight, Loft, Notification, Pigeon, Trade } from './schema.js';
import { BREED_RARITY, compartmentCost, REST_CURE, TRAINING } from './config/gameConfig.js';
import { ageInWeeks, breedInfo, canRace, estimateValue, talent } from './game/pigeon.js';
import { auctionKind } from './game/auction.js';
import { bettingOpen } from './game/betting.js';
import { nextCapacityTier, nextInfirmaryTier, ownerName } from './game/engine.js';
import { projectDailyCare } from './game/economy.js';
import { flightCommentary, liveSnapshot } from './game/flight.js';
import { BADGES, levelForXp } from './game/badges.js';
import { round1 } from './game/util.js';

/**
 * DTO for a pigeon. If `viewerId` is given and is NOT the owner, the bird's
 * individual attributes are WITHHELD (sent as null) — a player only sees what is
 * publicly known about someone else's pigeon: its general score (talent) and
 * estimated value, plus what races/rankings reveal. Own birds (or no viewer)
 * are fully revealed.
 */
export function pigeonDTO(db: Database, p: Pigeon, viewerId?: string) {
  const week = db.world.currentWeek;
  const owner = db.lofts.find((l) => l.userId === p.ownerId);
  // Attributes are public when: there is no specific viewer (server-internal),
  // the viewer owns the bird, OR the bird is openly listed for sale on the market
  // (a buyer must see what they're buying). Only a bird that is NOT for sale, when
  // viewed by someone else (to make a private/direct offer), hides its attributes.
  const revealed = viewerId === undefined || p.ownerId === viewerId || p.forSale;
  const live = db.flights.some((f) => f.status === 'live' && f.entries.some((e) => e.pigeonId === p.id));
  const dailyCare = revealed && owner && !owner.isBot ? projectDailyCare(owner, p, live) : null;
  const hide = <T,>(v: T): T | null => (revealed ? v : null);
  return {
    id: p.id,
    ownerId: p.ownerId,
    ownerName: ownerName(db, p.ownerId),
    ownerIsBot: owner?.isBot ?? false,
    name: p.name,
    sex: p.sex,
    ageWeeks: ageInWeeks(p, week),
    revealed,
    // Withheld for other players' pigeons (only the general score is public).
    speed: hide(p.speed),
    endurance: hide(p.endurance),
    orientation: hide(p.orientation),
    libido: hide(p.libido),
    form: hide(p.form),
    health: hide(p.health),
    experience: hide(p.experience),
    talent: talent(p), // the "algemene score" — publicly known (via weddenschappen/ranglijst)
    // Breed (ras) is PUBLIC — its photo is shown for everyone's birds. Cosmetic
    // only; rarity gives a small price premium (already folded into `value`).
    breed: (() => {
      const b = breedInfo(p.breed);
      return { id: b.id, name: b.name, rarity: b.rarity, rarityLabel: BREED_RARITY[b.rarity].label, image: b.image };
    })(),
    value: estimateValue(p, week),
    canRace: canRace(p, week),
    forSale: p.forSale,
    price: p.price,
    sireId: p.sireId,
    damId: p.damId,
    ailment: revealed ? p.ailment : null,
    inInfirmary: revealed ? p.inInfirmary : false,
    coached: revealed ? (p.coached ?? false) : false,
    ration: revealed ? (p.ration ?? 'normal') : 'normal',
    compartment: revealed ? (p.compartment ?? false) : false,
    cureUntil: revealed ? (p.cureUntil ?? null) : null,
    onCure: revealed ? (!!p.cureUntil && Date.parse(p.cureUntil) > Date.now()) : false,
    // Per-attribute training cooldown (own birds only).
    trainAvailableAt: (() => {
      if (!revealed) return { speed: null, endurance: null, orientation: null };
      const now = Date.now();
      const cd = TRAINING.cooldownDays * 86400000;
      const next = (a: 'speed' | 'endurance' | 'orientation') => {
        const last = p.trainedAt?.[a];
        if (!last) return null;
        const n = Date.parse(last) + cd;
        return n > now ? new Date(n).toISOString() : null;
      };
      return { speed: next('speed'), endurance: next('endurance'), orientation: next('orientation') };
    })(),
    racing: db.flights.some((f) => f.status !== 'completed' && f.entries.some((e) => e.pigeonId === p.id)),
    breeding: revealed && db.breedingPairs.some((bp) => bp.sireId === p.id || bp.damId === p.id),
    dailyCare,
  };
}

export function loftDTO(db: Database, loft: Loft) {
  const pigeons = db.pigeons.filter((p) => p.ownerId === loft.userId);
  const infirmary = pigeons.filter((p) => p.inInfirmary);
  return {
    userId: loft.userId,
    name: loft.name,
    sponsorCount: loft.sponsorship?.active.length ?? 0,
    sponsorOfferCount: loft.sponsorship?.offers.length ?? 0,
    money: Math.round(loft.money),
    food: loft.food,
    feedRation: loft.feedRation,
    capacity: loft.capacity,
    compartments: loft.compartments ?? 0,
    compartmentsUsed: pigeons.filter((p) => p.compartment).length,
    compartmentCost: (loft.compartments ?? 0) >= loft.capacity ? null : compartmentCost(loft.compartments ?? 0),
    nextCapacity: nextCapacityTier(loft.capacity),
    nextInfirmary: nextInfirmaryTier(loft.infirmaryCapacity),
    pigeonCount: pigeons.length,
    seasonPoints: loft.seasonPoints,
    totalWins: loft.totalWins,
    isBot: loft.isBot,
    infirmaryCapacity: loft.infirmaryCapacity,
    infirmaryCount: infirmary.length,
    medicatedFood: loft.medicatedFood,
    doctors: loft.doctors,
    physios: loft.physios,
    sickCount: infirmary.filter((p) => p.ailment?.kind === 'ziekte').length,
    injuredCount: infirmary.filter((p) => p.ailment?.kind === 'kwetsuur').length,
    // Weekly rest-cure lock: ISO time the next cure becomes available, or null if
    // one can be started right now (max one cure per loft per week).
    restCureAvailableAt: (() => {
      const last = loft.lastRestCure ? Date.parse(loft.lastRestCure) : NaN;
      if (Number.isNaN(last)) return null;
      const next = last + REST_CURE.cooldownDays * 86400000;
      return next > Date.now() ? new Date(next).toISOString() : null;
    })(),
  };
}

export function flightDTO(db: Database, f: Flight) {
  return {
    id: f.id,
    week: f.week,
    name: f.name,
    type: f.type,
    distanceKm: f.distanceKm,
    entryFee: f.entryFee,
    fromCity: f.fromCity,
    toCity: f.toCity,
    startAt: f.startAt,
    status: f.status,
    practice: !!f.practice,
    titan: !!f.titan,
    weather: f.weather,
    entryCount: f.entries.length,
    entries: f.entries,
    // Enough info about every entrant for the betting UI (names, owners, talent).
    entrants: f.entries.map((e) => {
      const p = db.pigeons.find((x) => x.id === e.pigeonId);
      return {
        pigeonId: e.pigeonId,
        name: p?.name ?? 'duif',
        ownerId: e.ownerId,
        ownerName: ownerName(db, e.ownerId),
        talent: p ? talent(p) : 0,
      };
    }),
    bettingOpen: bettingOpen(f, Date.now()),
    results: f.results,
    recap: f.recap,
    createdAt: f.createdAt,
  };
}

export function notificationDTO(n: Notification) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    flightId: n.flightId,
    createdAt: n.createdAt,
    read: n.read,
  };
}

/** A user's notifications, newest first, plus the unread count. */
export function notificationsFor(db: Database, userId: string) {
  const list = db.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return {
    notifications: list.map(notificationDTO),
    unread: list.filter((n) => !n.read).length,
  };
}

/** Full live view for a flight: meta + per-bird positions + commentary feed. */
export function liveFlightDTO(db: Database, f: Flight, nowMs: number) {
  const isRunning = f.status === 'live' || f.status === 'completed';
  return {
    flight: flightDTO(db, f),
    live: isRunning ? liveSnapshot(f, nowMs) : null,
    commentary: isRunning ? flightCommentary(f, nowMs) : [],
  };
}

export function tradeDTO(t: Trade) {
  return {
    id: t.id,
    pigeonName: t.pigeonName,
    sellerName: t.sellerName,
    buyerName: t.buyerName,
    price: t.price,
    at: t.at,
  };
}

/** All currently-open auctions for the market page (Sunday first, then shelter). */
export function auctionsDTO(db: Database, viewerId?: string) {
  return db.auctions
    .filter((a) => a.status === 'open')
    .map((a) => {
      const p = db.pigeons.find((x) => x.id === a.pigeonId);
      const kind = auctionKind(a);
      return {
        id: a.id,
        kind,
        sellerName: kind === 'shelter' ? 'Opvangcentrum' : 'Veilinghuis',
        // Auction birds are always fully revealed — you must see what you bid on.
        pigeon: p ? pigeonDTO(db, p) : null,
        startAt: a.startAt,
        endAt: a.endAt,
        currentBid: a.currentBid,
        currentBidderName: a.currentBidderName,
        minNextBid: a.currentBid > 0 ? a.currentBid + a.minIncrement : a.minBid,
      };
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'sunday' ? -1 : 1;
      return a.endAt.localeCompare(b.endAt);
    });
}

/** Recent market sales, newest first. */
export function recentTrades(db: Database, limit = 30) {
  return [...db.trades]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit)
    .map(tradeDTO);
}

/**
 * A pigeon's race placings, newest first. Sourced from the bird's durable
 * `raceLog` (not the flights table), so history survives the pruning of old
 * flights. `raceLog` is written at finalize; older races are backfilled by
 * migration v18.
 */
export function pigeonRaceHistory(db: Database, pigeonId: string) {
  const p = db.pigeons.find((x) => x.id === pigeonId);
  const log = p?.raceLog ?? [];
  return log
    .map((e) => ({
      flightId: e.flightId,
      name: e.name,
      fromCity: e.fromCity,
      toCity: e.toCity,
      distanceKm: e.distanceKm,
      startAt: e.startAt,
      rank: e.rank,
      total: e.total,
      points: e.points,
      prize: e.prize,
    }))
    .sort((a, b) => (a.startAt < b.startAt ? 1 : -1));
}

/** Season ranking rows sorted by points, humans and bots together. */
export function rankingRows(db: Database) {
  return db.lofts
    .map((l) => ({
      userId: l.userId,
      name: l.name,
      isBot: l.isBot,
      seasonPoints: l.seasonPoints,
      totalWins: l.totalWins,
      level: l.level ?? 1,
      pigeonCount: db.pigeons.filter((p) => p.ownerId === l.userId).length,
    }))
    .sort((a, b) => b.seasonPoints - a.seasonPoints || b.totalWins - a.totalWins)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

/** A player's prestige: level, badges (earned + locked) and trophy cabinet. */
export function playerProfile(db: Database, userId: string) {
  const loft = db.lofts.find((l) => l.userId === userId);
  if (!loft) return null;
  const lvl = levelForXp(loft.xp);
  const earned = new Map((loft.badges ?? []).map((b) => [b.key, b.at]));
  const badges = BADGES.map((def) => ({
    key: def.key,
    group: def.group,
    label: def.label,
    description: def.description,
    xp: def.xp,
    icon: def.icon,
    earned: earned.has(def.key),
    earnedAt: earned.get(def.key) ?? null,
  }));

  // Medal COUNTS come from the durable lifetime counters on the loft (kept up to
  // date at finalize by awardFlightBadges), so they survive flight pruning and
  // stay correct even for birds later sold or lost. Competition only (practice/
  // titan never touch these counters).
  const medals = {
    gold: loft.stats.gold ?? 0,
    silver: loft.stats.silver ?? 0,
    bronze: loft.stats.bronze ?? 0,
  };
  // The trophy SHOWCASE is rebuilt from the durable per-bird raceLog of the
  // pigeons this player currently owns (attributed by owner-at-flight-time, so a
  // bought bird's earlier placings stay with its previous owner). Competition
  // podiums only. Recent flights beyond retention live here, not in the flights
  // table.
  const trophies: {
    flightId: string; name: string; fromCity: string; toCity: string;
    startAt: string; pigeonName: string; rank: number;
  }[] = [];
  for (const p of db.pigeons) {
    if (p.ownerId !== userId) continue;
    for (const e of p.raceLog ?? []) {
      if (e.ownerId !== userId) continue;
      if (e.practice || e.titan) continue;
      if (e.rank > 3 || e.finished === false) continue;
      trophies.push({
        flightId: e.flightId, name: e.name, fromCity: e.fromCity, toCity: e.toCity,
        startAt: e.startAt, pigeonName: p.name, rank: e.rank,
      });
    }
  }
  trophies.sort((a, b) => (a.startAt < b.startAt ? 1 : -1));

  // Season prizes (Roekoes + Vleugels), newest first, with per-rank tallies.
  const awards = [...(loft.awards ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1));
  const tally = (kind: 'roekoe' | 'vleugel') => {
    const t = { gold: 0, silver: 0, bronze: 0 };
    for (const a of awards) {
      if (a.kind !== kind) continue;
      if (a.rank === 1) t.gold += 1;
      else if (a.rank === 2) t.silver += 1;
      else if (a.rank === 3) t.bronze += 1;
    }
    return t;
  };

  return {
    level: lvl.level,
    xp: loft.xp,
    intoLevel: lvl.intoLevel,
    needForNext: lvl.needForNext,
    earnedCount: (loft.badges ?? []).length,
    totalBadges: BADGES.length,
    badges,
    medals,
    trophies: trophies.slice(0, 60),
    roekoes: tally('roekoe'),
    vleugels: tally('vleugel'),
    awards: awards.slice(0, 60),
  };
}
