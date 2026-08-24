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
import { progressMissions } from './missions.js';
import { evaluateBadges } from './badges.js';
import { clamp, hashString, seededRng } from './util.js';

/** When betting opens/closes for a flight. */
export function bettingOpen(flight: Flight, nowMs: number): boolean {
  if (flight.status !== 'scheduled') return false;
  if (flight.practice || flight.titan || flight.relay) return false; // oefenvlucht/titan/estafette: geen inzet
  const start = Date.parse(flight.startAt);
  if (Number.isNaN(start)) return false;
  return nowMs >= start - BETTING.windowHours * 3600000 && nowMs < start;
}

/**
 * The Monte-Carlo, reduced to the COUNTS the odds actually need.
 *
 * The old version built a full finishing order per draw — 1500 sorts of up to
 * 140 birds — and that alone cost 15–27 ms on a big field, against a Workers
 * budget of 10 ms per request. But no bet kind needs the whole order: `win` and
 * `mine_wins` need the first finisher, `top3`/`own_top3` the first three, `last`
 * the slowest finisher. So one O(birds) pass per draw tracks exactly those and
 * sorts nothing.
 *
 * `head2head` is the exception (it compares two arbitrary birds), which is why
 * every bird draws from its OWN rng stream, seeded on flight + bird: bird i's
 * draws can then be replayed on their own, without re-running the whole field.
 */
interface SimResult {
  iterations: number;
  n: number;
  ids: string[]; // index → pigeonId
  ownerOf: string[]; // index → ownerId
  indexOf: Map<string, number>;
  winCount: Int32Array; // draws this bird came home first
  top3Count: Int32Array; // draws it was in the first min(3, finishers)
  lastCount: Int32Array; // draws it was the slowest finisher
  ownerWin: Map<string, number>; // draws won by any bird of this owner
  vel: Float64Array; // per-bird constants, kept for the head2head replay
  dnfChance: Float64Array;
  seedBase: string;
}

/**
 * The run is fully determined by the flight (seeded on its id) and by the birds
 * that are entered, so within one isolate we compute it ONCE and reuse it. The
 * bet panel refetches its odds on every change, and re-running the Monte-Carlo
 * per request costs ~18 ms on a big field — over the whole 10 ms budget by
 * itself. Keyed on a cheap signature of everything the draw depends on, so a
 * bird entering, leaving or changing energie invalidates it.
 */
const simCache = new Map<string, { sig: number; res: SimResult }>();
const SIM_CACHE_MAX = 8;

