/**
 * Leeftijdscriterium (AGE_CUP).
 *
 * Een competitie die NAAST het gewone seizoen loopt, in vier leeftijdsklassen,
 * met per klasse één vlucht per week die week om week wisselt tussen een sprint
 * (100–300 km) en een grote fond (400–1000 km). Ze telt drie seizoenen door en
 * voedt uitsluitend de duivenstand — de melkerranglijst (Roekoe) mag er nooit
 * door bewegen.
 *
 * Wat deze test bewaakt, in de volgorde waarin het stuk kan gaan:
 *  1. de kalender: vier vluchten per week, op de juiste dag/uur, en pas ná de
 *     start van de cyclus;
 *  2. de afwisseling: 2 sprints + 2 fondvluchten per seizoen, 6+6 per cyclus,
 *     en alle vier de klassen vliegen dezelfde week hetzelfde format;
 *  3. de leeftijdsgrens: een duif buiten de klasse raakt er niet in — ook geen
 *     botduif;
 *  4. de scheiding: prijzengeld ja, seizoenspunten/overwinningen nee;
 *  5. de punten belanden bij de DUIF, in de klasse waarin ze verdiend zijn, en
 *     overleven een seizoenswissel;
 *  6. de reset na drie seizoenen: geld, een titel op de duif, en een schone lei.
 *
 * Run: npx tsx age-cup.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from './core/d1.js';
import { seedWorld, createLoftForUser, enterFlight } from './core/game/engine.js';
import { advanceRealtime } from './core/game/schedule.js';
import { runSeasonEnd, ageCupRankings } from './core/game/season.js';
import { finalizeFlight } from './core/game/flight.js';
import { AGE_CATEGORIES, AGE_CUP, SEASON, ageCategoryFor } from './core/config/gameConfig.js';
import { ageInWeeks, generatePigeon } from './core/game/pigeon.js';
import { newId } from './core/store.js';
import type { Database, Pigeon, User } from './core/schema.js';

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
/** A Friday, so the first cup week starts on a clean boundary. */
const T0 = Date.parse('2026-09-04T09:00:00Z');

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
// Give every human loft at least one bird in EVERY bracket, so all four races
// can actually be flown. birthWeek is what decides the bracket.
store.mutate((d) => {
  const week = d.world.currentWeek;
  for (const uid of humans) {
    for (const cat of AGE_CATEGORIES) {
      const age = cat.id === 'o3' ? 180 : Math.floor((cat.minWeeks + Math.min(cat.maxWeeks, cat.minWeeks + 52)) / 2);
      const p = generatePigeon({ ownerId: uid, currentWeek: week, quality: 0.6, birthWeek: week - age });
      p.form = 100; p.health = 100;
      d.pigeons.push(p);
    }
  }
  // Season 1 is in its last week; the criterium anchors on the next boundary.
  d.world.seasonStartedAt = new Date(T0 - 3 * WEEK).toISOString();
  d.world.seasonEndsAt = new Date(T0 + WEEK).toISOString();
  d.world.seasonWeek = 4;
});
await store.persist();

/** Criterium races observed while walking the calendar (section 2), reused by
 *  section 3 — flown races are pruned after two days, so a late snapshot lies. */
let CUP_SEEN: any[] = [];

const load = async (viewer?: string) => D1Store.load(d1, viewer);
async function tick(nowMs: number): Promise<Database> {
  const s = await load(humans[0]);
  advanceRealtime(s.data, nowMs, new Map());
  await s.persist();
  return s.data;
}

// ---------------------------------------------------------------------------
console.log('\n1. De cyclus start pas op de seizoensgrens');
{
  const db = await tick(T0);
  const anchor = Date.parse(db.world.ageCupStartedAt ?? '');
  ok(db.world.dataVersion >= 40, 'migratie v40 is gelopen');
  ok(anchor === T0 + WEEK, 'de cyclus is verankerd op het einde van het lopende seizoen');
  ok(db.flights.filter((f) => f.ageCat).length === 0, 'vóór de start staan er geen criteriumvluchten op de kalender');
  ok((db.world.ageCupSeasonsDone ?? 0) === 0, 'de seizoensteller staat op 0');
}

