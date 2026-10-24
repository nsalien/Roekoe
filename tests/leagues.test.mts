/**
 * Leagues (LEAGUE) — de vervanger van het leeftijdscriterium (24 okt).
 *
 * Vier klassen volgens de ALGEMENE SCORE (★) van een duif — t/m 60 · 61–70 ·
 * 71–80 · 81+ — met per league één vlucht per week, die week om week wisselt
 * tussen een sprint en een grote fond. De stand loopt één seizoen; prijzengeld
 * schaalt met de league, en een league vliegt pas met minstens 4 duiven van
 * minstens 3 melkers.
 *
 * Wat deze test bewaakt, in de volgorde waarin het stuk kan gaan:
 *  1. de klassen: de grenzen per decimaal, de geschaalde prijzen en eindprijzen;
 *  2. de kalender: vier leaguevluchten per week op hun eigen dag, geen criterium
 *     meer, en sprint/fond volgens de week van het seizoen;
 *  3. de scoregrens: een duif buiten haar league raakt er niet in — ook geen botduif;
 *  4. minstens 4 duiven van 3 melkers bij de lossing, anders afgelast + terugbetaald,
 *     met de reden (welk minimum) erbij;
 *  5. prijzengeld ja, seizoenspunten/overwinningen/weddenschappen nee, medaille ja,
 *     en de leaguepunten belanden bij de DUIF;
 *  6. de uitreiking op het einde van het seizoen: geld, een titel, een schone lei;
 *  7. migratie v67: het criterium uitgereikt (of niet), de geplande vluchten weg
 *     met terugbetaling, de aankondiging, en een criteriumvlucht die al vloog;
 *  8. de bel, de wiki en de spelregels zeggen hetzelfde als LEAGUE.
 *
 * Run (vanuit de repo-root): npx tsx tests/leagues.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from '../core/d1.js';
import { seedWorld, createLoftForUser, enterFlight } from '../core/game/engine.js';
import { advanceRealtime, tickFlights } from '../core/game/schedule.js';
import { leagueRankings, runSeasonEnd } from '../core/game/season.js';
import { bettingOpen } from '../core/game/betting.js';
import { botEntryContext, botRaceCandidates } from '../core/game/bots.js';
import { LEAGUE_NEWS } from '../core/game/news.js';
import {
  LEAGUE, LEAGUES, SEASON, TIMEZONE, leagueAward, leagueFor, leagueMinScore, leaguePrizes, leagueRangeText, prizeForRank,
  type LeagueId,
} from '../core/config/gameConfig.js';
import { generatePigeon, talent } from '../core/game/pigeon.js';
import { newId } from '../core/store.js';
import type { Database, Flight, Pigeon, User } from '../core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (q: string) => { const b: unknown[] = []; const api: any = {
    bind(...a: unknown[]) { b.push(...a); return api; },
    async first() { return sql.prepare(q).get(...(b as any[])) ?? null; },
    async all() { return { results: sql.prepare(q).all(...(b as any[])) }; },
    run() { return sql.prepare(q).run(...(b as any[])); } }; return api; };
  return { prepare, async exec(q: string) { sql.exec(q); }, async batch(s: any[]) { for (const x of s) x.run(); }, _raw: sql };
}

const DAY = 86400000;
const WEEK = SEASON.weekDays * DAY;
/** The coming Saturday 10:00 UTC — from TODAY, not a fixed date: a fixed date in
 *  the past is the time bomb that broke the old age-cup test. The season starts
 *  right there, so the four league races of week 0 are Mon–Fri after it. */
const T0 = (() => {
  const d = new Date();
  d.setUTCHours(10, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
  return d.getTime();
})();

/** A bird with exactly this algemene score (the three skills equal). */
function bird(ownerId: string, week: number, score: number): Pigeon {
  const p = generatePigeon({ ownerId, currentWeek: week, quality: 0.6, birthWeek: week - 60 });
  p.speed = p.endurance = p.orientation = score;
  p.genes = { speed: 95, endurance: 95, orientation: 95 };
  p.form = 100; p.health = 100; p.ailment = null; p.inInfirmary = false;
  return p;
}

/** A fresh world: 8 bots + 4 players, each player with one bird per league. */
async function freshWorld() {
  const d1 = fakeD1();
  d1._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  d1._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,0)').run();
  while (!(await ensureSchema(d1))) {}
  let store = await D1Store.load(d1, undefined); seedWorld(store); await store.persist();
  store = await D1Store.load(d1, undefined);
  const humans: string[] = [];
  for (let i = 0; i < 4; i++) {
    const u: User = { id: newId('usr'), username: `s${i}`, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString() };
    store.mutate((d) => d.users.push(u)); createLoftForUser(store, u, `Hok ${i}`); humans.push(u.id);
  }
  store.mutate((d) => {
    const week = d.world.currentWeek;
    for (const uid of humans) {
      const loft = d.lofts.find((l) => l.userId === uid)!;
      loft.capacity = 20; loft.money = 50_000;
      for (const score of [55, 65, 75, 85]) d.pigeons.push(bird(uid, week, score));
    }
    d.world.seasonStartedAt = new Date(T0).toISOString();
    d.world.seasonEndsAt = new Date(T0 + SEASON.weeks * WEEK).toISOString();
    d.world.seasonWeek = 1;
  });
  await store.persist();
  const load = async (viewer?: string) => D1Store.load(d1, viewer);
  async function tick(nowMs: number, viewer = humans[0]): Promise<Database> {
    const s = await load(viewer);
    advanceRealtime(s.data, nowMs, new Map());
    await s.persist();
    return s.data;
  }
  return { d1, humans, load, tick };
}

