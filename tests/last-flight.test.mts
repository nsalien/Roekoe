/**
 * Migratie v77 — THE LAST FLIGHT (eigenaar, 22 nov 2026: "Haal alle geplande
 * vluchten weg. Maak enkel de volgende vrijdag nog een vlucht aan van ongeveer
 * 1300km genaamd 'the last flight' als afscheidsvlucht van het spel").
 *
 * Bewaakt:
 *  1. de productiewereld: elke geplande vlucht weg, inschrijfgeld en inzet terug,
 *     de kalender voorgoed stil, en één vlucht: The Last Flight, vrijdag 27 nov
 *     07:00 (Brussel), Madrid → Brussel, ~1.300 km, internationaal;
 *  2. één bel per echte speler (ook een nieuwkomer), met een vaste id, één keer;
 *  3. de dagen erna plant de kalender niets bij; de afscheidsvlucht vliegt en
 *     wordt afgerond, en ook daarna komt er niets meer;
 *  4. elke andere wereld (een testwereld, een wereld vóór 22 nov) houdt haar
 *     kalender; de echte wereld te laat bereikt (na de lossing) doet niets;
 *  5. door D1: binnen de 50 queries, en de stilgelegde kalender overleeft een herlaad.
 *
 * Run: npx tsx tests/last-flight.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from '../core/d1.js';
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Database, User } from '../core/schema.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import { advanceRealtime, LAST_FLIGHT_ID, lastFlightStartMs } from '../core/game/schedule.js';
import { placeBet } from '../core/game/betting.js';
import { generatePigeon } from '../core/game/pigeon.js';
import { computeFinishPayouts } from '../core/game/flight.js';
import { LAST_FLIGHT, RANKING_POINTS } from '../core/config/gameConfig.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
// Sunday 22 Nov 2026, 21:30 in Brussels — the evening the owner asked.
const T1 = Date.parse('2026-11-22T20:30:00Z');
const OLD = '2026-10-01T10:00:00Z';

function addPlayer(store: MemoryStore | D1Store, name: string, createdAt: string): string {
  const u: User = { id: newId('usr'), username: name, passwordHash: 'x', isAdmin: false, isBot: false, createdAt };
  store.mutate((d) => d.users.push(u));
  createLoftForUser(store, u, `Hok ${name}`);
  return u.id;
}

/**
 * A world sitting at v76 with `players` real players registered at `createdAt`;
 * `raced` gives each of them birds that have flown (as on production).
 */
function world(players: number, createdAt: string, raced = true): { store: MemoryStore; db: Database; ids: string[] } {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const ids: string[] = [];
  for (let i = 0; i < players; i++) ids.push(addPlayer(store, `speler${i}`, createdAt));
  if (raced) for (const p of store.data.pigeons) if (ids.includes(p.ownerId)) p.races = 12;
  store.data.world.dataVersion = 76;
  return { store, db: store.data, ids };
}

const scheduled = (db: Database) => db.flights.filter((f) => f.status === 'scheduled');
const money = (db: Database, id: string) => db.lofts.find((l) => l.userId === id)!.money;

// --- 1. De productiewereld ----------------------------------------------------
console.log('\nDe productiewereld (22 nov, 21:30)');
const P = world(4, OLD);
const newcomer = addPlayer(P.store, 'nieuweling', '2026-11-20T10:00:00Z');
advanceRealtime(P.db, T1); // first request: builds the calendar (v77 waits for it)
ok(P.db.world.dataVersion === 76, 'het eerste verzoek bouwt de kalender, v77 wacht daarop');
const before = scheduled(P.db);
ok(before.length >= 8, `er staan ${before.length} geplande vluchten op de kalender`);

