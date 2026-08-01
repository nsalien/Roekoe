/**
 * Seasons in real time.
 *
 * A season lasts `SEASON.weeks` weeks of `SEASON.weekDays` real days each. The
 * displayed "week 1..4" and the time remaining are derived from `seasonStartedAt`
 * on every request (see `tickSeason`). When the last week is over, the season's
 * prijsuitreiking runs (`runSeasonEnd`): the top-3 melkers win a Roekoe and the
 * top-3 pigeons in each of three rankings win a Vleugel — with coins to the
 * owner — after which the standings reset and a fresh season begins.
 *
 * The season timeline is independent from `world.currentWeek`, which stays a
 * monotonic game-week counter (it drives ages, ailments and flight weeks).
 */

import { SEASON, SEASON_AWARDS } from '../config/gameConfig.js';
import type { Database, Loft, Pigeon, SeasonAward, WingCategory } from '../schema.js';
import { awardBadge } from './badges.js';
import { ownerName } from './engine.js';
import { seasonScore } from './pigeon.js';
import { round1 } from './util.js';

const DAY_MS = 86400000;
const WEEK_MS = SEASON.weekDays * DAY_MS;
const SEASON_MS = SEASON.weeks * WEEK_MS;

/** One row in a pigeon ranking. */
export interface PigeonRankRow {
  pigeonId: string;
  name: string;
  ownerId: string;
  ownerName: string;
  isBot: boolean;
  value: number; // km/h (speed), count (podiums) or points gained (progress)
}

export interface PigeonRankings {
  fastest: PigeonRankRow[]; // highest peak speed this season (km/h)
  podiums: PigeonRankRow[]; // most top-3 finishes this season
  progress: PigeonRankRow[]; // biggest overall development this season
}

const WING_LABEL: Record<WingCategory, string> = {
  speed: 'snelste duif',
  podium: 'meeste podiums',
  progress: 'meeste vooruitgang',
};

/** The three live pigeon rankings for the current season (top `limit` each). */
export function pigeonSeasonRankings(db: Database, limit = 10): PigeonRankings {
  const botIds = new Set(db.lofts.filter((l) => l.isBot).map((l) => l.userId));
  const base = (p: Pigeon, value: number): PigeonRankRow => ({
    pigeonId: p.id,
    name: p.name,
    ownerId: p.ownerId,
    ownerName: ownerName(db, p.ownerId),
    isBot: botIds.has(p.ownerId),
    value,
  });

  const fastest = db.pigeons
    .filter((p) => (p.seasonPeakSpeed ?? 0) > 0)
    .map((p) => base(p, round1((p.seasonPeakSpeed ?? 0) * 0.06))) // m/min → km/h
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  const podiums = db.pigeons
    .filter((p) => (p.seasonPodiums ?? 0) > 0)
    .map((p) => base(p, p.seasonPodiums ?? 0))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  const progress = db.pigeons
    .map((p) => base(p, round1(seasonScore(p) - (p.seasonStartScore ?? seasonScore(p)))))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  return { fastest, podiums, progress };
}

/** Stable, idempotent season notification (survives a double ceremony run). */
function seasonNotify(db: Database, userId: string, title: string, body: string, id: string): void {
  const existing = db.notifications.find((n) => n.id === id);
  const note = {
    id, userId, kind: 'info' as const, title, body, flightId: null,
    createdAt: new Date().toISOString(), read: existing?.read ?? false,
  };
  if (existing) Object.assign(existing, note);
  else db.notifications.push(note);
  const mine = db.notifications.filter((n) => n.userId === userId);
  if (mine.length > 40) {
    const drop = new Set(mine.slice(0, mine.length - 40).map((n) => n.id));
    db.notifications = db.notifications.filter((n) => !drop.has(n.id));
  }
}

const ROEKOE_NAME = ['de Gouden Roekoe', 'de Zilveren Roekoe', 'de Bronzen Roekoe'];
const WING_NAME = ['de Gouden Vleugel', 'de Zilveren Vleugel', 'de Bronzen Vleugel'];

/**
 * Hold the prijsuitreiking for the season that just ended, then reset all season
 * standings. Awards go to the top-3 melkers (Roekoe) and to the owners of the
 * top-3 pigeons in each of the three pigeon rankings (Vleugel). Bots can occupy
 * a podium spot but never receive a prize.
 */
