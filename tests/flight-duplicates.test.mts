/**
 * Eén vlucht per kalenderplaats (dag + type), ook als twee verzoeken tegelijk plannen.
 *
 * De gemelde bug (12 okt): vanaf woensdag stond elke vlucht twee keer op de kalender —
 * twee nationale om hetzelfde uur, twee criteriumvluchten, … `ensureFlightsScheduled`
 * is idempotent BINNEN één verzoek (het kijkt naar `templateKey`), maar twee verzoeken
 * die tegelijk de motor draaien zien allebei een lege dag en maakten elk hun eigen
 * vlucht met een willekeurige id. `persist` schreef ze allebei weg.
 *
 * Bewaakt:
 *  1. de race: twee verzoeken plannen dezelfde dagen → toch één vlucht per plaats
 *     (de id volgt nu uit de plaats, zoals bij de zondagveiling);
 *  2. de opkuis van wat al dubbel staat: één vlucht blijft (die met de meeste
 *     inschrijvingen van spelers), de inschrijvingen van de andere worden overgezet,
 *     wat niet mag (titan: één duif per hok) krijgt zijn inschrijfgeld terug, een
 *     weddenschap op de weggehaalde vlucht wordt terugbetaald, en de speler krijgt
 *     één bel met de vlucht die blijft. Een tweede run doet niets meer.
 *
 * Run (vanuit de repo-root): npx tsx tests/flight-duplicates.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from '../core/d1.js';
import { createLoftForUser, seedWorld } from '../core/game/engine.js';
import { advanceRealtime, dedupeScheduledFlights } from '../core/game/schedule.js';
import type { Bet, Database, Flight, User } from '../core/schema.js';

let failures = 0;
function ok(cond: boolean, msg: string) {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) { failures += 1; process.exitCode = 1; }
}

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const val = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { bound.push(...args.map(val)); return api; },
      async first() { return sql.prepare(query).get(...(bound as any[])) ?? null; },
      async all() { return { results: sql.prepare(query).all(...(bound as any[])) }; },
      run() { return sql.prepare(query).run(...(bound as any[])); },
    };
    return api;
  };
  return {
    prepare,
    async exec(q: string) { sql.exec(q); },
    async batch(stmts: any[]) { for (const s of stmts) s.run(); },
    _raw: sql,
  };
}

async function freshDb() {
  const db = fakeD1();
  db._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  await ensureSchema(db);
  db._raw.prepare('INSERT OR IGNORE INTO world (id, current_week, season_year, seeded) VALUES (1,60,1,0)').run();
  let guard = 0;
  while (!(await ensureSchema(db))) { if (++guard > 60) throw new Error('ensureSchema convergeert niet'); }
  return db;
}

const DAY = 86_400_000;
const USER: User = { id: 'usr_anna', username: 'anna', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };

/** Scheduled flights per calendar slot. */
function perSlot(db: Database): Map<string, Flight[]> {
  const m = new Map<string, Flight[]>();
  for (const f of db.flights) if (f.status === 'scheduled') m.set(f.templateKey, [...(m.get(f.templateKey) ?? []), f]);
  return m;
}
const doubles = (db: Database) => [...perSlot(db).values()].filter((fs) => fs.length > 1).length;

// --- 1. De race -------------------------------------------------------------------
console.log('\nTwee verzoeken plannen tegelijk');
{
  const d1 = await freshDb();
  const t0 = Date.now();
  let s = await D1Store.load(d1);
  seedWorld(s);
  advanceRealtime(s.data, t0);
  await s.persist();
  const keys0 = new Set((await D1Store.load(d1)).data.flights.map((f) => f.templateKey));

  // Drie dagen later: drie nieuwe dagen schuiven binnen de horizon. A en B laden
  // allebei de wereld van vóór die dagen, draaien de motor en schrijven weg.
  const t1 = t0 + 3 * DAY;
  const A = await D1Store.load(d1);
  const B = await D1Store.load(d1);
  advanceRealtime(A.data, t1);
  advanceRealtime(B.data, t1);
  await A.persist();
  await B.persist();
  const after = (await D1Store.load(d1)).data;
  const fresh = [...perSlot(after).keys()].filter((k) => !keys0.has(k)).length;
  ok(fresh > 0, `er kwamen nieuwe dagen bij (${fresh} nieuwe plaatsen)`);
  ok(doubles(after) === 0, `geen enkele plaats staat dubbel (${doubles(after)})`);
  const f = after.flights.find((x) => x.status === 'scheduled')!;
  ok(f.id === `flt_${f.templateKey.replace(/[^a-z0-9-]/gi, '_')}`, `de id volgt uit de plaats (${f.id})`);
}