// Speler 0 schrijft twee duiven in op een wedstrijd, speler 1 één, en speler 1 wedt.
const race = before.find((f) => !f.practice && !f.league && !f.titan && !f.relay && Date.parse(f.startAt) - T1 < 12 * HOUR)!;
ok(!!race, `een wedstrijd binnen 12 uur: ${race?.name} (${race?.startAt})`);
const birds = (id: string) => P.db.pigeons.filter((p) => p.ownerId === id);
const m0 = money(P.db, P.ids[0]), m1 = money(P.db, P.ids[1]);
for (const p of birds(P.ids[0]).slice(0, 2)) race.entries.push({ pigeonId: p.id, ownerId: P.ids[0] });
race.entries.push({ pigeonId: birds(P.ids[1])[0].id, ownerId: P.ids[1] });
P.db.lofts.find((l) => l.userId === P.ids[0])!.money -= 2 * race.entryFee;
P.db.lofts.find((l) => l.userId === P.ids[1])!.money -= race.entryFee;
const bet = placeBet(P.db, P.ids[1], race.id, 'win', birds(P.ids[1])[0].id, null, 50, T1);
ok(typeof bet !== 'string', 'speler 1 wedt €50 op die vlucht');
const botMoneyBefore = new Map(P.db.lofts.filter((l) => l.isBot).map((l) => [l.userId, l.money]));
const botFees = new Map<string, number>();
for (const f of before) {
  for (const e of f.entries) {
    if (!botMoneyBefore.has(e.ownerId)) continue;
    if (f.relay && f.entries.some((x, i) => x.ownerId === e.ownerId && f.entries.indexOf(x) < f.entries.indexOf(e))) continue;
    botFees.set(e.ownerId, (botFees.get(e.ownerId) ?? 0) + f.entryFee);
  }
}

advanceRealtime(P.db, T1 + MIN);
ok(P.db.world.dataVersion === 77, 'v77 is gedraaid');
ok(!!P.db.world.scheduleEndedAt, `de kalender is stilgelegd (${P.db.world.scheduleEndedAt})`);
const after = scheduled(P.db);
ok(after.length === 1 && after[0].id === LAST_FLIGHT_ID, 'er staat nog precies één vlucht gepland: de afscheidsvlucht');
ok(before.every((f) => !P.db.flights.some((x) => x.id === f.id)), 'alle eerder geplande vluchten zijn weg');
const last = P.db.flights.find((f) => f.id === LAST_FLIGHT_ID)!;
ok(last.name === LAST_FLIGHT.name, `ze heet "${last.name}"`);
ok(last.fromCity === 'Madrid' && last.toCity === 'Brussel', `${last.fromCity} → ${last.toCity}`);
ok(last.distanceKm >= 1250 && last.distanceKm <= 1350, `ongeveer 1300 km (${last.distanceKm} km)`);
ok(last.startAt === '2026-11-27T06:00:00.000Z' && Date.parse(last.startAt) === lastFlightStartMs(), 'vrijdag 27 november, 07:00 Brussel');
ok(last.type === 'international' && last.entryFee === 40 && !last.practice && !last.titan && !last.relay && !last.league,
  'een gewone internationale wedstrijd (€40, prijzen, punten)');
ok(money(P.db, P.ids[0]) === m0, `speler 0 krijgt zijn €${2 * race.entryFee} inschrijfgeld terug`);
ok(money(P.db, P.ids[1]) === m1, 'speler 1 krijgt inschrijfgeld én inzet terug');
ok(P.db.bets.find((b) => b.id === (bet as any).id)?.status !== 'open', 'de weddenschap is niet meer open');
const botOk = [...botMoneyBefore].every(([id, m]) => {
  const now = money(P.db, id);
  const onLast = last.entries.filter((e) => e.ownerId === id).length * last.entryFee;
  return now === m + (botFees.get(id) ?? 0) - onLast;
});
ok(botOk, 'de bots krijgen hun inschrijfgeld terug (min wat ze op de afscheidsvlucht zetten)');

// --- 2. De bel ----------------------------------------------------------------
console.log('\nDe bel');
const bells = P.db.notifications.filter((n) => n.id.startsWith('ntf:admin:lastflight:'));
ok(bells.length === 5, `één bel per echte speler, ook de nieuwkomer (${bells.length})`);
ok(bells.some((n) => n.userId === newcomer), 'de nieuwkomer hoort het ook');
const b0 = bells.find((n) => n.userId === P.ids[0])!;
ok(b0.title.includes(LAST_FLIGHT.name) && b0.body.includes('Madrid → Brussel') && b0.body.includes('vrijdag'), 'de bel noemt de vlucht, de route en de dag');
ok(b0.body.includes(`€${2 * race.entryFee}`), 'en wat er terugbetaald is');
ok(!bells.find((n) => n.userId === P.ids[2])!.body.includes('terugbetaald'), 'wie niets ingeschreven had, krijgt geen terugbetaalzin');
ok(b0.flightId === LAST_FLIGHT_ID, 'de bel linkt naar de afscheidsvlucht');
advanceRealtime(P.db, T1 + 2 * MIN);
ok(P.db.notifications.filter((n) => n.id.startsWith('ntf:admin:lastflight:')).length === 5, 'een volgend verzoek belt niet opnieuw');