/** A score that sits comfortably inside league `id`. */
const scoreIn = (id: LeagueId) => ({ l60: 55, l70: 65, l80: 75, l81: 85 } as const)[id];

/** Freeze a deterministic race on `flight`: entry i finishes i minutes after entry 0. */
function freeze(flight: Flight, field: Pigeon[]): void {
  flight.entries = field.map((p) => ({ pigeonId: p.id, ownerId: p.ownerId }));
  flight.status = 'live';
  flight.sim = field.map((p, i) => ({
    pigeonId: p.id, ownerId: p.ownerId, pigeonName: p.name, ownerName: 'x',
    velocity: 1000, durationSeconds: 3600 + i * 60,
    startForm: 100, formCost: 20, formDrained: 20,
  })) as any;
}

// ---------------------------------------------------------------------------
console.log('\n1. De klassen: grenzen per decimaal, prijzen per league');
{
  const cases: [number, LeagueId][] = [
    [0, 'l60'], [44.5, 'l60'], [60, 'l60'], [60.1, 'l70'], [70, 'l70'], [70.1, 'l80'],
    [80, 'l80'], [80.1, 'l81'], [95, 'l81'],
  ];
  ok(cases.every(([s, id]) => leagueFor(s) === id), `de grenzen kloppen: ${cases.map(([s, id]) => `★${s}→${id}`).join(' · ')}`);
  ok(LEAGUES.length === 4 && LEAGUES.map((l) => l.weekday).join() === '1,3,4,5', 'vier leagues, op ma/wo/do/vr');
  ok(leagueMinScore('l60') === 0 && leagueMinScore('l70') === 60.1 && leagueMinScore('l81') === 80.1, 'de ondergrens van elke league ligt net boven de vorige');
  ok(leagueRangeText('l60') === '★60 of lager' && leagueRangeText('l70') === '★60,1 tot en met ★70' && leagueRangeText('l81') === '★80,1 of hoger',
     `de grenzen in woorden: "${LEAGUES.map((l) => leagueRangeText(l.id)).join('" · "')}"`);
  // The top league pays the base tables untouched; the others their factor, on €5.
  const topSprint = leaguePrizes('l81', true), topFond = leaguePrizes('l81', false);
  ok(JSON.stringify(topSprint) === JSON.stringify(LEAGUE.sprint.prizes) && JSON.stringify(topFond) === JSON.stringify(LEAGUE.fond.prizes),
     'de hoogste league betaalt de basistabellen');
  ok(LEAGUES.map((l) => l.factor).join() === '0.5,0.7,0.85,1', 'de verhouding is ×0,5 / ×0,7 / ×0,85 / ×1 (de keuze van de eigenaar)');
  let scaled = true, round5 = true, monotone = true, everyonePays = true, higherPaysMore = true;
  for (const sprint of [true, false]) {
    for (const lg of LEAGUES) {
      const t = leaguePrizes(lg.id, sprint);
      for (let r = 1; r <= 40; r++) {
        const x = prizeForRank(t, r);
        if (x % 5 !== 0) round5 = false;
        if (x <= 0) everyonePays = false;
        if (r > 1 && x > prizeForRank(t, r - 1)) monotone = false;
        const base = prizeForRank(sprint ? LEAGUE.sprint.prizes : LEAGUE.fond.prizes, r);
        if (Math.abs(x - base * lg.factor) > 2.5) scaled = false;
      }
    }
    for (let i = 1; i < LEAGUES.length; i++) {
      if (prizeForRank(leaguePrizes(LEAGUES[i].id, sprint), 1) <= prizeForRank(leaguePrizes(LEAGUES[i - 1].id, sprint), 1)) higherPaysMore = false;
    }
  }
  ok(scaled && round5, 'elke plaats = basis × factor, afgerond op €5');
  ok(monotone && everyonePays, 'de tabellen lopen monotoon af en élke finisher verdient iets');
  ok(higherPaysMore, 'een hogere league betaalt een zege altijd beter');
  ok(prizeForRank(leaguePrizes('l60', true), 1) === 500 && prizeForRank(leaguePrizes('l60', false), 1) === 800,
     `league ★ t/m 60: zege €${prizeForRank(leaguePrizes('l60', true), 1)} (sprint) / €${prizeForRank(leaguePrizes('l60', false), 1)} (fond)`);
  ok(leagueAward('l81', 1) === 1600 && leagueAward('l81', 3) === 950 && leagueAward('l60', 1) === 800 && leagueAward('l80', 2) === 1100,
     `eindprijzen podium: ${LEAGUES.map((l) => `${l.short} €${[1, 2, 3].map((r) => leagueAward(l.id, r)).join('/')}`).join(' · ')}`);
  ok(leagueAward('l81', 4) === 400 && leagueAward('l81', 10) === 150 && leagueAward('l60', 10) === 75 && leagueAward('l81', 11) === 0,
     `plaats 4–10 krijgt ook iets (★ 81+: €${[4, 5, 6, 7, 10].map((r) => leagueAward('l81', r)).join('/')}), plaats 11 niets`);
  ok(LEAGUES.every((l) => l.awards.length === 10 && l.awards.every((x, i) => i === 0 || x <= l.awards[i - 1])),
     'tien betaalde plaatsen per league, en een lagere plaats betaalt nooit meer');
  ok(LEAGUES.every((l, k) => k === 0 || l.awards.every((x, i) => x > LEAGUES[k - 1].awards[i])),
     'een hogere league betaalt op elke plaats meer');
  ok(LEAGUES.every((l) => l.awards.every((x) => x % (x >= 500 ? 50 : 25) === 0)),
     'mooi afgerond: vanaf €500 op €50, daaronder op €25');
  ok(LEAGUE.minBirds === 4 && LEAGUE.minOwners === 3 && LEAGUE.entryFee === 20,
     `minstens ${LEAGUE.minBirds} duiven van ${LEAGUE.minOwners} melkers, €${LEAGUE.entryFee} inschrijving`);
}