// --- 2. De opkuis ---------------------------------------------------------------------
console.log('\nWat al dubbel staat, wordt opgekuist');
{
  const d1 = await freshDb();
  const now = Date.now();
  let s = await D1Store.load(d1);
  seedWorld(s);
  s.data.users.push(USER);
  const loft = createLoftForUser(s, USER, 'Hok Anna');
  loft.money = 10_000;
  advanceRealtime(s.data, now);
  await s.persist();

  s = await D1Store.load(d1, USER.id);
  const w = s.data;
  const mine = w.pigeons.filter((p) => p.ownerId === USER.id);
  // A regular flight a few days out, its twin as the old race left it (own id, own
  // route, own bot entries), and Anna's birds spread over both.
  const reg = w.flights.find((f) => f.status === 'scheduled' && !f.titan && !f.relay && !f.ageCat && !f.practice
    && Date.parse(f.startAt) > now + DAY)!;
  const twin: Flight = { ...structuredClone(reg), id: 'flt_oude_race_1', fromCity: 'Ergens', distanceKm: reg.distanceKm + 37,
    createdAt: new Date(Date.parse(reg.createdAt) + 50).toISOString() };
  twin.entries = twin.entries.filter((e) => e.ownerId !== USER.id);
  reg.entries.push({ pigeonId: mine[0].id, ownerId: USER.id });
  twin.entries.push({ pigeonId: mine[1].id, ownerId: USER.id }, { pigeonId: mine[2].id, ownerId: USER.id });
  w.flights.push(twin);
  // Anna has more birds in the twin, so the twin is the one that stays.
  // Two more slots on another day, made a titanenwedstrijd and an estafette for the
  // test (the real ones are on Saturday, often outside the horizon): a titan allows
  // one bird per loft, an estafette one team (one fee) per loft.
  const others = w.flights.filter((f) => f.status === 'scheduled' && f.templateKey !== reg.templateKey
    && f.startAt.slice(0, 10) !== reg.startAt.slice(0, 10));
  const titan = Object.assign(others[0], { titan: true, relay: false, practice: false, entryFee: 100 });
  const relay = Object.assign(others.find((f) => f.startAt.slice(0, 10) !== titan.startAt.slice(0, 10)) ?? others[1],
    { relay: true, titan: false, practice: false, entryFee: 90 });
  titan.entries = [{ pigeonId: mine[4].id, ownerId: USER.id }, { pigeonId: 'pig_bot_t', ownerId: 'usr_bot_x' }];
  const titanTwin: Flight = { ...structuredClone(titan), id: 'flt_oude_race_2',
    createdAt: new Date(Date.parse(titan.createdAt) + 50).toISOString(),
    entries: [{ pigeonId: mine[3].id, ownerId: USER.id }] };
  relay.entries = [1, 2, 3].map((leg) => ({ pigeonId: `pig_ra${leg}`, ownerId: USER.id, leg }));
  const relayTwin: Flight = { ...structuredClone(relay), id: 'flt_oude_race_3',
    createdAt: new Date(Date.parse(relay.createdAt) + 50).toISOString(),
    entries: [1, 2, 3].map((leg) => ({ pigeonId: `pig_rb${leg}`, ownerId: USER.id, leg })) };
  w.flights.push(titanTwin, relayTwin);
  // A bet on the regular flight that will go.
  const bet: Bet = {
    id: 'bet_oud', userId: USER.id, userName: USER.username, flightId: reg.id, kind: 'win',
    pigeonId: mine[0].id, pigeonName: mine[0].name, rivalId: null, rivalName: null,
    stake: 200, ratio: 3, potentialWin: 600, status: 'open', placedAt: new Date().toISOString(), settledAt: null,
  };
  w.bets.push(bet);
  await s.persist();

  s = await D1Store.load(d1, USER.id);
  const money0 = s.data.lofts.find((l) => l.userId === USER.id)!.money;
  ok(doubles(s.data) >= 1, `vooraf staat er ${doubles(s.data)} plaats dubbel`);
  dedupeScheduledFlights(s.data);
  await s.persist();

  const x = (await D1Store.load(d1, USER.id)).data;
  ok(doubles(x) === 0, 'na de opkuis staat elke plaats er één keer');
  const kept = x.flights.find((f) => f.templateKey === reg.templateKey)!;
  ok(kept.id === twin.id, 'de vlucht met de meeste inschrijvingen van spelers blijft');
  ok([mine[0], mine[1], mine[2]].every((p) => kept.entries.some((e) => e.pigeonId === p.id && e.ownerId === USER.id)),
    'Annas drie duiven staan nu samen op die vlucht');
  ok(new Set(kept.entries.map((e) => e.pigeonId)).size === kept.entries.length, 'geen duif staat twee keer op de lijst');
  ok(x.bets.find((b) => b.id === 'bet_oud')?.status === 'void', 'de weddenschap op de weggehaalde vlucht is geannuleerd');
  const anna = x.lofts.find((l) => l.userId === USER.id)!;
  ok(anna.money === money0 + 200 + 100 + 90,
    'Anna krijgt terug: de inzet (€200), haar tweede titanduif (€100) en haar tweede estafetteploeg (€90, één keer)');
  const keptTitan = x.flights.filter((f) => f.templateKey === titan.templateKey);
  ok(keptTitan.length === 1 && keptTitan[0].entries.filter((e) => e.ownerId === USER.id).length === 1,
    'in de titanenwedstrijd blijft één duif van Anna over');
  const keptRelay = x.flights.filter((f) => f.templateKey === relay.templateKey);
  ok(keptRelay.length === 1 && keptRelay[0].entries.filter((e) => e.ownerId === USER.id).length === 3,
    'in de estafette blijft één ploeg van Anna over');
  const bells = x.notifications.filter((n) => n.userId === USER.id && n.title.startsWith('🗓️'));
  ok(bells.length === 3, `Anna krijgt per opgekuiste vlucht één bel (${bells.length})`);
  const regBell = bells.find((n) => n.body.includes(kept.name) && n.body.includes(`${kept.fromCity} → ${kept.toCity}`));
  ok(!!regBell && /Je duif van de weggehaalde vlucht staat nu op deze ingeschreven/.test(regBell.body), `die bel noemt de vlucht die blijft en wat er met haar duif gebeurde`);
  console.log(`    "${regBell?.body}"`);
  ok(bells.some((n) => /€100 inschrijfgeld/.test(n.body)) && bells.some((n) => /€90 inschrijfgeld.*ploeg/.test(n.body)),
    'de titan- en estafettebel noemen het teruggestorte inschrijfgeld');

  // A second run (another request that runs the same cleanup) changes nothing.
  const s2 = await D1Store.load(d1, USER.id);
  const before = JSON.stringify(s2.data.flights.map((f) => [f.id, f.entries.length]));
  dedupeScheduledFlights(s2.data);
  ok(JSON.stringify(s2.data.flights.map((f) => [f.id, f.entries.length])) === before
    && s2.data.lofts.find((l) => l.userId === USER.id)!.money === anna.money, 'een tweede run verandert niets');
}

console.log(failures === 0 ? '\nAlles in orde.' : `\n${failures} mislukt.`);
