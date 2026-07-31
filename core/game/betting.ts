/**
 * Betting on flights. From `windowHours` before a flight starts until the start,
 * players stake money on outcomes. Odds are estimated with a Monte-Carlo of the
 * SAME model the race uses (velocity × per-bird luck, plus a did-not-finish roll
 * from energie), so the prices track the real chances; a bookmaker margin makes
 * every bet slightly house-favoured. Stakes are deducted at placement and paid
 * (stake × ratio) on a win. Bets are settled from the real result.
 */

import { BETTING, FLIGHT_RISK } from '../config/gameConfig.js';
import type { Bet, BetKind, Database, Flight, Pigeon } from '../schema.js';
import { newId } from '../store.js';
import { pigeonVelocity } from './flight.js';
import { clamp, hashString, seededRng } from './util.js';

/** When betting opens/closes for a flight. */
export function bettingOpen(flight: Flight, nowMs: number): boolean {
  if (flight.status !== 'scheduled') return false;
  const start = Date.parse(flight.startAt);
  if (Number.isNaN(start)) return false;
  return nowMs >= start - BETTING.windowHours * 3600000 && nowMs < start;
}

interface SimResult {
  orders: { order: string[]; finishers: number }[];
  owner: Map<string, string>;
  ids: string[];
}

/**
 * Monte-Carlo the flight: each draw samples every bird's luck and whether it
 * finishes, ranks the finishers by (velocity × luck) and appends the non-
 * finishers. Seeded on the flight id so preview and placement agree.
 */
function simulate(db: Database, flight: Flight): SimResult {
  const base: Pigeon[] = [];
  for (const e of flight.entries) {
    const p = db.pigeons.find((x) => x.id === e.pigeonId);
    if (p) base.push(p);
  }
  const owner = new Map(base.map((p) => [p.id, p.ownerId]));
  const vel = new Map(base.map((p) => [p.id, pigeonVelocity(p, flight.distanceKm, flight.week, 1, 1)]));
  const rng = seededRng(hashString(flight.id));
  const orders: { order: string[]; finishers: number }[] = [];

  for (let it = 0; it < BETTING.simIterations; it++) {
    const scored = base.map((p) => {
      const luck = 0.9 + rng() * 0.2;
      const dnfChance = clamp((FLIGHT_RISK.dnfFormThreshold - p.form) / FLIGHT_RISK.dnfFormThreshold, 0, FLIGHT_RISK.dnfMaxChance);
      const dnf = rng() < dnfChance;
      return { id: p.id, score: (vel.get(p.id) ?? 1) * luck, dnf };
    });
    const fin = scored.filter((x) => !x.dnf).sort((a, b) => b.score - a.score).map((x) => x.id);
    const nf = scored.filter((x) => x.dnf).map((x) => x.id);
    orders.push({ order: [...fin, ...nf], finishers: fin.length });
  }
  return { orders, owner, ids: base.map((p) => p.id) };
}

/** The probability of a given wager, or null if the bet is invalid. */
export function betProbability(
  db: Database,
  flight: Flight,
  kind: BetKind,
  userId: string,
  pigeonId: string | null,
  rivalId: string | null,
): number | null {
  const sim = simulate(db, flight);
  const N = sim.orders.length;
  if (sim.ids.length < 2 || N === 0) return null;
  const has = (id: string | null): id is string => !!id && sim.ids.includes(id);
  let count = 0;

  switch (kind) {
    case 'win': {
      if (!has(pigeonId)) return null;
      for (const o of sim.orders) if (o.finishers > 0 && o.order[0] === pigeonId) count++;
      return count / N;
    }
    case 'own_top3': {
      if (!has(pigeonId) || sim.owner.get(pigeonId) !== userId) return null;
      for (const o of sim.orders) {
        const k = Math.min(3, o.finishers);
        if (o.order.slice(0, k).includes(pigeonId)) count++;
      }
      return count / N;
    }
    case 'last': {
      if (!has(pigeonId)) return null;
      for (const o of sim.orders) if (o.finishers > 0 && o.order[o.finishers - 1] === pigeonId) count++;
      return count / N;
    }
    case 'mine_wins': {
      if (!sim.ids.some((id) => sim.owner.get(id) === userId)) return null;
      for (const o of sim.orders) if (o.finishers > 0 && sim.owner.get(o.order[0]) === userId) count++;
      return count / N;
    }
    case 'head2head': {
      if (!has(pigeonId) || !has(rivalId) || pigeonId === rivalId) return null;
      for (const o of sim.orders) if (o.order.indexOf(pigeonId) < o.order.indexOf(rivalId)) count++;
      return count / N;
    }
    default:
      return null;
  }
}