// --- 3. De dagen erna ---------------------------------------------------------
console.log('\nDe dagen erna');
for (let t = T1 + HOUR; t < lastFlightStartMs() - HOUR; t += 6 * HOUR) advanceRealtime(P.db, t);
ok(scheduled(P.db).length === 1, 'tot vrijdag komt er geen enkele vlucht bij');
// Vier spelers schrijven al hun duiven in, vol getankt: zes per hok, meer dan de
// gewone 3 die verdienen, en samen met de bots een veld van meer dan 20.
for (const id of P.ids) {
  for (const p of birds(id)) {
    p.form = 100; p.health = 95;
    if (!last.entries.some((e) => e.pigeonId === p.id)) last.entries.push({ pigeonId: p.id, ownerId: id });
  }
}
advanceRealtime(P.db, lastFlightStartMs() + MIN);
ok(last.status === 'live' && last.sim.length >= 24, `de afscheidsvlucht is gelost (${last.sim.length} duiven)`);
let finishedAt = 0;
for (let t = lastFlightStartMs() + HOUR; t < lastFlightStartMs() + 3 * DAY && !finishedAt; t += HOUR) {
  advanceRealtime(P.db, t);
  if (last.status === 'completed') finishedAt = t;
}
const home = last.results.filter((r) => r.finished).length;
const times = last.results.filter((r) => r.finished).map((r) => r.timeSeconds / 3600).sort((a, b) => a - b);
console.log(`    snelste ${times[0]?.toFixed(1)} u, traagste ${times[times.length - 1]?.toFixed(1)} u`);
ok(finishedAt > 0 && last.results.length >= 24,
  `ze is afgerond na ~${Math.round((finishedAt - lastFlightStartMs()) / HOUR)} uur (${last.results.length} in de uitslag, ${home} thuis)`);
// Eigenaar, 22 nov: "Alle duiven krijgen punten en geld voor hun plaats op die vlucht."
const finishers = last.results.filter((r) => r.finished);
ok(finishers.every((r) => r.rewarded !== false && r.prize > 0 && r.points > 0),
  'elke duif die thuiskomt krijgt prijzengeld én punten');
const perLoft = new Map<string, number>();
for (const r of finishers) perLoft.set(r.ownerId, (perLoft.get(r.ownerId) ?? 0) + 1);
ok([...perLoft.values()].some((n) => n > 3), `ook de 4e, 5e en 6e duif van een hok (tot ${Math.max(...perLoft.values())} per hok)`);
const expected = (rank: number) => RANKING_POINTS[rank - 1] ?? LAST_FLIGHT.pointsAfterTable;
ok(finishers.every((r) => r.points === expected(r.rank)), 'punten volgens de plaats (top 20 de tabel, daarna 1 punt)');
ok(finishers.some((r) => r.rank > 20), `er zijn plaatsen voorbij de 20 (${finishers.length} thuis)`);
ok(last.results.filter((r) => !r.finished).every((r) => r.prize === 0 && r.points === 0), 'wie niet thuiskomt, heeft geen plaats en verdient niets');
ok(computeFinishPayouts(last).every((x) => finishers.find((r) => r.pigeonId === x.pigeonId)?.prize === x.prize),
  'het geld bij aankomst is hetzelfde als in de uitslag (niets dubbel, niets vergeten)');
for (let t = finishedAt; t < lastFlightStartMs() + 6 * DAY; t += 6 * HOUR) advanceRealtime(P.db, t);
ok(P.db.flights.every((f) => f.id === LAST_FLIGHT_ID), 'en daarna komt er niets meer op de kalender');