// ---------------------------------------------------------------------------
console.log('\n2. Vier leaguevluchten per week, sprint en fond om beurten');
const W = await freshWorld();
let SEEN: Flight[] = [];
{
  const seen = new Map<string, Flight>();
  let db = await W.tick(T0);
  ok((db.world.dataVersion ?? 0) >= 67, `de migraties lopen tot v67 (${db.world.dataVersion})`);
  for (let d = 0; d <= 14; d++) {
    db = await W.tick(T0 + d * DAY + 3600000);
    for (const f of db.flights) if (f.league) seen.set(f.templateKey, f);
    ok(d > 0 || !db.flights.some((f) => f.ageCat), 'er wordt geen enkele criteriumvlucht meer gepland');
  }
  const lg = [...seen.values()];
  SEEN = lg;
  ok(lg.length >= 8, `${lg.length} leaguevluchten gezien over twee weken`);
  ok(new Set(lg.map((f) => f.league)).size === 4, 'alle vier de leagues komen aan bod');
  ok(lg.every((f) => f.entryFee === LEAGUE.entryFee && !f.titan && !f.relay && !f.practice), `elk inschrijfgeld is €${LEAGUE.entryFee}, geen ander format`);
  const brussels = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const rightSlot = lg.every((f) => {
    const parts = brussels.formatToParts(new Date(f.startAt));
    const wd = parts.find((p) => p.type === 'weekday')!.value;
    const hh = parts.find((p) => p.type === 'hour')!.value;
    const def = LEAGUES.find((l) => l.id === f.league)!;
    return wd === WD[def.weekday] && Number(hh) === LEAGUE.hour;
  });
  ok(rightSlot, 'elke league vliegt op haar eigen weekdag om 06:00 (Brussel)');
  const perWeek = new Map<string, number>();
  for (const f of lg) {
    const k = `${f.league}:${Math.floor((Date.parse(f.startAt) - T0) / WEEK)}`;
    perWeek.set(k, (perWeek.get(k) ?? 0) + 1);
  }
  ok([...perWeek.values()].every((n) => n === 1), 'per league precies één vlucht per week');
  const formatOk = lg.every((f) => f.leagueSprint === (Math.floor((Date.parse(f.startAt) - T0) / WEEK) % 2 === 0));
  ok(formatOk, 'week 1 van het seizoen is een sprint, week 2 een grote fond');
  const byWeek = new Map<number, Set<boolean>>();
  for (const f of lg) {
    const wi = Math.floor((Date.parse(f.startAt) - T0) / WEEK);
    (byWeek.get(wi) ?? byWeek.set(wi, new Set()).get(wi)!).add(!!f.leagueSprint);
  }
  ok([...byWeek.values()].every((v) => v.size === 1), 'binnen één week vliegen alle leagues hetzelfde format');
  ok(lg.every((f) => {
    const w = f.leagueSprint ? LEAGUE.sprint : LEAGUE.fond;
    return f.distanceKm >= w.minKm - 30 && f.distanceKm <= w.maxKm + 30;
  }), `de afstanden passen bij het format (${lg.map((f) => `${f.leagueSprint ? 'S' : 'F'}${f.distanceKm}`).join(' ')})`);
  ok(lg.every((f) => /^League ★/.test(f.name) && /Sprint|Grote fond/.test(f.name)), `de naam zegt welke league en welk format ("${lg[0]?.name}")`);
  ok(lg.every((f) => !bettingOpen(f, Date.parse(f.startAt) - 3600000)), 'op een leaguevlucht kan je niet wedden');
}