/** Cheap numeric fingerprint of every input the Monte-Carlo actually reads. */
function simSignature(db: Database, flight: Flight, birds: Pigeon[]): number {
  let h = (hashString(flight.id) ^ Math.round(flight.distanceKm * 10) ^ (flight.week << 5)) >>> 0;
  for (const p of birds) {
    h = (Math.imul(h, 31) + hashString(p.id)) >>> 0;
    // Only the fields pigeonVelocity + the DNF roll depend on.
    h = (Math.imul(h, 31) + Math.round((p.speed + p.endurance + p.orientation) * 10)) >>> 0;
    h = (Math.imul(h, 31) + Math.round((p.form + p.health + p.experience) * 10)) >>> 0;
    h = (Math.imul(h, 31) + p.birthWeek) >>> 0;
  }
  return h;
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
  const sig = simSignature(db, flight, base);
  const hit = simCache.get(flight.id);
  if (hit && hit.sig === sig) return hit.res;

  const n = base.length;
  const iterations = BETTING.simIterations;
  const ids = base.map((p) => p.id);
  const ownerOf = base.map((p) => p.ownerId);
  const indexOf = new Map(ids.map((id, i) => [id, i]));

  // Per-bird constants, hoisted out of the draw loop.
  const vel = new Float64Array(n);
  const dnfChance = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    vel[i] = pigeonVelocity(base[i], flight.distanceKm, flight.week, 1, 1);
    dnfChance[i] = clamp(
      (FLIGHT_RISK.dnfFormThreshold - base[i].form) / FLIGHT_RISK.dnfFormThreshold,
      0,
      FLIGHT_RISK.dnfMaxChance,
    );
  }

  // One independent stream per bird (see SimResult) so head2head can replay two
  // birds without re-running the field.
  const seedBase = flight.id + ':bet:';
  const rngs: (() => number)[] = new Array(n);
  for (let i = 0; i < n; i++) rngs[i] = seededRng(hashString(seedBase + ids[i]));

  const winCount = new Int32Array(n);
  const top3Count = new Int32Array(n);
  const lastCount = new Int32Array(n);
  const ownerWin = new Map<string, number>();

  for (let it = 0; it < iterations; it++) {
    // Track only the podium and the tail — no sort, no allocation.
    let i1 = -1, i2 = -1, i3 = -1;
    let s1 = -Infinity, s2 = -Infinity, s3 = -Infinity;
    let iLast = -1, sLast = Infinity;
    let finCount = 0;
    for (let i = 0; i < n; i++) {
      const r = rngs[i];
      const luck = 0.9 + r() * 0.2;
      if (r() < dnfChance[i]) continue; // did not finish this draw
      finCount++;
      const score = vel[i] * luck;
      if (score > s1) { i3 = i2; s3 = s2; i2 = i1; s2 = s1; i1 = i; s1 = score; }
      else if (score > s2) { i3 = i2; s3 = s2; i2 = i; s2 = score; }
      else if (score > s3) { i3 = i; s3 = score; }
      if (score < sLast) { iLast = i; sLast = score; }
    }
    if (finCount > 0) {
      winCount[i1]++;
      ownerWin.set(ownerOf[i1], (ownerWin.get(ownerOf[i1]) ?? 0) + 1);
      lastCount[iLast]++;
      // "Top 3" is the first min(3, finishers) home.
      top3Count[i1]++;
      if (finCount > 1 && i2 >= 0) top3Count[i2]++;
      if (finCount > 2 && i3 >= 0) top3Count[i3]++;
    }
  }

  const res: SimResult = {
    iterations, n, ids, ownerOf, indexOf,
    winCount, top3Count, lastCount, ownerWin, vel, dnfChance, seedBase,
  };
  // Keep the map small: a handful of flights can have an open betting window.
  if (simCache.size >= SIM_CACHE_MAX) simCache.delete(simCache.keys().next().value as string);
  simCache.set(flight.id, { sig, res });
  return res;
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
  const { iterations: N, n } = sim;
  if (n < 2 || N === 0) return null;
  const idx = (id: string | null): number => (id == null ? -1 : sim.indexOf.get(id) ?? -1);
  const target = idx(pigeonId);
  const rival = idx(rivalId);

  switch (kind) {
    case 'win':
      if (target < 0) return null;
      return sim.winCount[target] / N;
    case 'own_top3':
      if (target < 0 || sim.ownerOf[target] !== userId) return null;
      return sim.top3Count[target] / N;
    case 'top3':
      if (target < 0) return null;
      return sim.top3Count[target] / N;
    case 'last':
      if (target < 0) return null;
      return sim.lastCount[target] / N;
    case 'mine_wins':
      if (!sim.ownerOf.some((o) => o === userId)) return null;
      return (sim.ownerWin.get(userId) ?? 0) / N;
    case 'head2head': {
      if (target < 0 || rival < 0 || target === rival) return null;
      // Replay just these two birds' streams (they are seeded per bird, so this
      // reproduces exactly the draws the field pass used) and count who is ahead.
      // A bird that finishes always beats one that doesn't; if neither finishes
      // the draw is a wash and counts for neither.
      const ra = seededRng(hashString(sim.seedBase + sim.ids[target]));
      const rb = seededRng(hashString(sim.seedBase + sim.ids[rival]));
      let count = 0;
      for (let it = 0; it < N; it++) {
        const la = 0.9 + ra() * 0.2;
        const aOut = ra() < sim.dnfChance[target];
        const lb = 0.9 + rb() * 0.2;
        const bOut = rb() < sim.dnfChance[rival];
        if (aOut && bOut) continue;
        if (aOut !== bOut) { if (bOut) count++; continue; }
        if (sim.vel[target] * la > sim.vel[rival] * lb) count++;
      }
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
  top3: 'eindigt in de top 3',
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
  // Bounded by the store (core/d1.ts). Trimming the array here would be actively
  // harmful now: `db.bets` holds every OPEN bet plus this player's settled ones,
  // so dropping the head could delete other players' unsettled bets.
  loft.stats.bets += 1;
  progressMissions(db, loft, 'bet', 1);
  evaluateBadges(db, loft);
  return newBet;
}

function notify(db: Database, userId: string, title: string, body: string, id?: string): void {
  // A stable `id` keeps the notification idempotent when a bet is settled more
  // than once (two concurrent requests finalizing the same flight).
  const finalId = id ?? newId('ntf');
  const existing = db.notifications.find((n) => n.id === finalId);
  const note = {
    id: finalId, userId, kind: 'info' as const, title, body,
    flightId: null, createdAt: new Date().toISOString(), read: existing?.read ?? false,
  };
  if (existing) Object.assign(existing, note);
  else db.notifications.push(note);
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
      else if (b.kind === 'own_top3' || b.kind === 'top3') outcome = r.rank <= 3 && r.finished !== false ? 'won' : 'lost';
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
      const betNoteId = `ntf:bet:${b.id}`;
      if (outcome === 'won') {
        loft.money += b.potentialWin;
        loft.stats.betsWon += 1;
        notify(db, b.userId, '🎉 Weddenschap gewonnen!', `Je won €${b.potentialWin} (inzet €${b.stake} × ${b.ratio}).`, betNoteId);
      } else if (outcome === 'void') {
        loft.money += b.stake;
        notify(db, b.userId, '↩️ Weddenschap vervallen', `De duif deed niet mee. Je inzet van €${b.stake} is terugbetaald.`, betNoteId);
      } else {
        notify(db, b.userId, '❌ Weddenschap verloren', `Je verloor je inzet van €${b.stake}.`, betNoteId);
      }
    }
  }
}

