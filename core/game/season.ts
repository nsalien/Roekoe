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

import { LEAGUES, SEASON, SEASON_AWARDS, leagueAward, leagueDef } from '../config/gameConfig.js';
import type { LeagueId } from '../config/gameConfig.js';
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

/** The four league standings of the running season, keyed by league. */
export type LeagueRankings = Record<LeagueId, PigeonRankRow[]>;

/** Rank birds on one standing: points, then victories, then her best route average
 *  in it — enough to separate birds that ran the same handful of races. */
function rankOn(pick: (p: Pigeon) => { points: number; wins: number; best: number } | undefined) {
  return (a: Pigeon, b: Pigeon) => {
    const x = pick(a)!;
    const y = pick(b)!;
    return y.points - x.points || y.wins - x.wins || y.best - x.best;
  };
}

/**
 * The league standings (top `limit` per league) for the running season.
 *
 * Keyed by the league the points were earned in — a bird whose score moves her
 * up (or, with age, down) mid-season keeps what she banked and starts a fresh
 * entry in her new league, so she can legitimately appear in two lists at once.
 */
export function leagueRankings(db: Database, limit = 10): LeagueRankings {
  const botIds = new Set(db.lofts.filter((l) => l.isBot).map((l) => l.userId));
  const out = {} as LeagueRankings;
  for (const lg of LEAGUES) {
    const pick = (p: Pigeon) => p.leagues?.[lg.id];
    out[lg.id] = db.pigeons
      .filter((p) => (pick(p)?.points ?? 0) > 0)
      .sort(rankOn(pick))
      .slice(0, limit)
      .map((p) => ({
        pigeonId: p.id,
        name: p.name,
        ownerId: p.ownerId,
        ownerName: ownerName(db, p.ownerId),
        isBot: botIds.has(p.ownerId),
        value: pick(p)!.points,
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
 * Hand out the league standings of the season that just ended, then wipe them.
 *
 * Every paid place of every league pays its owner (`leagueAward`, the league's own
 * `awards` table); the top 3 also engrave
 * a title ON THE BIRD (`Pigeon.titles`), which follows her if she is ever sold.
 * Bots can win too (money, no bell). Every bird's league totals reset afterwards,
 * whether she placed or not: the standings run one season.
 */
function runLeagueSeasonEnd(
  db: Database,
  endedSeason: number,
  atIso: string,
  give: (loft: Loft, award: SeasonAward) => void,
): void {
  const rankings = leagueRankings(db, db.pigeons.length || 1);
  for (const lg of LEAGUES) {
    const paid = (rankings[lg.id] ?? []).filter((r) => r.value > 0).slice(0, lg.awards.length);
    paid.forEach((row, i) => {
      const pigeon = db.pigeons.find((p) => p.id === row.pigeonId);
      const loft = db.lofts.find((l) => l.userId === row.ownerId);
      // The title goes on the bird even when her owner has since vanished — it is
      // hers, not his. The money obviously needs a loft to land in.
      if (pigeon && i < CUP_METAL.length) {
        (pigeon.titles ??= []).push({
          kind: 'league',
          rank: i + 1,
          label: `${CUP_METAL[i]} Leagueduif ${lg.short}`,
          icon: CUP_MEDAL[i],
          season: endedSeason,
          at: atIso,
          league: lg.id,
          value: row.value,
        });
      }
      if (!loft) return;
      give(loft, {
        kind: 'league', rank: i + 1, season: endedSeason, at: atIso,
        reward: leagueAward(lg.id, i + 1), league: lg.id, pigeonName: row.name, value: row.value,
      });
    });
  }
  for (const p of db.pigeons) if (p.leagues) p.leagues = undefined;
}

/** The leeftijdscriterium's four age brackets and its cycle prizes — only
 *  `closeCriterium` still needs them, to hand out a running cycle one last time. */
const CRITERIUM_BRACKETS = [
  { id: 'u1', short: '< 1 j' },
  { id: 'y12', short: '1–2 j' },
  { id: 'y23', short: '2–3 j' },
  { id: 'o3', short: '3 j +' },
];
const CRITERIUM_AWARDS = [2000, 1600, 1200];

/**
 * ⚠️ LEGACY — closes the leeftijdscriterium for good (migration v67, when the
 * leagues replaced it; also v66, the early close of season 3).
 *
 * A cycle that has run at least ONE full season is handed out exactly as its own
 * end would have done: €2.000/€1.600/€1.200 to the owner of the top 3 per bracket
 * and a title on the bird. A cycle that has not (it was just handed out and
 * restarted) only holds a few days of points and is simply dropped — the owner
 * left the choice open; this is the call that neither throws away weeks of
 * standings nor pays a full prize for one race. Either way every criterium total
 * and the cycle anchor are wiped. One bell per player who won something.
 * `force` hands the standings out however long the cycle ran, labelled `season`
 * (v66: the owner had the criterium handed out with season 3, a season early).
 *
 * Writes absolute values on rows the request loaded, so two requests running the
 * migration at once land on the same result (one payment, one title).
 */
export function closeCriterium(
  db: Database,
  atMs: number,
  opts: { force?: boolean; season?: number } = {},
): void {
  const atIso = new Date(atMs).toISOString();
  const season = opts.season ?? db.world.seasonYear ?? 1;
  const ran = Number.isFinite(Date.parse(db.world.ageCupStartedAt ?? '')) &&
    (opts.force || (db.world.ageCupSeasonsDone ?? 0) >= 1);
  const lines = new Map<string, { text: string[]; money: number }>();
  if (ran) {
    for (const cat of CRITERIUM_BRACKETS) {
      const pick = (p: Pigeon) => p.cup?.[cat.id];
      const top = db.pigeons.filter((p) => (pick(p)?.points ?? 0) > 0).sort(rankOn(pick)).slice(0, 3);
      top.forEach((p, i) => {
        const value = pick(p)!.points;
        (p.titles ??= []).push({
          kind: 'criterium', rank: i + 1, label: `${CUP_METAL[i]} Criteriumduif ${cat.short}`,
          icon: CUP_MEDAL[i], season, at: atIso, ageCat: cat.id, value,
        });
        const loft = db.lofts.find((l) => l.userId === p.ownerId);
        if (!loft) return;
        const reward = CRITERIUM_AWARDS[i];
        loft.money += reward;
        (loft.awards ??= []).push({
          kind: 'criterium', rank: i + 1, season, at: atIso, reward, ageCat: cat.id, pigeonName: p.name, value,
        });
        if (loft.isBot) return;
        const l = lines.get(loft.userId) ?? { text: [], money: 0 };
        l.text.push(`${CUP_MEDAL[i]} ${CUP_METAL[i]} Criteriumduif ${cat.short} met ${p.name} (${value} punten)`);
        l.money += reward;
        lines.set(loft.userId, l);
      });
    }
  }
  for (const p of db.pigeons) if (p.cup) p.cup = undefined;
  db.world.ageCupStartedAt = '';
  db.world.ageCupSeasonsDone = 0;
  for (const [userId, l] of lines) {
    seasonNotify(
      db, userId, '🏆 Eindstand van het leeftijdscriterium',
      `Het leeftijdscriterium maakt plaats voor de leagues, dus de lopende stand is nu uitgereikt. ` +
        `Je won: ${l.text.join(' · ')}. Totaal: €${l.money}. De titels staan op je duiven.`,
      `ntf:criterium:close:${userId}`,
    );
  }
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
  // 1b. Seizoenspremie: everyone else with points gets points ÷ 3 (rounded down),
  //     so a season of flying pays even outside the podium of the standings.
  for (let i = 3; i < standings.length; i++) {
    const loft = standings[i];
    const reward = Math.floor(loft.seasonPoints / SEASON_AWARDS.pointsPremiumDivisor);
    if (reward <= 0) continue;
    give(loft, {
      kind: 'premie', rank: i + 1, season: endedSeason, at: atIso,
      reward, value: loft.seasonPoints,
    });
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

  // 2b. Leagues → the paid places of every league (a title for the top 3); then
  //     the league standings reset. It shares the prijsuitreiking message below.
  runLeagueSeasonEnd(db, endedSeason, atIso, give);

  // 3. Notify each human winner (one consolidated message per loft).
  for (const [userId, awards] of perLoft) {
    const money = awards.reduce((s, a) => s + a.reward, 0);
    const lines = awards.map((a) => {
      if (a.kind === 'roekoe') return `🏆 ${ROEKOE_NAME[a.rank - 1]} (${a.value} punten)`;
      if (a.kind === 'premie') return `💰 Seizoenspremie (${a.value} punten, ${a.rank}e plaats)`;
      if (a.kind === 'league') {
        const def = leagueDef(a.league ?? 'l60');
        return a.rank <= CUP_METAL.length
          ? `${CUP_MEDAL[a.rank - 1]} ${CUP_METAL[a.rank - 1]} Leagueduif ${def.short} met ${a.pigeonName} (${a.value} punten)`
          : `💰 Leaguepremie ${def.short}: ${a.rank}e plaats met ${a.pigeonName} (${a.value} punten)`;
      }
      return `🪽 ${WING_NAME[a.rank - 1]} — ${WING_LABEL[a.category!]} met ${a.pigeonName}`;
    });
    seasonNotify(
      db, userId,
      `🎉 Prijsuitreiking seizoen ${endedSeason}!`,
      `${awards.some((a) => a.kind !== 'premie') ? 'Proficiat! Je won' : 'Bedankt om mee te vliegen! Je krijgt'}: ${lines.join(' · ')}. Totaal prijzengeld: €${money}. Het nieuwe seizoen ${endedSeason + 1} is begonnen — de ranglijst en de leagues staan weer op nul.`,
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
 * End the running season NOW instead of at its natural end, and start the next
 * one from this instant (owner, 24 okt: "Sluit seizoen 3 af en start seizoen 4").
 *
 * The same ceremony as `tickSeason` (Roekoes, premies, Vleugels, leagues, sponsor
 * review, reset), only anchored on `nowMs`: the new season runs a full SEASON_MS
 * from here. The review stamps a sponsor that walks out with `atMs`, which is
 * exactly the new `seasonStartedAt` — the invariant v53 relies on still holds.
 */
export function endSeasonNow(db: Database, nowMs: number): void {
  const w = db.world;
  runSeasonEnd(db, w.seasonYear, nowMs);
  w.seasonYear += 1;
  w.seasonStartedAt = new Date(nowMs).toISOString();
  w.seasonEndsAt = new Date(nowMs + SEASON_MS).toISOString();
  w.seasonWeek = 1;
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
