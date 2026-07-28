/**
 * Presenters turn internal entities into the DTO shapes the client consumes,
 * adding computed fields (age, talent, value, eligibility) so the frontend
 * stays dumb and consistent. Keep these in sync with client/src/types.ts.
 */

import type { Database, Flight, Loft, Pigeon } from './schema.js';
import { ageInWeeks, canRace, estimateValue, talent } from './game/pigeon.js';
import { ownerName } from './game/engine.js';
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
  };
}

export function loftDTO(db: Database, loft: Loft) {
  const pigeons = db.pigeons.filter((p) => p.ownerId === loft.userId);
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
    status: f.status,
    weather: f.weather,
    entryCount: f.entries.length,
    entries: f.entries,
    results: f.results,
    createdAt: f.createdAt,
  };
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