/** Cancel one open bet and refund its stake to the owner, idempotently. */
function refundBet(db: Database, b: Bet, body: string): void {
  b.status = 'void';
  b.settledAt = new Date().toISOString();
  const loft = db.lofts.find((l) => l.userId === b.userId);
  if (loft) {
    loft.money += b.stake;
    // Reuse the stable per-bet notification id so a later settlement (or a second
    // run) can never double up the message or the refund.
    notify(db, b.userId, '↩️ Weddenschap geannuleerd', body, `ntf:bet:${b.id}`);
  }
}

/** Does a bet still depend on this bird being in the flight? */
function betNeedsPigeon(b: Bet, flight: Flight, pigeonId: string): boolean {
  if (b.kind === 'mine_wins') {
    // "one of my birds wins" is only doomed once this owner has no bird left in.
    return !flight.entries.some((e) => e.ownerId === b.userId);
  }
  if (b.kind === 'head2head') return b.pigeonId === pigeonId || b.rivalId === pigeonId;
  return b.pigeonId === pigeonId;
}

/**
 * A bird was withdrawn from a still-scheduled flight: cancel and refund every
 * open bet that depended on it, immediately (instead of only when the flight
 * settles). `flight.entries` must already reflect the removal so mine_wins can
 * be re-evaluated.
 */
export function voidBetsForWithdrawnPigeon(db: Database, flight: Flight, pigeonId: string): void {
  const name = db.pigeons.find((p) => p.id === pigeonId)?.name ?? 'Een duif';
  for (const b of db.bets) {
    if (b.status !== 'open' || b.flightId !== flight.id) continue;
    if (!betNeedsPigeon(b, flight, pigeonId)) continue;
    const body =
      b.kind === 'mine_wins'
        ? `${name} is uitgeschreven en je hebt geen duiven meer in ${flight.name}. Je inzet van €${b.stake} is terugbetaald.`
        : `${name} is uitgeschreven voor ${flight.name}. Je inzet van €${b.stake} is terugbetaald.`;
    refundBet(db, b, body);
  }
}

/**
 * A whole flight was called off (too few rivals): refund + cancel every open bet
 * on it. Used from the schedule so a cancelled flight never strands open bets.
 */
export function refundFlightBets(db: Database, flight: Flight): void {
  for (const b of db.bets) {
    if (b.status !== 'open' || b.flightId !== flight.id) continue;
    refundBet(db, b, `${flight.name} is afgelast. Je inzet van €${b.stake} is terugbetaald.`);
  }
}

/**
 * One-time repair for bets placed before withdrawals refunded immediately:
 * refund + cancel every open bet whose bird is no longer taking part — the
 * flight was called off (completed with no results), the flight is gone, or the
 * bird(s) the bet needs are no longer entered in a still-scheduled/live flight.
 * Normally-finished flights already settle their own bets and are left alone.
 */
export function voidOrphanedBets(db: Database): void {
  for (const b of db.bets) {
    if (b.status !== 'open') continue;
    const flight = db.flights.find((f) => f.id === b.flightId);
    if (!flight) {
      refundBet(db, b, `De vlucht van je weddenschap bestaat niet meer. Je inzet van €${b.stake} is terugbetaald.`);
      continue;
    }
    if (flight.status === 'completed') {
      // A cancelled flight (no results) never ran settleFlightBets; refund those.
      if (flight.results.length === 0) {
        refundBet(db, b, `${flight.name} is afgelast. Je inzet van €${b.stake} is terugbetaald.`);
      }
      continue;
    }
    const entered = (id: string | null) => !!id && flight.entries.some((e) => e.pigeonId === id);
    let orphaned: boolean;
    let body: string;
    if (b.kind === 'mine_wins') {
      orphaned = !flight.entries.some((e) => e.ownerId === b.userId);
      body = `Je hebt geen ingeschreven duiven meer in ${flight.name}. Je inzet van €${b.stake} is terugbetaald.`;
    } else if (b.kind === 'head2head') {
      orphaned = !entered(b.pigeonId) || !entered(b.rivalId);
      body = `${b.pigeonName} of ${b.rivalName ?? 'de tegenstander'} is uitgeschreven voor ${flight.name}. Je inzet van €${b.stake} is terugbetaald.`;
    } else {
      orphaned = !entered(b.pigeonId);
      body = `${b.pigeonName} is uitgeschreven voor ${flight.name}. Je inzet van €${b.stake} is terugbetaald.`;
    }
    if (orphaned) refundBet(db, b, body);
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