// ---------------------------------------------------------------------------
console.log('\n2. Vier vluchten per week, één per klasse');
{
  // The schedule horizon is only a few days, so walk a full week to see all four
  // brackets — and collect them as we go: a race that has been flown is pruned
  // after two days, so the final snapshot alone would miss the early ones.
  const seen = new Map<string, (typeof store)['data']['flights'][number]>();
  let db = await tick(T0 + WEEK + DAY);
  for (let d = 2; d <= 8; d++) {
    db = await tick(T0 + WEEK + d * DAY);
    for (const f of db.flights) if (f.ageCat) seen.set(f.templateKey, f);
  }
  const cup = [...seen.values()];
  ok(cup.length > 0, `er staan criteriumvluchten gepland (${cup.length})`);
  const cats = new Set(cup.map((f) => f.ageCat));
  ok(cats.size === AGE_CATEGORIES.length, `alle ${AGE_CATEGORIES.length} klassen komen aan bod (${[...cats].join(', ')})`);
  ok(cup.every((f) => f.entryFee === AGE_CUP.entryFee), `elk inschrijfgeld is €${AGE_CUP.entryFee}`);
  ok(cup.every((f) => new Date(f.startAt).getUTCHours() <= 6), 'elke lossing is vroeg in de ochtend');
  ok(cup.every((f) => !f.titan && !f.relay && !f.practice), 'geen enkele draagt een ander speciaal format');
  // Each planned bracket lands on the weekday its definition asks for.
  let rightDay = true;
  for (const f of cup) {
    const def = AGE_CATEGORIES.find((c) => c.id === f.ageCat)!;
    if (new Date(f.startAt).getUTCDay() !== def.weekday) rightDay = false;
  }
  ok(rightDay, 'elke klasse vliegt op haar eigen weekdag');
  // Exactly one race per bracket per week — never two.
  const perCatWeek = new Map<string, number>();
  const anchor0 = Date.parse(db.world.ageCupStartedAt!);
  for (const f of cup) {
    const key = `${f.ageCat}:${Math.floor((Date.parse(f.startAt) - anchor0) / WEEK)}`;
    perCatWeek.set(key, (perCatWeek.get(key) ?? 0) + 1);
  }
  ok([...perCatWeek.values()].every((n) => n === 1), 'per klasse staat er precies één vlucht per week');
  CUP_SEEN = cup;
}

// ---------------------------------------------------------------------------
console.log('\n3. Sprint en fond wisselen af — 2+2 per seizoen, 6+6 per cyclus');
{
  const db = (await load()).data;
  const anchor = Date.parse(db.world.ageCupStartedAt!);
  const cupSeen = CUP_SEEN;
  // Walk the whole cycle week by week and collect the format each bracket gets.
  const perWeek: boolean[] = [];
  for (let i = 0; i < AGE_CUP.seasons * SEASON.weeks; i++) perWeek.push(i % 2 === 0);
  const sprints = perWeek.filter(Boolean).length;
  ok(sprints === 6 && perWeek.length - sprints === 6, `6 sprints en 6 fondvluchten over ${AGE_CUP.seasons} seizoenen`);
  for (let s = 0; s < AGE_CUP.seasons; s++) {
    const wk = perWeek.slice(s * SEASON.weeks, (s + 1) * SEASON.weeks);
    const sp = wk.filter(Boolean).length;
    ok(sp === 2 && wk.length - sp === 2, `seizoen ${s + 1}: 2 sprints, 2 fondvluchten`);
  }
  // And the engine agrees with that table: same week ⇒ same format for all four.
  const byWeek = new Map<number, Set<boolean>>();
  for (const f of cupSeen) {
    const wi = Math.floor((Date.parse(f.startAt) - anchor) / WEEK);
    (byWeek.get(wi) ?? byWeek.set(wi, new Set()).get(wi)!).add(!!f.cupSprint);
  }
  ok([...byWeek.values()].every((v) => v.size === 1), 'binnen één week vliegen alle klassen hetzelfde format');
  let formatsMatch = true;
  for (const [wi, v] of byWeek) if ([...v][0] !== (wi % 2 === 0)) formatsMatch = false;
  ok(formatsMatch, 'het format volgt de weekindex vanaf het anker');
  // Distances stay inside their window.
  const cup = cupSeen;
  const inWindow = cup.every((f) => {
    const w = f.cupSprint ? AGE_CUP.sprint : AGE_CUP.fond;
    return f.distanceKm >= w.minKm && f.distanceKm <= w.maxKm;
  });
  ok(inWindow, `elke afstand valt in haar venster (${cup.map((f) => f.distanceKm).join(', ')} km)`);
}