// --- 4. Andere werelden -------------------------------------------------------
console.log('\nAndere werelden');
{
  // A test world: real players who just registered.
  const W = world(4, new Date(T1 - DAY).toISOString());
  advanceRealtime(W.db, T1);
  advanceRealtime(W.db, T1 + MIN);
  ok(W.db.world.dataVersion === 77 && !W.db.world.scheduleEndedAt, 'een testwereld schuift door naar v77 zonder de kalender te stoppen');
  ok(scheduled(W.db).length >= 8 && !W.db.flights.some((f) => f.id === LAST_FLIGHT_ID), 'haar kalender blijft gewoon staan');
  advanceRealtime(W.db, T1 + 2 * DAY);
  ok(W.db.flights.some((f) => f.startAt > new Date(T1 + 5 * DAY).toISOString()), 'en plant verder');
}
{
  // Old players on the real clock, but their birds never flew (like newcomer.test's v39).
  const W = world(4, OLD, false);
  advanceRealtime(W.db, T1);
  advanceRealtime(W.db, T1 + MIN);
  ok(W.db.world.dataVersion === 77 && !W.db.world.scheduleEndedAt, 'oude accounts zonder gevlogen duiven: de kalender blijft lopen');
}
{
  // Old players, but a clock before 22 nov (like season-close.test).
  const W = world(4, OLD);
  const early = Date.parse('2026-10-24T10:00:00Z');
  advanceRealtime(W.db, early);
  advanceRealtime(W.db, early + MIN);
  ok(W.db.world.dataVersion === 76 && !W.db.world.scheduleEndedAt && scheduled(W.db).length >= 8, 'vóór 22 november verandert er niets');
}
{
  // The live world, reached after the release: nothing, not even the version.
  const W = world(4, OLD);
  const late = lastFlightStartMs() - HOUR;
  advanceRealtime(W.db, late);
  advanceRealtime(W.db, late + MIN);
  ok(W.db.world.dataVersion === 76 && !W.db.world.scheduleEndedAt, 'te laat voor vrijdag: v77 doet niets en wacht');
  ok(!W.db.flights.some((f) => f.id === LAST_FLIGHT_ID), 'en plant geen afscheidsvlucht in het verleden');
}

// --- 5. Door D1 ---------------------------------------------------------------
console.log('\nDoor D1');
{
  let queries = 0;
  const sql = new DatabaseSync(':memory:');
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { bound.push(...args); return api; },
      async first() { queries++; return sql.prepare(query).get(...(bound as any[])) ?? null; },
      async all() { queries++; return { results: sql.prepare(query).all(...(bound as any[])) }; },
      run() { queries++; return sql.prepare(query).run(...(bound as any[])); },
    };
    return api;
  };
  const d1: any = { prepare, async exec(q: string) { queries++; sql.exec(q); }, async batch(st: any[]) { for (const s of st) s.run(); } };
  sql.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  sql.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1, 1, 1, 0)').run();
  for (let i = 0; i < 40 && !(await ensureSchema(d1)); i++);

  // A production-shaped world: 10 players registered weeks ago, ~200 birds.
  let s = await D1Store.load(d1);
  seedWorld(s);
  await s.persist();
  s = await D1Store.load(d1);
  const humans: string[] = [];
  for (let i = 0; i < 10; i++) humans.push(addPlayer(s, `melker${i}`, OLD));
  s.mutate((d) => {
    const owners = d.lofts.map((l) => l.userId);
    for (let i = 0; d.pigeons.length < 200; i++) {
      const p = generatePigeon({ currentWeek: d.world.currentWeek, quality: 0.5 });
      p.ownerId = owners[i % owners.length];
      d.pigeons.push(p);
    }
    for (const p of d.pigeons) if (humans.includes(p.ownerId)) p.races = 12;
    d.world.dataVersion = 76;
  });
  await s.persist();
  // The calendar, and every player entered on every race they can.
  s = await D1Store.load(d1);
  advanceRealtime(s.data, T1, new Map());
  for (const f of s.data.flights.filter((x) => x.status === 'scheduled' && !x.practice && !x.relay && !x.titan)) {
    for (const h of humans) {
      const p = s.data.pigeons.find((x) => x.ownerId === h && !f.entries.some((e) => e.pigeonId === x.id));
      if (p) f.entries.push({ pigeonId: p.id, ownerId: h });
    }
  }
  await s.persist();

  queries = 1; // ensureSchema on a warm isolate
  s = await D1Store.load(d1);
  advanceRealtime(s.data, T1 + MIN, new Map());
  await s.persist();
  ok(s.data.world.dataVersion === 77, 'v77 draait door D1');
  ok(queries < 50, `het verzoek van de migratie blijft binnen de 50 queries (${queries})`);

  s = await D1Store.load(d1);
  ok(!!s.data.world.scheduleEndedAt, 'de stilgelegde kalender overleeft een herlaad');
  const sched = s.data.flights.filter((f) => f.status === 'scheduled');
  ok(sched.length === 1 && sched[0].name === LAST_FLIGHT.name && sched[0].distanceKm > 1250, 'in D1 staat enkel The Last Flight gepland');
  advanceRealtime(s.data, T1 + 2 * DAY, new Map());
  await s.persist();
  s = await D1Store.load(d1);
  ok(s.data.flights.filter((f) => f.status === 'scheduled').length === 1, 'twee dagen later nog altijd enkel die ene vlucht');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
