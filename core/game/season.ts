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

import { AGE_CATEGORIES, AGE_CUP, SEASON, SEASON_AWARDS, ageCategoryDef } from '../config/gameConfig.js';
import type { AgeCategoryId } from '../config/gameConfig.js';
import type { Database, Loft, Pigeon, SeasonAward, WingCategory } from '../schema.js';
import { awardBadge } from './badges.js';
import { ownerName } from './engine.js';
import { seasonScore } from './pigeon.js';
import { reviewSponsorContracts } from './sponsors.js';
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
  fastest: PigeonRankRow[]; // best average flight speed this season (km/h) — the top per-race route average, not an instantaneous peak
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
    // Only competition flights count: subtract the development gained from
    // oefenvluchten (training flights) so they don't inflate the ranking.
    .map((p) => base(p, round1(seasonScore(p) - (p.seasonStartScore ?? seasonScore(p)) - (p.seasonPracticeGain ?? 0))))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  return { fastest, podiums, progress };
}

/** The four leeftijdscriterium standings, keyed by age bracket. */
export type CupRankings = Record<AgeCategoryId, PigeonRankRow[]>;

/**
 * The leeftijdscriterium standings (top `limit` per bracket).
 *
 * Unlike the three season rankings above, these run for a full CYCLE of
 * AGE_CUP.seasons and are keyed by the bracket the points were earned in — a
 * bird that ages up mid-cycle keeps what she banked and starts a fresh entry one
 * bracket higher, so she can legitimately appear in two lists at once.
 *
 * Ranked on points, then victories, then her best route average in that bracket
 * — enough to separate birds that ran the same handful of races.
 */