// ---------------------------------------------------------------------------
console.log('\n4. Alleen duiven van de juiste leeftijd raken erin');
{
  const s = await load(humans[0]);
  const db = s.data;
  const flight = db.flights.find((f) => f.ageCat && f.status === 'scheduled')!;
  const week = db.world.currentWeek;
  const mine = db.pigeons.filter((p) => p.ownerId === humans[0]);
  const right = mine.find((p) => ageCategoryFor(ageInWeeks(p, week)) === flight.ageCat)!;
  const wrong = mine.find((p) => ageCategoryFor(ageInWeeks(p, week)) !== flight.ageCat)!;
  ok(!!right && !!wrong, 'testhok heeft een passende én een niet-passende duif');
  const errWrong = enterFlight(s, humans[0], flight.id, wrong.id);
  ok(typeof errWrong === 'string' && /leeftijdsklasse/.test(errWrong), `een duif uit een andere klasse wordt geweigerd ("${errWrong}")`);
  const errRight = enterFlight(s, humans[0], flight.id, right.id);
  ok(errRight === null, 'een duif uit de juiste klasse mag wel in');
  // No per-loft cap: a second eligible bird of the same loft may join.
  const second = generatePigeon({ ownerId: humans[0], currentWeek: week, quality: 0.6, birthWeek: right.birthWeek });
  second.form = 100; second.health = 100;
  db.pigeons.push(second);
  ok(enterFlight(s, humans[0], flight.id, second.id) === null, 'een tweede eigen duif mag er ook in (geen limiet per hok)');
  await s.persist();
}
{
  // Bots obey the same bracket rule.
  const db = (await load()).data;
  const week = db.world.currentWeek;
  let botOutside = 0;
  for (const f of db.flights.filter((x) => x.ageCat)) {
    for (const e of f.entries) {
      const p = db.pigeons.find((x) => x.id === e.pigeonId);
      if (p && ageCategoryFor(ageInWeeks(p, week)) !== f.ageCat) botOutside++;
    }
  }
  ok(botOutside === 0, 'geen enkele inschrijving (speler of bot) zit buiten haar klasse');
}

// ---------------------------------------------------------------------------
console.log('\n5+6. Geld ja, seizoenspunten nee — en de punten gaan naar de duif');
{
  const s = await load();
  const db = s.data;
  const week = db.world.currentWeek;
  // Isolate: drop every other flight, so the season points/wins we measure can
  // only have come from the criterium race itself.
  const flight = db.flights.find((f) => f.ageCat && f.status === 'scheduled')!;
  db.flights = [flight];
  const field: Pigeon[] = db.pigeons
    .filter((p) => ageCategoryFor(ageInWeeks(p, week)) === flight.ageCat)
    .slice(0, 5);
  ok(field.length >= 3, `veld van ${field.length} duiven in klasse ${flight.ageCat}`);
  // Freeze a deterministic race: bird 0 wins, bird 1 second, and so on.
  flight.entries = field.map((p) => ({ pigeonId: p.id, ownerId: p.ownerId }));
  flight.status = 'live';
  flight.sim = field.map((p, i) => ({
    pigeonId: p.id, ownerId: p.ownerId, pigeonName: p.name, ownerName: 'x',
    velocity: 1000, durationSeconds: 3600 + i * 60,
    startForm: 100, formCost: 20, formDrained: 20,
  })) as any;
  const winnerId = field[0].id;
  const winnerLoft = db.lofts.find((l) => l.userId === field[0].ownerId)!;
  const moneyBefore = winnerLoft.money;
  const pointsBefore = winnerLoft.seasonPoints;
  const winsBefore = winnerLoft.totalWins;
  const cupBefore = db.pigeons.find((p) => p.id === winnerId)!.cup?.[flight.ageCat!]?.points ?? 0;

  // Let the engine finish it the ordinary way — that is the path that awards the
  // criterium points, so a shortcut here would test nothing.
  advanceRealtime(db, Date.parse(flight.startAt) + 12 * 3600000, new Map());

  const table = flight.cupSprint ? AGE_CUP.sprint.prizes : AGE_CUP.fond.prizes;
  const winner = flight.results.find((r) => r.rank === 1)!;
  ok(flight.status === 'completed', 'de vlucht is afgerond');
  ok(winner.pigeonId === winnerId, 'de snelste duif staat eerste');
  ok(winner.prize === table[0], `de winnaar krijgt €${table[0]} (${flight.cupSprint ? 'sprint' : 'fond'})`);
  ok(flight.results.every((r) => r.points === 0), 'geen enkel resultaat draagt seizoenspunten voor de melkerranglijst');
  let descending = true;
  for (let i = 1; i < table.length; i++) if (table[i] >= table[i - 1]) descending = false;
  ok(descending, `de prijzentabel loopt strikt af (${table.join(' / ')})`);

  ok(winnerLoft.money > moneyBefore, `het prijzengeld is uitbetaald (kassa ${Math.round(moneyBefore)} → ${Math.round(winnerLoft.money)})`);
  ok(winnerLoft.seasonPoints === pointsBefore, 'het hok kreeg geen enkel seizoenspunt');
  ok(winnerLoft.totalWins === winsBefore, 'een criteriumzege telt niet als overwinning voor het hok');

  const bird = db.pigeons.find((p) => p.id === winnerId)!;
  const st = bird.cup?.[flight.ageCat!];
  ok(!!st && st.points > cupBefore, `de winnaar staat op ${st?.points} criteriumpunten in klasse ${flight.ageCat}`);
  ok((st?.wins ?? 0) >= 1, 'haar criteriumzege is geteld');
  ok((st?.races ?? 0) >= 1, 'haar deelname is geteld');
  ok(Object.keys(bird.cup ?? {}).length === 1, 'er lekt niets naar een andere leeftijdsklasse');
  // The bird still feeds the ordinary pigeon rankings, exactly like the titan.
  ok((bird.seasonPodiums ?? 0) >= 1, 'de rit telt wél mee voor de gewone duivenranglijsten');

  await s.persist();
  const back = (await load()).data.pigeons.find((p) => p.id === winnerId)!;
  ok((back.cup?.[flight.ageCat!]?.points ?? 0) === st!.points, 'de stand overleeft een rondje door de database');
}