/** Payout ratio (multiplier on stake) for a probability. */
export function ratioFor(prob: number): number {
  if (prob <= 0) return BETTING.maxRatio;
  return Math.round(clamp((1 / prob) * (1 - BETTING.houseMargin), BETTING.minRatio, BETTING.maxRatio) * 100) / 100;
}

const KIND_LABEL: Record<BetKind, string> = {
  win: 'wint de vlucht',
  last: 'eindigt allerlaatste',
  own_top3: 'eindigt in de top 3',
  mine_wins: 'een van jouw duiven wint',
  head2head: 'komt eerder thuis dan',
};

function pigeonName(db: Database, id: string | null): string {
  return db.pigeons.find((p) => p.id === id)?.name ?? '?';
}

/** A preview of a proposed bet: its ratio + potential win, or an error string. */
export function previewBet(
  db: Database,
  flight: Flight,
  userId: string,
  kind: BetKind,
  pigeonId: string | null,
  rivalId: string | null,
  stake: number,
): { ratio: number; prob: number; potentialWin: number; label: string } | string {
  const prob = betProbability(db, flight, kind, userId, pigeonId, rivalId);
  if (prob == null) return '!Ongeldige weddenschap';
  const ratio = ratioFor(prob);
  const s = clamp(Math.round(stake) || 0, 0, BETTING.maxStake);
  const label =
    kind === 'head2head'
      ? `${pigeonName(db, pigeonId)} ${KIND_LABEL[kind]} ${pigeonName(db, rivalId)}`
      : kind === 'mine_wins'
        ? KIND_LABEL[kind]
        : `${pigeonName(db, pigeonId)} ${KIND_LABEL[kind]}`;
  return { ratio, prob, potentialWin: Math.round(s * ratio), label };
}

/** Place a bet on a flight. Returns the created bet, or an error string ('!…'). */
export function placeBet(
  db: Database,
  userId: string,
  flightId: string,
  kind: BetKind,
  pigeonId: string | null,
  rivalId: string | null,
  stake: number,
  nowMs: number,
): Bet | string {
  const flight = db.flights.find((f) => f.id === flightId);
  if (!flight) return '!Vlucht niet gevonden';
  if (!bettingOpen(flight, nowMs)) return '!Je kan niet (meer) wedden op deze vlucht';
  if (db.bets.some((x) => x.userId === userId && x.flightId === flightId && x.status === 'open')) {
    return '!Je hebt al een weddenschap lopen op deze vlucht';
  }
  const loft = db.lofts.find((l) => l.userId === userId);
  if (!loft) return '!Geen hok gevonden';
  const bet = Math.round(stake);
  if (!(bet >= BETTING.minStake)) return `!Minimale inzet is €${BETTING.minStake}`;
  if (bet > BETTING.maxStake) return `!Maximale inzet is €${BETTING.maxStake}`;
  if (loft.money < bet) return '!Je hebt niet genoeg geld voor deze inzet';
  const prob = betProbability(db, flight, kind, userId, pigeonId, rivalId);
  if (prob == null) return '!Ongeldige weddenschap';
  const ratio = ratioFor(prob);

  loft.money -= bet;
  const newBet: Bet = {
    id: newId('bet'), userId, userName: loft.name, flightId, kind,
    pigeonId: kind === 'mine_wins' ? null : pigeonId,
    pigeonName: kind === 'mine_wins' ? loft.name : pigeonName(db, pigeonId),
    rivalId: kind === 'head2head' ? rivalId : null,
    rivalName: kind === 'head2head' ? pigeonName(db, rivalId) : null,
    stake: bet, ratio, potentialWin: Math.round(bet * ratio),
    status: 'open', placedAt: new Date(nowMs).toISOString(), settledAt: null,
  };
  db.bets.push(newBet);
  if (db.bets.length > 200) db.bets = db.bets.slice(-200);
  return newBet;
}