// ---------------------------------------------------------------------------
console.log('\n3. Enkel duiven met de juiste score raken erin');
{
  const s = await W.load(W.humans[0]);
  const db = s.data;
  const flight = db.flights.find((f) => f.league === 'l70' && f.status === 'scheduled')!;
  ok(!!flight, `een geplande vlucht van de ${flight?.name}`);
  // Fresh birds: the ones from the start lived through two simulated weeks and
  // one of them is sometimes ill by now — that would be refused for another reason.
  const right = bird(W.humans[0], db.world.currentWeek, 65);
  const wrong = bird(W.humans[0], db.world.currentWeek, 75);
  db.pigeons.push(right, wrong);
  const errWrong = enterFlight(s, W.humans[0], flight.id, wrong.id);
  ok(typeof errWrong === 'string' && errWrong.includes('★60,1 tot en met ★70') && errWrong.includes('★ 71–80'),
     `een duif uit een andere league wordt geweigerd ("${errWrong}")`);
  ok(enterFlight(s, W.humans[0], flight.id, right.id) === null, 'een duif uit de juiste league mag wel in');
  const second = bird(W.humans[0], db.world.currentWeek, 62.5);
  db.pigeons.push(second);
  ok(enterFlight(s, W.humans[0], flight.id, second.id) === null, 'een tweede eigen duif (★62,5) mag er ook in — geen limiet per hok');
  const edge = bird(W.humans[0], db.world.currentWeek, 60);
  db.pigeons.push(edge);
  ok(typeof enterFlight(s, W.humans[0], flight.id, edge.id) === 'string', 'een duif van precies ★60 hoort nog in de laagste league');
  await s.persist();

  const all = (await W.load()).data;
  // Counted over the two weeks walked in section 2: a single moment can catch the
  // bots between two looks.
  const botIds = new Set(all.lofts.filter((l) => l.isBot).map((l) => l.userId));
  const botEntries = SEEN.reduce((n, f) => n + f.entries.filter((e) => botIds.has(e.ownerId)).length, 0);
  ok(botEntries > 0, `de bots schrijven in (${botEntries} inschrijvingen over twee weken)`);
  // The bots' rule itself, at the moment they choose. (Checking entries later
  // against today's score would be wrong: a bird keeps the league she was entered
  // in, and her score may have grown since.)
  const ctx = botEntryContext(all);
  let picked = 0, outside = 0;
  for (const f of all.flights.filter((x) => x.league && x.status === 'scheduled')) {
    for (const bot of all.lofts.filter((l) => l.isBot)) {
      for (const p of botRaceCandidates(ctx, bot, f, new Set())) {
        picked++;
        if (leagueFor(talent(p)) !== f.league) outside++;
      }
    }
  }
  ok(picked > 0 && outside === 0, `een bot kiest enkel duiven uit de league van de vlucht (${picked} kandidaten, ${outside} erbuiten)`);
}