export function ageCupRankings(db: Database, limit = 10): CupRankings {
  const botIds = new Set(db.lofts.filter((l) => l.isBot).map((l) => l.userId));
  const out = {} as CupRankings;
  for (const cat of AGE_CATEGORIES) {
    out[cat.id] = db.pigeons
      .filter((p) => (p.cup?.[cat.id]?.points ?? 0) > 0)
      .sort((a, b) => {
        const x = a.cup![cat.id]!;
        const y = b.cup![cat.id]!;
        return y.points - x.points || y.wins - x.wins || y.best - x.best;
      })
      .slice(0, limit)
      .map((p) => ({
        pigeonId: p.id,
        name: p.name,
        ownerId: p.ownerId,
        ownerName: ownerName(db, p.ownerId),
        isBot: botIds.has(p.ownerId),
        value: p.cup![cat.id]!.points,
      }));
  }
  return out;
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
const CUP_METAL = ['Gouden', 'Zilveren', 'Bronzen'];
const CUP_MEDAL = ['🥇', '🥈', '🥉'];

/**
 * Close the leeftijdscriterium cycle if the season that just ended was its last.
 *
 * The criterium runs over AGE_CUP.seasons (3) seasons because each bracket gets
 * only ONE race a week — a single season is 4 races, far too few to separate a
 * field. When the cycle is up, the top 3 of every bracket pay their owner and,
 * crucially, engrave a title ON THE BIRD (`Pigeon.titles`), which follows her if
 * she is ever sold. Then every criterium total is wiped and the next cycle starts.
 *
 * Returns the awards it handed out, per loft, so the caller can fold them into
 * the one consolidated prijsuitreiking message a player gets.
 */
function runAgeCupCycleEnd(
  db: Database,
  endedSeason: number,
  atMs: number,
  atIso: string,
  give: (loft: Loft, award: SeasonAward) => void,
): boolean {
  // Only count seasons the criterium actually ran through. The anchor sits ON a
  // season boundary, so the season that ends exactly when the cycle STARTS is the
  // one before it and must not be counted — hence the strict comparison.
  const started = Date.parse(db.world.ageCupStartedAt ?? '');
  if (!Number.isFinite(started) || atMs <= started) return false;
  const done = (db.world.ageCupSeasonsDone ?? 0) + 1;
  if (done < AGE_CUP.seasons) {
    db.world.ageCupSeasonsDone = done;
    return false;
  }

  const rankings = ageCupRankings(db, db.pigeons.length || 1);
  for (const cat of AGE_CATEGORIES) {
    const top = (rankings[cat.id] ?? []).filter((r) => r.value > 0).slice(0, 3);
    top.forEach((row, i) => {
      const pigeon = db.pigeons.find((p) => p.id === row.pigeonId);
      const loft = db.lofts.find((l) => l.userId === row.ownerId);
      // The title goes on the bird even when her owner has since vanished — it is
      // hers, not his. The money obviously needs a loft to land in.
      if (pigeon) {
        (pigeon.titles ??= []).push({
          kind: 'criterium',
          rank: i + 1,
          label: `${CUP_METAL[i]} Criteriumduif ${cat.short}`,
          icon: CUP_MEDAL[i],
          season: endedSeason,
          at: atIso,
          ageCat: cat.id,
          value: row.value,
        });
      }
      if (!loft) return;
      give(loft, {
        kind: 'criterium', rank: i + 1, season: endedSeason, at: atIso,
        reward: AGE_CUP.awards[i], ageCat: cat.id, pigeonName: row.name, value: row.value,
      });
    });
  }

  // Wipe every bracket's totals and re-anchor the next cycle on this boundary, so
  // its week index — and with it the sprint/fond alternation — restarts cleanly.
  for (const p of db.pigeons) if (p.cup) p.cup = undefined;
  db.world.ageCupSeasonsDone = 0;
  db.world.ageCupStartedAt = atIso;
  return true;
}

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

  // 1. Melker standings → Roekoes. Bots race for the prize money just like
  //    players (they need income too); they simply get no notification.
  const standings = db.lofts
    .filter((l) => l.seasonPoints > 0)
    .sort((a, b) => b.seasonPoints - a.seasonPoints || (b.seasonWins ?? 0) - (a.seasonWins ?? 0));
  for (let i = 0; i < 3; i++) {
    const loft = standings[i];
    if (!loft) break;
    give(loft, {
      kind: 'roekoe', rank: i + 1, season: endedSeason, at: atIso,
      reward: SEASON_AWARDS.roekoe[i], value: loft.seasonPoints,
    });
    if (i === 0) awardBadge(db, loft, 'season_champion');
  }

  // 2. Pigeon rankings → Vleugels (top-3 of each ranking, over every pigeon;
  //    bot-owned birds can win too). Ranked over the whole field, not just the
  //    displayed top-10.
  const rankings = pigeonSeasonRankings(db, db.pigeons.length || 1);
  const cats: { key: WingCategory; rows: PigeonRankRow[] }[] = [
    { key: 'speed', rows: rankings.fastest },
    { key: 'podium', rows: rankings.podiums },
    { key: 'progress', rows: rankings.progress },
  ];
  for (const { key, rows } of cats) {
    const top = rows.filter((r) => r.value > 0).slice(0, 3);
    top.forEach((row, i) => {
      const loft = db.lofts.find((l) => l.userId === row.ownerId);
      if (!loft) return;
      give(loft, {
        kind: 'vleugel', rank: i + 1, season: endedSeason, at: atIso,
        reward: SEASON_AWARDS.vleugel[i], category: key, pigeonName: row.name, value: row.value,
      });
    });
  }

  // 2b. Leeftijdscriterium → only every AGE_CUP.seasons seasons, when the cycle
  //     is up. It shares the prijsuitreiking message below.
  const cupClosed = runAgeCupCycleEnd(db, endedSeason, atMs, atIso, give);

  // 3. Notify each human winner (one consolidated message per loft).
  for (const [userId, awards] of perLoft) {
    const money = awards.reduce((s, a) => s + a.reward, 0);
    const lines = awards.map((a) => {
      if (a.kind === 'roekoe') return `🏆 ${ROEKOE_NAME[a.rank - 1]} (${a.value} punten)`;
      if (a.kind === 'criterium') {
        const def = ageCategoryDef(a.ageCat ?? 'u1');
        return `${CUP_MEDAL[a.rank - 1]} ${CUP_METAL[a.rank - 1]} Criteriumduif ${def.short} met ${a.pigeonName} (${a.value} punten)`;
      }
      return `🪽 ${WING_NAME[a.rank - 1]} — ${WING_LABEL[a.category!]} met ${a.pigeonName}`;
    });
    seasonNotify(
      db, userId,
      `🎉 Prijsuitreiking seizoen ${endedSeason}!`,
      `Proficiat! Je won: ${lines.join(' · ')}. Totaal prijzengeld: €${money}. Het nieuwe seizoen ${endedSeason + 1} is begonnen — de ranglijst staat weer op nul.` +
        (cupClosed ? ' Ook het leeftijdscriterium is afgelopen: die stand begint aan een nieuwe cyclus van drie seizoenen.' : ''),
      `ntf:season:${endedSeason}:${userId}`,
    );
  }

  // 4. Sponsors review the just-ended season (before the points reset): a
  //    sponsor may end its contract if the loft underperformed vs last season.
  for (const loft of db.lofts) reviewSponsorContracts(db, loft, endedSeason, atMs);

  // 5. Reset all season standings and re-baseline pigeon development. `totalWins`
  //    is NOT touched — it is the lifetime counter sponsors are gated on.
  for (const loft of db.lofts) { loft.seasonPoints = 0; loft.seasonWins = 0; }
  for (const p of db.pigeons) {
    p.seasonPeakSpeed = 0;
    p.seasonPodiums = 0;
    p.seasonStartScore = seasonScore(p);
    p.seasonPracticeGain = 0;
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
      p.seasonPracticeGain ??= 0;
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
