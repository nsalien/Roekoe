/**
 * Betting on flights. From `windowHours` before a flight starts until the start,
 * players stake money on outcomes. The game estimates each bird's chance from
 * its attributes (via the same velocity model the race uses) plus its recent
 * form, then prices a payout ratio with a bookmaker margin: the bigger the
 * favourite, the smaller the ratio. Stakes are deducted at placement and paid
 * (stake × ratio) on a win. Bets are settled from the real result.
 */

import { BETTING } from '../config/gameConfig.js';
import type { Bet, BetKind, Database, Flight, Pigeon } from '../schema.js';
import { newId } from '../store.js';
import { pigeonVelocity } from './flight.js';
import { clamp } from './util.js';

/** When betting opens/closes for a flight (ms window before start). */
export function bettingOpen(flight: Flight, nowMs: number): boolean {
  if (flight.status !== 'scheduled') return false;
  const start = Date.parse(flight.startAt);
  if (Number.isNaN(start)) return false;
  return nowMs >= start - BETTING.windowHours * 3600000 && nowMs < start;
}

/** Average recent placing quality of a bird (0..1, higher = better), or 0.5. */
function recentForm(db: Database, pigeonId: string): number {
  const rows: number[] = [];
  for (const f of db.flights) {
    if (f.status !== 'completed' || f.results.length < 2) continue;
    const r = f.results.find((x) => x.pigeonId === pigeonId);
    if (r && r.finished !== false) rows.push(1 - (r.rank - 1) / (f.results.length - 1));
  }
  const last = rows.slice(-5);
  if (last.length === 0) return 0.5;
  return last.reduce((a, b) => a + b, 0) / last.length;
}

/** A bird's betting "strength": sharpened race velocity, nudged by recent form. */
function strength(db: Database, p: Pigeon, distanceKm: number, week: number): number {
  const vel = pigeonVelocity(p, distanceKm, week, 1, 1);
  const form = recentForm(db, p.id); // 0..1
  return Math.pow(Math.max(0.1, vel / 1000), BETTING.sharpness) * (0.7 + 0.6 * form);
}

interface Field {
  entries: { p: Pigeon; s: number }[];
  total: number;
}

function fieldFor(db: Database, flight: Flight): Field {
  const entries: { p: Pigeon; s: number }[] = [];
  for (const e of flight.entries) {
    const p = db.pigeons.find((x) => x.id === e.pigeonId);
    if (p) entries.push({ p, s: strength(db, p, flight.distanceKm, flight.week) });
  }
  const total = entries.reduce((sum, x) => sum + x.s, 0);
  return { entries, total };
}

/** P(this bird finishes in the top 3), exact Plackett-Luce inclusion. */
function pTop3(field: Field, id: string): number {
  const me = field.entries.find((x) => x.p.id === id);
  if (!me || field.total <= 0) return 0;
  const si = me.s;
  const T = field.total;
  const others = field.entries.filter((x) => x.p.id !== id);
  const p1 = si / T;
  let p2 = 0;
  for (const j of others) {
    const denom = T - j.s;
    if (denom > 0) p2 += (j.s / T) * (si / denom);
  }
  let p3 = 0;
  for (const j of others) {
    for (const k of others) {
      if (k.p.id === j.p.id) continue;
      const d1 = T - j.s;
      const d2 = T - j.s - k.s;
      if (d1 > 0 && d2 > 0) p3 += (j.s / T) * (k.s / d1) * (si / d2);
    }
  }
  return clamp(p1 + p2 + p3, 0, 1);
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
  const field = fieldFor(db, flight);
  if (field.entries.length < 2 || field.total <= 0) return null;
  const get = (id: string | null) => field.entries.find((x) => x.p.id === id);

  switch (kind) {
    case 'win': {
      const m = get(pigeonId);
      return m ? m.s / field.total : null;
    }
    case 'own_top3': {
      const m = get(pigeonId);
      if (!m || m.p.ownerId !== userId) return null;
      return pTop3(field, m.p.id);
    }
    case 'last': {
      const m = get(pigeonId);
      if (!m) return null;
      const invTotal = field.entries.reduce((sum, x) => sum + 1 / x.s, 0);
      return invTotal > 0 ? 1 / m.s / invTotal : null;
    }
    case 'mine_wins': {
      const mine = field.entries.filter((x) => x.p.ownerId === userId);
      if (mine.length === 0) return null;
      return mine.reduce((sum, x) => sum + x.s, 0) / field.total;
    }
    case 'head2head': {
      const a = get(pigeonId);
      const b = get(rivalId);
      if (!a || !b || a.p.id === b.p.id) return null;
      return a.s / (a.s + b.s);
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
  const loft = db.lofts.find((l) => l.userId === userId);
  if (!loft) return '!Geen hok gevonden';
  const bet = Math.round(stake);
  if (!(bet >= BETTING.minStake)) return `!Minimale inzet is €${BETTING.minStake}`;
  if (bet > BETTING.maxStake) return `!Maximale inzet is €${BETTING.maxStake}`;
  if (loft.money < bet) return 'Je hebt niet genoeg geld voor deze inzet'.replace(/^/, '!');
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
  const maxRank = results.reduce((m, r) => Math.max(m, r.rank), 0);

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
      else if (b.kind === 'last') outcome = r.rank === maxRank ? 'won' : 'lost';
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