// ---------------------------------------------------------------------------
console.log(`\n4. Minder dan ${LEAGUE.minBirds} duiven of ${LEAGUE.minOwners} melkers = afgelast en terugbetaald`);
{
  // [birds, lofts, why it is called off — or null: it flies]
  const cases: [number, number, RegExp | null][] = [
    [3, 3, /^minder dan 4 duiven$/],
    [6, 2, /^minder dan 3 melkers$/],
    [2, 2, /^minder dan 3 melkers en minder dan 4 duiven$/],
    [4, 3, null],
  ];
  for (const [n, owners, why] of cases) {
    const s = await W.load(W.humans[0]);
    const db = s.data;
    const flight = db.flights.find((f) => !!f.league && f.status === 'scheduled')!;
    db.flights = [flight]; // isolate: nothing else may start or settle here
    flight.entries = [];
    const week = db.world.currentWeek;
    const field: Pigeon[] = [];
    for (let i = 0; i < n; i++) {
      const p = bird(W.humans[i % owners], week, scoreIn(flight.league!) + i * 0.5);
      db.pigeons.push(p); field.push(p);
    }
    const entrants = W.humans.slice(0, owners);
    const before = new Map(entrants.map((u) => [u, db.lofts.find((l) => l.userId === u)!.money]));
    const label = `${n} duiven van ${owners} melkers`;
    ok(field.every((p) => enterFlight(s, p.ownerId, flight.id, p.id) === null), `${label} ingeschreven in de ${flight.name}`);
    tickFlights(db, Date.parse(flight.startAt) + 60000);
    if (why) {
      ok(flight.status === 'completed' && flight.sim.length === 0, `${label}: de vlucht is afgelast`);
      const reason = /^Afgelast \((.*)\)$/.exec(flight.weather)?.[1] ?? '';
      ok(why.test(reason), `met de juiste reden erbij ("${flight.weather}")`);
      ok(entrants.every((u) => db.lofts.find((l) => l.userId === u)!.money === before.get(u)), 'elk inschrijfgeld is terugbetaald');
      const bell = db.notifications.find((x) => x.id === `ntf:cancel:${flight.id}:${W.humans[0]}`);
      const said = reason[0].toUpperCase() + reason.slice(1);
      ok(!!bell && bell.body.startsWith(said) && bell.body.includes(`minstens ${LEAGUE.minOwners} melkers en ${LEAGUE.minBirds} duiven`),
         'de speler krijgt een bel met de reden en beide minimums');
    } else {
      ok(flight.status === 'live' && flight.sim.length === n, `${label}: de vlucht gaat door`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\n5. Geld ja, seizoenspunten nee — en de punten gaan naar de duif');
let WINNER = '';
let L: LeagueId = 'l81';
{
  const s = await W.load();
  const db = s.data;
  const flight = db.flights.find((f) => !!f.league && f.status === 'scheduled')!;
  db.flights = [flight];
  L = flight.league!;
  // A fresh field of PLAYER birds: a bot winner would make the money checks lie
  // (a bot spends on its own every day), and the bots' birds vary run to run.
  const field: Pigeon[] = [];
  for (let i = 0; i < 5; i++) {
    const p = bird(W.humans[i % 3], db.world.currentWeek, scoreIn(L));
    db.pigeons.push(p); field.push(p);
  }
  ok(field.length >= 4, `veld van ${field.length} duiven in de ${flight.name}`);
  freeze(flight, field);
  const winnerLoft = db.lofts.find((l) => l.userId === field[0].ownerId)!;
  const before = { money: winnerLoft.money, points: winnerLoft.seasonPoints, wins: winnerLoft.totalWins, gold: winnerLoft.stats.gold };
  WINNER = field[0].id;
  advanceRealtime(db, Date.parse(flight.startAt) + 12 * 3600000, new Map());
  const table = leaguePrizes(L, !!flight.leagueSprint);
  const winner = flight.results.find((r) => r.rank === 1)!;
  ok(flight.status === 'completed' && winner.pigeonId === WINNER, 'de vlucht is afgerond, de snelste staat eerste');
  ok(winner.prize === prizeForRank(table, 1), `de winnaar krijgt €${prizeForRank(table, 1)} (${flight.leagueSprint ? 'sprint' : 'fond'})`);
  ok(flight.results.every((r) => r.points === 0), 'geen enkel resultaat draagt seizoenspunten');
  ok(winnerLoft.money > before.money, 'het prijzengeld is uitbetaald');
  ok(winnerLoft.seasonPoints === before.points && winnerLoft.totalWins === before.wins, 'geen seizoenspunten en geen overwinning voor het hok');
  ok(winnerLoft.stats.gold === before.gold + 1, 'wel een gouden medaille: een podium is een podium');
  const st = db.pigeons.find((p) => p.id === WINNER)!.leagues?.[L];
  ok(!!st && st.points === 100 && st.wins === 1 && st.races === 1, `de winnaar staat op ${st?.points} leaguepunten in ${L}`);
  ok(Object.keys(db.pigeons.find((p) => p.id === WINNER)!.leagues ?? {}).length === 1, 'er lekt niets naar een andere league');
  ok((db.pigeons.find((p) => p.id === WINNER)!.seasonPodiums ?? 0) >= 1, 'de rit telt mee voor de gewone duivenranglijsten');
  ok(leagueRankings(db)[L].some((r) => r.pigeonId === WINNER && r.value === 100), 'ze staat in de stand van haar league met 100 punten');
  await s.persist();
  const back = (await W.load()).data.pigeons.find((p) => p.id === WINNER)!;
  ok(back.leagues?.[L]?.points === 100, 'de stand overleeft een rondje door de database');
}

// ---------------------------------------------------------------------------
console.log('\n6. Het einde van het seizoen: prijzen, een titel, een schone lei');
{
  const s = await W.load();
  const db = s.data;
  const champ = db.pigeons.find((p) => p.id === WINNER)!;
  const loft = db.lofts.find((l) => l.userId === champ.ownerId)!;
  // A known standing: in the two simulated weeks other birds (bots too) scored
  // league points of their own, so wipe everyone else's — the champion of L is then
  // the winner of section 5, for sure.
  for (const p of db.pigeons) if (p.id !== WINNER) p.leagues = undefined;
  ok(leagueRankings(db)[L][0]?.pigeonId === WINNER, 'ze staat bovenaan de stand van haar league');
  // A second league with a standing, to see the other league pay its own prize.
  const O: LeagueId = L === 'l60' ? 'l81' : 'l60';
  const low = db.pigeons.find((p) => p.ownerId === W.humans[1] && leagueFor(talent(p)) === O)!;
  low.leagues = { [O]: { points: 65, wins: 0, best: 900, races: 1 } };
  const lowLoft = db.lofts.find((l) => l.userId === low.ownerId)!;
  // Places 2–4 of league L, so the first place past the podium is in the ceremony too.
  const chasers = db.pigeons.filter((p) => p.ownerId === W.humans[2] && p.id !== WINNER).slice(0, 3);
  chasers.forEach((p, i) => { p.leagues = { [L]: { points: [80, 65, 55][i], wins: 0, best: 900, races: 2 } }; });
  const fourth = chasers[2];
  const chaserLoft = db.lofts.find((l) => l.userId === W.humans[2])!;
  const moneyBefore = loft.money, lowBefore = lowLoft.money;
  runSeasonEnd(db, db.world.seasonYear, T0 + SEASON.weeks * WEEK);
  ok(loft.money >= moneyBefore + leagueAward(L, 1), `de kampioen van ${L} levert €${leagueAward(L, 1)} op`);
  ok(lowLoft.money >= lowBefore + leagueAward(O, 1), `de kampioen van ${O} levert €${leagueAward(O, 1)} op`);
  const title = (champ.titles ?? []).find((t) => t.kind === 'league');
  const short = LEAGUES.find((l) => l.id === L)!.short;
  ok(!!title && title.rank === 1 && title.league === L && title.label === `Gouden Leagueduif ${short}`, `de duif draagt een titel: "${title?.label}"`);
  ok((loft.awards ?? []).some((a) => a.kind === 'league' && a.league === L && a.reward === leagueAward(L, 1)), 'het hok heeft de prijs in zijn erelijst');
  const premie = (chaserLoft.awards ?? []).find((a) => a.kind === 'league' && a.league === L && a.rank === 4);
  ok(!!premie && premie.reward === leagueAward(L, 4) && premie.pigeonName === fourth.name, `de 4e plaats krijgt een leaguepremie van €${premie?.reward}`);
  ok(!(fourth.titles ?? []).some((t) => t.kind === 'league'), 'maar geen titel op de duif (enkel de top 3)');
  ok((chasers[1].titles ?? []).some((t) => t.kind === 'league' && t.rank === 3), 'de 3e plaats wel');
  const chaserBell = db.notifications.find((n) => n.id === `ntf:season:${db.world.seasonYear}:${chaserLoft.userId}`);
  ok(!!chaserBell && chaserBell.body.includes('Leaguepremie') && chaserBell.body.includes('4e plaats'), 'de bel noemt de leaguepremie en de plaats');
  ok(db.pigeons.every((p) => !p.leagues), 'elke leaguestand is gewist: de leagues lopen één seizoen');
  const bell = db.notifications.find((n) => n.id === `ntf:season:${db.world.seasonYear}:${loft.userId}`);
  ok(!!bell && bell.body.includes(`Gouden Leagueduif ${short}`), 'de prijsuitreiking noemt de leagueprijs');
  await s.persist();
  const back = (await W.load()).data;
  ok(back.pigeons.every((p) => !p.leagues), 'ook na een rondje door de database is de stand leeg');
  ok((back.pigeons.find((p) => p.id === WINNER)!.titles ?? []).some((t) => t.kind === 'league'), 'en de titel staat er nog');
}

// ---------------------------------------------------------------------------
console.log('\n7. Migratie v67: het criterium gaat eruit');
for (const seasonsDone of [1, 0]) {
  const M = await freshWorld();
  let db = await M.tick(T0);
  // Rebuild what production looks like at v66: a running criterium cycle, its
  // standings, a scheduled criterium race with a player's bird in it, and one that
  // is already in the air.
  const s = await M.load(M.humans[0]);
  db = s.data;
  db.world.dataVersion = 66;
  db.world.ageCupStartedAt = new Date(T0 - 4 * WEEK).toISOString();
  db.world.ageCupSeasonsDone = seasonsDone;
  const mine = db.pigeons.filter((p) => p.ownerId === M.humans[0]);
  mine[0].cup = { y12: { points: 180, wins: 1, best: 1100, races: 3 } };
  mine[1].cup = { y12: { points: 90, wins: 0, best: 1000, races: 2 } };
  const botBird = db.pigeons.find((p) => db.lofts.find((l) => l.userId === p.ownerId)?.isBot)!;
  botBird.cup = { o3: { points: 120, wins: 1, best: 1000, races: 2 } };
  db.flights = db.flights.filter((f) => !f.league); // the leagues were not there yet
  const cupStart = T0 + 2 * DAY; // Monday
  const sched: Flight = {
    id: 'flt_cup-u1_old', week: db.world.currentWeek, templateKey: 'cup-u1:old', name: 'Onder 1 jaar — Sprint',
    type: 'national', distanceKm: 210, entryFee: 20, fromCity: 'Lille', toCity: 'Gent',
    startAt: new Date(cupStart).toISOString(), status: 'scheduled', practice: false, titan: false,
    ageCat: 'u1', cupSprint: true, entries: [{ pigeonId: mine[2].id, ownerId: M.humans[0] }],
    sim: [], weather: '', weatherFactor: 1, results: [], recap: '', createdAt: new Date(T0).toISOString(),
  };
  const liveField = db.pigeons.filter((p) => p.ownerId === M.humans[1]).slice(0, 2)
    .concat(db.pigeons.filter((p) => p.ownerId === M.humans[2]).slice(0, 2));
  const live: Flight = {
    ...sched, id: 'flt_cup-o3_live', templateKey: 'cup-o3:live', name: 'Ouder dan 3 jaar — Grote fond',
    startAt: new Date(T0 - 3600000).toISOString(), ageCat: 'o3', cupSprint: false, entries: [],
  };
  freeze(live, liveField);
  db.flights.push(sched, live);
  const loft0 = db.lofts.find((l) => l.userId === M.humans[0])!;
  loft0.money -= 20; // the fee that booking cost
  const moneyBefore = loft0.money;
  await s.persist();

  db = await M.tick(T0 + 60000);
  const loft = db.lofts.find((l) => l.userId === M.humans[0])!;
  const p0 = db.pigeons.find((p) => p.id === mine[0].id)!;
  ok(db.world.dataVersion === 68, `(${seasonsDone} seizoen(en) gelopen) de migratie liep (en alles erna)`);
  if (seasonsDone >= 1) {
    ok(loft.money === moneyBefore + 20 + 2000 + 1600, `de lopende stand is uitgereikt: €2.000 + €1.600, plus €20 terug (kassa +€${Math.round(loft.money - moneyBefore)})`);
    ok((p0.titles ?? []).some((t) => t.kind === 'criterium' && t.rank === 1 && t.label === 'Gouden Criteriumduif 1–2 j'), 'de kampioen draagt haar criteriumtitel');
    ok((loft.awards ?? []).filter((a) => a.kind === 'criterium').length === 2, 'beide prijzen staan in de erelijst');
    const close = d1Row(M.d1, `ntf:criterium:close:${M.humans[0]}`);
    ok(!!close && /Gouden Criteriumduif 1–2 j/.test(close.body), 'de speler krijgt één bel met wat hij won');
    ok(!d1Row(M.d1, `ntf:criterium:close:${botBird.ownerId}`), 'een bot krijgt geld maar geen bel');
  } else {
    ok(loft.money === moneyBefore + 20, 'een cyclus die net herbegon wordt niet uitgereikt, enkel de €20 komt terug');
    ok(!(p0.titles ?? []).some((t) => t.kind === 'criterium'), 'en er komt geen titel');
  }
  ok(db.pigeons.every((p) => !p.cup), 'elke criteriumstand is gewist');
  ok(!db.world.ageCupStartedAt && (db.world.ageCupSeasonsDone ?? 0) === 0, 'het anker van de cyclus is weg');
  ok(!db.flights.some((f) => f.id === sched.id), 'de geplande criteriumvlucht is van de kalender');
  const refund = d1Row(M.d1, `ntf:league:refund:${M.humans[0]}`);
  ok(!!refund && /€20/.test(refund.body), 'de speler krijgt een bel dat zijn inschrijving terugbetaald is');
  const news = M.d1._raw.prepare("SELECT * FROM notifications WHERE id LIKE 'ntf:news:leagues:%'").all() as any[];
  ok(news.length === M.humans.length && news.every((n) => !n.read && n.title === LEAGUE_NEWS.title), `elke echte speler kreeg de aankondiging (${news.length})`);
  ok(db.flights.some((f) => f.league === 'l60' && f.startAt.slice(0, 10) === sched.startAt.slice(0, 10)), 'de maandag krijgt meteen haar league in de plaats');
  const liveNow = db.flights.find((f) => f.id === live.id);
  ok(!!liveNow && liveNow.status !== 'scheduled', 'de criteriumvlucht die al vloog, vliegt gewoon verder');
  const liveDay = live.startAt.slice(0, 10);
  ok(!db.flights.some((f) => f.league && f.startAt.slice(0, 10) === liveDay), 'en die dag krijgt er geen league bij');

  // A second request runs nothing again.
  const again = await M.tick(T0 + 120000, M.humans[1]);
  ok(again.lofts.find((l) => l.userId === M.humans[0])!.money === loft.money, 'een tweede verzoek betaalt niets opnieuw');
  ok((M.d1._raw.prepare("SELECT COUNT(*) AS n FROM notifications WHERE id LIKE 'ntf:news:leagues:%'").get() as any).n === M.humans.length,
     'en stuurt geen tweede aankondiging');

  if (seasonsDone === 0) {
    // The leftover race finishes as a points-free special: money, no league points.
    const done = await M.tick(T0 + 13 * 3600000);
    const f = done.flights.find((x) => x.id === live.id)!;
    ok(f.status === 'completed' && f.results.length === liveField.length, 'de oude criteriumvlucht is netjes afgerond');
    ok(f.results.find((r) => r.rank === 1)!.prize === prizeForRank(LEAGUE.fond.prizes, 1), `ze betaalt wat ze beloofde (€${prizeForRank(LEAGUE.fond.prizes, 1)})`);
    ok(f.results.every((r) => r.points === 0), 'zonder seizoenspunten');
    ok(done.pigeons.every((p) => !p.cup && !p.leagues), 'en zonder criterium- of leaguepunten');
  }
}

{
  // A criterium race that is IN THE AIR when the migration runs, on a league day:
  // it flies on, and that day gets no league race on top (it would clash with it,
  // and the release time may already be past).
  const M = await freshWorld();
  let db = await M.tick(T0);
  const monday = db.flights.find((f) => f.league === 'l60')!;
  const s = await M.load(M.humans[0]);
  db = s.data;
  db.world.dataVersion = 66;
  db.flights = db.flights.filter((f) => !f.league);
  const field = db.pigeons.filter((p) => p.ownerId === M.humans[1] || p.ownerId === M.humans[2]).slice(0, 4);
  const live: Flight = {
    id: 'flt_cup-u1_live', week: db.world.currentWeek, templateKey: 'cup-u1:live', name: 'Onder 1 jaar — Sprint',
    type: 'national', distanceKm: 210, entryFee: 20, fromCity: 'Lille', toCity: 'Gent',
    startAt: monday.startAt, status: 'scheduled', practice: false, titan: false, ageCat: 'u1', cupSprint: true,
    entries: [], sim: [], weather: '', weatherFactor: 1, results: [], recap: '', createdAt: new Date(T0).toISOString(),
  };
  freeze(live, field);
  db.flights.push(live);
  await s.persist();
  db = await M.tick(Date.parse(monday.startAt) + 1800000);
  ok(db.world.dataVersion === 68, 'de migratie liep terwijl er een criteriumvlucht in de lucht hing');
  ok(db.flights.find((f) => f.id === live.id)?.status === 'live', 'die vlucht vliegt gewoon verder');
  ok(!db.flights.some((f) => f.league && f.startAt.slice(0, 10) === live.startAt.slice(0, 10)), 'en die maandag krijgt er geen league bij');
  ok(db.flights.some((f) => f.league === 'l70'), 'de volgende leaguedag (woensdag) wel');
}

function d1Row(d1: any, id: string): any {
  return d1._raw.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
}

// ---------------------------------------------------------------------------
console.log('\n8. De bel, de wiki en de spelregels zeggen hetzelfde als LEAGUE');
{
  const body = LEAGUE_NEWS.body;
  ok(LEAGUES.every((l) => body.includes(l.short)), 'de bel noemt de vier leagues');
  ok(body.includes(`€${LEAGUE.entryFee}`) && body.includes(`minstens ${LEAGUE.minOwners} melkers en ${LEAGUE.minBirds} duiven`), 'de bel noemt het inschrijfgeld en beide minimums');
  ok(/geen seizoenspunten/.test(body) && /wiki/i.test(body), 'ze waarschuwt voor de seizoenspunten en verwijst naar de wiki');
  ok(body.length < 900, `ze blijft kort (${body.length} tekens)`);
  ok(body.includes(`top ${LEAGUES[0].awards.length}`) && body.includes(`€${leagueAward('l81', 1).toLocaleString('nl-BE')}`), 'ze noemt hoeveel plaatsen betalen en de hoogste prijs');
  const tour = readFileSync('./client/src/components/Tour.tsx', 'utf8');
  ok(tour.includes(`tot <strong>€${leagueAward('l81', 1).toLocaleString('nl-BE')}</strong>`), 'de rondleiding noemt dezelfde hoogste prijs');
  const wiki = readFileSync('./client/src/pages/WikiPage.tsx', 'utf8');
  const rules = readFileSync('./spelregels.md', 'utf8');
  ok(wiki.includes('id="leagues"') && !/id="criterium"/.test(wiki), 'de wiki heeft een sectie #leagues en geen #criterium meer');
  const eur = (n: number) => `€${n.toLocaleString('nl-BE')}`;
  for (const lg of LEAGUES) {
    const s1 = eur(prizeForRank(leaguePrizes(lg.id, true), 1));
    const f1 = eur(prizeForRank(leaguePrizes(lg.id, false), 1));
    const a1 = eur(leagueAward(lg.id, 1));
    ok(rules.includes(s1) && rules.includes(f1) && rules.includes(a1), `spelregels: ${lg.short} zege ${s1} / ${f1}, eindprijs ${a1}`);
    // The season prizes, place by place, as one table row each in rules and wiki.
    const places: [string, number][] = [['🥇 1e', 1], ['🥈 2e', 2], ['🥉 3e', 3], ['4e', 4], ['5e', 5], ['6e', 6], ['7e – 10e', 7]];
    for (const [label, rank] of places) {
      const col = LEAGUES.map((l) => eur(leagueAward(l.id, rank)));
      const rulesRow = `| ${label} | ${col.join(' | ')} |`;
      const wikiRow = `['${label}', ${col.map((x) => `'${x}'`).join(', ')}]`;
      if (lg.id === 'l60') ok(rules.includes(rulesRow) && wiki.includes(wikiRow), `eindprijs ${label}: ${col.join(' / ')} (spelregels + wiki)`);
    }
  }
  ok(rules.includes(`minstens **${LEAGUE.minBirds} duiven** van minstens **${LEAGUE.minOwners} verschillende`), 'de spelregels noemen beide minimums (4 duiven, 3 melkers)');
  ok(wiki.includes(`minstens ${LEAGUE.minBirds} duiven van minstens ${LEAGUE.minOwners} verschillende melkers`), 'de wiki ook');
  ok(!/\| 🏅 \*\*Ouder dan 3 jaar\*\*/.test(rules), 'de leeftijdsklassen staan niet meer in de spelregels');
}

// ---------------------------------------------------------------------------
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