function notify(db: Database, userId: string, title: string, body: string): void {
  db.notifications.push({
    id: newId('ntf'), userId, kind: 'info', title, body,
    flightId: null, createdAt: new Date().toISOString(), read: false,
  });
}

/** Settle every open bet on a finished flight from its results. */
export function settleFlightBets(db: Database, flight: Flight): void {
  const results = flight.results;
  const rankOf = (id: string | null) => results.find((r) => r.pigeonId === id)?.rank ?? null;
  const finishers = results.filter((r) => r.finished !== false);
  const lastFinisherRank = finishers.reduce((m, r) => Math.max(m, r.rank), 0);

  for (const b of db.bets) {
    if (b.status !== 'open' || b.flightId !== flight.id) continue;
    const loft = db.lofts.find((l) => l.userId === b.userId);
    let outcome: 'won' | 'lost' | 'void' = 'lost';

    if (b.kind === 'mine_wins') {
      const winner = results.find((r) => r.rank === 1 && r.finished !== false);
      outcome = winner && winner.ownerId === b.userId ? 'won' : 'lost';
    } else {
      const r = results.find((x) => x.pigeonId === b.pigeonId);
      if (!r) outcome = 'void'; // the bird withdrew — refund
      else if (b.kind === 'win') outcome = r.rank === 1 && r.finished !== false ? 'won' : 'lost';
      else if (b.kind === 'own_top3') outcome = r.rank <= 3 && r.finished !== false ? 'won' : 'lost';
      else if (b.kind === 'last') outcome = r.finished !== false && r.rank === lastFinisherRank ? 'won' : 'lost';
      else if (b.kind === 'head2head') {
        const rr = rankOf(b.rivalId);
        if (rr == null) outcome = 'void';
        else outcome = r.rank < rr ? 'won' : 'lost';
      }
    }

    b.status = outcome;
    b.settledAt = new Date().toISOString();
    if (loft) {
      if (outcome === 'won') {
        loft.money += b.potentialWin;
        notify(db, b.userId, '🎉 Weddenschap gewonnen!', `Je won €${b.potentialWin} (inzet €${b.stake} × ${b.ratio}).`);
      } else if (outcome === 'void') {
        loft.money += b.stake;
        notify(db, b.userId, '↩️ Weddenschap vervallen', `De duif deed niet mee. Je inzet van €${b.stake} is terugbetaald.`);
      } else {
        notify(db, b.userId, '❌ Weddenschap verloren', `Je verloor je inzet van €${b.stake}.`);
      }
    }
  }
}

/** A player's bets (open first, then recently settled), with flight context. */
export function betsView(db: Database, userId: string, limit = 20) {
  return db.bets
    .filter((b) => b.userId === userId)
    .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (a.placedAt < b.placedAt ? 1 : -1))
    .slice(0, limit)
    .map((b) => {
      const flight = db.flights.find((f) => f.id === b.flightId);
      return {
        id: b.id, kind: b.kind, pigeonName: b.pigeonName, rivalName: b.rivalName,
        stake: b.stake, ratio: b.ratio, potentialWin: b.potentialWin, status: b.status,
        flightName: flight?.name ?? 'Vlucht', flightId: b.flightId,
      };
    });
}