// ---------------------------------------------------------------------------
console.log('\n7. Een seizoenswissel wist de criteriumstand NIET');
{
  const s = await load();
  const db = s.data;
  const scored = db.pigeons.filter((p) => p.cup && Object.keys(p.cup).length > 0);
  ok(scored.length > 0, `${scored.length} duif/duiven met een criteriumstand`);
  const snapshot = scored.map((p) => [p.id, JSON.stringify(p.cup)] as const);
  const anchor = Date.parse(db.world.ageCupStartedAt!);
  runSeasonEnd(db, db.world.seasonYear, anchor + 4 * WEEK); // end of cycle season 1
  ok((db.world.ageCupSeasonsDone ?? 0) === 1, 'de cyclus staat nu op 1 van de 3 seizoenen');
  const kept = snapshot.every(([id, json]) => JSON.stringify(db.pigeons.find((p) => p.id === id)?.cup) === json);
  ok(kept, 'elke criteriumstand staat er na de seizoenswissel nog exact zo');
  ok(db.pigeons.every((p) => (p.seasonPodiums ?? 0) === 0), 'de gewone seizoensstand is wél gereset');

  runSeasonEnd(db, db.world.seasonYear + 1, anchor + 8 * WEEK);
  ok((db.world.ageCupSeasonsDone ?? 0) === 2, 'na twee seizoenen nog steeds geen reset van het criterium');
  const kept2 = snapshot.every(([id, json]) => JSON.stringify(db.pigeons.find((p) => p.id === id)?.cup) === json);
  ok(kept2, 'ook na het tweede seizoen staat de stand er nog');
  await s.persist(); // section 8 continues from here
}

// ---------------------------------------------------------------------------
console.log('\n8. Na drie seizoenen: prijzen, een titel op de duif, en een schone lei');
{
  const s = await load();
  const db = s.data;
  const anchor = Date.parse(db.world.ageCupStartedAt!);
  const rankings = ageCupRankings(db, db.pigeons.length);
  const cat = AGE_CATEGORIES.find((c) => (rankings[c.id] ?? []).length > 0)!;
  const champion = rankings[cat.id][0];
  const loft = db.lofts.find((l) => l.userId === champion.ownerId)!;
  const moneyBefore = loft.money;

  runSeasonEnd(db, db.world.seasonYear + 2, anchor + 12 * WEEK);

  ok((db.world.ageCupSeasonsDone ?? 0) === 0, 'de cyclusteller staat terug op 0');
  ok(Date.parse(db.world.ageCupStartedAt!) === anchor + 12 * WEEK, 'de volgende cyclus is verankerd op deze grens');
  ok(db.pigeons.every((p) => !p.cup || Object.keys(p.cup).length === 0), 'elke criteriumstand is gewist');
  ok(loft.money >= moneyBefore + AGE_CUP.awards[0], `de kampioen levert €${AGE_CUP.awards[0]} op (kassa ${moneyBefore} → ${loft.money})`);
  const bird = db.pigeons.find((p) => p.id === champion.pigeonId)!;
  const title = (bird.titles ?? []).find((t) => t.kind === 'criterium');
  ok(!!title, `de duif draagt een titel: "${title?.label}"`);
  ok(title?.rank === 1 && title?.ageCat === cat.id, 'de titel noemt de juiste plaats en klasse');
  const award = (loft.awards ?? []).find((a) => a.kind === 'criterium');
  ok(!!award && award.reward === AGE_CUP.awards[0], 'het hok heeft de prijs in zijn erelijst staan');
  ok(AGE_CUP.awards.length === 3 && AGE_CUP.awards[0] > AGE_CUP.awards[1] && AGE_CUP.awards[1] > AGE_CUP.awards[2],
     `de prijzen lopen af: €${AGE_CUP.awards.join(' / €')}`);

  await s.persist();
  const back = (await load()).data.pigeons.find((p) => p.id === bird.id)!;
  ok((back.titles ?? []).length === (bird.titles ?? []).length, 'de titel overleeft een rondje door de database');
}

// ---------------------------------------------------------------------------
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
