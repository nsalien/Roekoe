/**
 * Presenters turn internal entities into the DTO shapes the client consumes,
 * adding computed fields (age, talent, value, eligibility) so the frontend
 * stays dumb and consistent. Keep these in sync with client/src/types.ts.
 */

import type { Database, Flight, Loft, Notification, Pigeon, Trade } from './schema.js';
import { ageInWeeks, canRace, estimateValue, talent } from './game/pigeon.js';
import { ownerName } from './game/engine.js';
import { flightCommentary, liveSnapshot } from './game/flight.js';
import { round1 } from './game/util.js';

export function pigeonDTO(db: Database, p: Pigeon) {
  const week = db.world.currentWeek;
  return {
    id: p.id,
    ownerId: p.ownerId,
    ownerName: ownerName(db, p.ownerId),
    name: p.name,
    sex: p.sex,
    ageWeeks: ageInWeeks(p, week),
    speed: p.speed,
    endurance: p.endurance,
    orientation: p.orientation,
    libido: p.libido,
    form: p.form,
    health: p.health,
    experience: p.experience,
    talent: talent(p),
    value: estimateValue(p, week),
    canRace: canRace(p, week),
    forSale: p.forSale,
    price: p.price,
    sireId: p.sireId,
    damId: p.damId,
    retired: p.retired,
    ailment: p.ailment,
    inInfirmary: p.inInfirmary,
  };
}

export function loftDTO(db: Database, loft: Loft) {
  const pigeons = db.pigeons.filter((p) => p.ownerId === loft.userId);
  const infirmary = pigeons.filter((p) => p.inInfirmary);
  return {
    userId: loft.userId,
    name: loft.name,
    money: Math.round(loft.money),
    food: round1(loft.food),
    feedRation: loft.feedRation,
    capacity: loft.capacity,
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
    weather: f.weather,
    entryCount: f.entries.length,
    entries: f.entries,
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

/** Recent market sales, newest first. */
export function recentTrades(db: Database, limit = 30) {
  return [...db.trades]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit)
    .map(tradeDTO);
}

/** Every completed flight a pigeon took part in, with its placing. Newest first. */
export function pigeonRaceHistory(db: Database, pigeonId: string) {
  const rows: {
    flightId: string;
    name: string;
    fromCity: string;
    toCity: string;
    distanceKm: number;
    startAt: string;
    rank: number;
    total: number;
    points: number;
    prize: number;
  }[] = [];
  for (const f of db.flights) {
    if (f.status !== 'completed') continue;
    const r = f.results.find((x) => x.pigeonId === pigeonId);
    if (!r) continue;
    rows.push({
      flightId: f.id,
      name: f.name,
      fromCity: f.fromCity,
      toCity: f.toCity,
      distanceKm: f.distanceKm,
      startAt: f.startAt,
      rank: r.rank,
      total: f.results.length,
      points: r.points,
      prize: r.prize,
    });
  }
  return rows.sort((a, b) => (a.startAt < b.startAt ? 1 : -1));
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
      pigeonCount: db.pigeons.filter((p) => p.ownerId === l.userId).length,
    }))
    .sort((a, b) => b.seasonPoints - a.seasonPoints || b.totalWins - a.totalWins)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}