export function runSeasonEnd(db: Database, endedSeason: number, atMs: number): void {
  const atIso = new Date(atMs).toISOString();
  const perLoft = new Map<string, SeasonAward[]>();
  const give = (loft: Loft, award: SeasonAward) => {
    loft.money += award.reward;
    (loft.awards ??= []).push(award);
    if (!loft.isBot) {
      const arr = perLoft.get(loft.userId) ?? [];
      arr.push(award);
      perLoft.set(loft.userId, arr);
    }
  };

  // 1. Melker standings → Roekoes. The prize is a players' competition: bots
  //    appear in the ranking for context but never occupy a podium spot, so the
  //    Gouden/Zilveren/Bronzen Roekoe always go to the three best players.
  const standings = db.lofts
    .filter((l) => !l.isBot && l.seasonPoints > 0)
    .sort((a, b) => b.seasonPoints - a.seasonPoints || b.totalWins - a.totalWins);
  for (let i = 0; i < 3; i++) {
    const loft = standings[i];
    if (!loft) break;
    give(loft, {
      kind: 'roekoe', rank: i + 1, season: endedSeason, at: atIso,
      reward: SEASON_AWARDS.roekoe[i], value: loft.seasonPoints,
    });
    if (i === 0) awardBadge(db, loft, 'season_champion');
  }

  // 2. Pigeon rankings → Vleugels (top-3 PLAYER-owned pigeon of each ranking;
  //    bot pigeons appear in the ranking but win no prize). Ranked over every
  //    player pigeon, not just the displayed top-10.
  const rankings = pigeonSeasonRankings(db, db.pigeons.length || 1);
  const cats: { key: WingCategory; rows: PigeonRankRow[] }[] = [
    { key: 'speed', rows: rankings.fastest },
    { key: 'podium', rows: rankings.podiums },
    { key: 'progress', rows: rankings.progress },
  ];
  for (const { key, rows } of cats) {
    const owned = rows.filter((r) => !r.isBot && r.value > 0).slice(0, 3);
    owned.forEach((row, i) => {
      const loft = db.lofts.find((l) => l.userId === row.ownerId);
      if (!loft) return;
      give(loft, {
        kind: 'vleugel', rank: i + 1, season: endedSeason, at: atIso,
        reward: SEASON_AWARDS.vleugel[i], category: key, pigeonName: row.name, value: row.value,
      });
    });
  }

  // 3. Notify each human winner (one consolidated message per loft).
  for (const [userId, awards] of perLoft) {
    const money = awards.reduce((s, a) => s + a.reward, 0);
    const lines = awards.map((a) => {
      if (a.kind === 'roekoe') return `🏆 ${ROEKOE_NAME[a.rank - 1]} (${a.value} punten)`;
      return `🪽 ${WING_NAME[a.rank - 1]} — ${WING_LABEL[a.category!]} met ${a.pigeonName}`;
    });
    seasonNotify(
      db, userId,
      `🎉 Prijsuitreiking seizoen ${endedSeason}!`,
      `Proficiat! Je won: ${lines.join(' · ')}. Totaal prijzengeld: €${money}. Het nieuwe seizoen ${endedSeason + 1} is begonnen — de ranglijst staat weer op nul.`,
      `ntf:season:${endedSeason}:${userId}`,
    );
  }

  // 4. Reset all season standings and re-baseline pigeon development.
  for (const loft of db.lofts) loft.seasonPoints = 0;
  for (const p of db.pigeons) {
    p.seasonPeakSpeed = 0;
    p.seasonPodiums = 0;
    p.seasonStartScore = seasonScore(p);
  }
}

/**
 * Advance the real-time season clock. Anchors the first season, keeps the
 * derived `seasonWeek`/`seasonEndsAt` up to date, and runs the prijsuitreiking
 * (with a catch-up loop) whenever one or more seasons have elapsed.
 */
export function tickSeason(db: Database, nowMs: number): void {
  const w = db.world;

  // First run (or freshly migrated): anchor now and baseline every pigeon.
  if (!w.seasonStartedAt) {
    w.seasonStartedAt = new Date(nowMs).toISOString();
    w.seasonEndsAt = new Date(nowMs + SEASON_MS).toISOString();
    w.seasonWeek = 1;
    for (const p of db.pigeons) {
      p.seasonStartScore ??= seasonScore(p);
      p.seasonPeakSpeed ??= 0;
      p.seasonPodiums ??= 0;
    }
    return;
  }

  let start = Date.parse(w.seasonStartedAt);
  if (Number.isNaN(start)) {
    start = nowMs;
    w.seasonStartedAt = new Date(nowMs).toISOString();
  }

  // Roll over as many seasons as have fully elapsed (catch-up after downtime).
  let guard = 0;
  while (nowMs >= start + SEASON_MS && guard++ < 24) {
    runSeasonEnd(db, w.seasonYear, start + SEASON_MS);
    w.seasonYear += 1;
    start += SEASON_MS;
    w.seasonStartedAt = new Date(start).toISOString();
  }

  w.seasonEndsAt = new Date(start + SEASON_MS).toISOString();
  const wk = Math.floor((nowMs - start) / WEEK_MS) + 1;
  w.seasonWeek = Math.min(SEASON.weeks, Math.max(1, wk));
}
