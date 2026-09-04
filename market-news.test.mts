/**
 * Regressietest op de "nieuw op de markt"-stip op de Markt-knop.
 *
 * Een duif die te koop gezet werd had geen enkel signaal: de markt stuurt geen
 * belmelding, dus je ontdekte het alleen door de pagina toevallig te openen.
 * Nu stempelt de server `world.marketNewsAt` (+ `marketNewsBy`) en toont de
 * navigatieknop een stip tot deze speler gekeken heeft.
 *
 * Bewaakt de drie dingen die stil kunnen breken:
 *   1. de markering wordt gezet waar een duif écht nieuw te koop komt — en
 *      NERGENS anders (een gewone poll mag de wereldrij niet stempelen, dat is
 *      precies het schrijflek van §503-fix ronde 4),
 *   2. ze overleeft de rondrit door D1 (kolom gekoppeld in load én in ALLEBEI de
 *      schrijfpaden — een vergeten kolom faalt volledig geruisloos),
 *   3. de badge-regel zelf: wie ziet de stip, wanneer verdwijnt hij.
 *
 * Draai: npx tsx market-news.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { MemoryStore } from './core/store.js';
import { D1Store, ensureSchema } from './core/d1.js';
import { listForSale, unlist } from './core/game/engine.js';
import { noteMarketNews } from './core/game/market.js';
import { ensureAuctions } from './core/game/auction.js';
import { advanceRealtime } from './core/game/schedule.js';
import {
  hasMarketNews,
  markMarketSeen,
  marketSeenAt,
} from './client/src/game/marketSeen.js';
import type { Database, Loft, Pigeon } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
};

// --- Wereldje ---------------------------------------------------------------

const WEEK = 400;
const bird = (id: string, owner: string): Pigeon => ({
  id, ownerId: owner, name: id, sex: 'doffer', birthWeek: WEEK - 60,
  speed: 75, endurance: 75, orientation: 75, libido: 60, form: 85, health: 92,
  experience: 55, sireId: null, damId: null, forSale: false, price: null, minBid: null,
  createdAtWeek: WEEK - 60, ailment: null, inInfirmary: false, races: 20,
  everAiled: false, coached: false, ration: 'normal', compartment: false,
  hungerDays: 0, restDays: 0, genes: { speed: 95, endurance: 95, orientation: 95 },
  declineRate: 1,
} as unknown as Pigeon);

const loft = (userId: string, name: string, isBot = false): Loft => ({
  userId, name, money: 20000, food: { normal: 50, premium: 0, libido: 0, herstel: 0 },
  feedRation: 'normal', capacity: 20, compartments: 0, seasonPoints: 0, totalWins: 0,
  isBot, infirmaryCapacity: 2, medicatedFood: false, doctors: 0, physios: 0, xp: 0, level: 1,
  stats: { entries: 0, wins: 0, gold: 0, silver: 0, bronze: 0, babies: 0, cures: 0, curesSevere: 0, bets: 0, betsWon: 0, broods: 0, trades: 0, races: 0, buys: 0, sells: 0 },
  badges: [], missions: [], missionsDay: '', streak: 0, awards: [],
} as unknown as Loft);

function world() {
  const db = {
    world: {
      currentWeek: WEEK, seasonYear: 3, seeded: true, dataVersion: 45,
      lastDailyTick: new Date().toISOString(), lastShelterSpawn: new Date().toISOString(),
      seasonStartedAt: new Date().toISOString(), seasonEndsAt: new Date(Date.now() + 86400000 * 20).toISOString(),
      seasonWeek: 1, marketNewsAt: '', marketNewsBy: '',
    },
    users: [
      { id: 'anna', username: 'anna', isBot: false },
      { id: 'bert', username: 'bert', isBot: false },
    ],
    lofts: [loft('anna', 'Hok Anna'), loft('bert', 'Hok Bert')],
    pigeons: [bird('duifje', 'anna'), bird('tweede', 'anna')],
    flights: [], breedingPairs: [], trades: [], auctions: [], bets: [],
    offers: [], notifications: [],
  } as unknown as Database;
  return { db, store: new MemoryStore(db) };
}

// --- 1. De markering wordt gezet waar een duif te koop komt -----------------
console.log('\nDe server markeert nieuw aanbod');
{
  const { db, store } = world();
  ok('een verse wereld heeft geen markering', !db.world.marketNewsAt);

  ok('te koop zetten lukt', listForSale(store, 'anna', 'duifje', 4000, null) === null);
  ok('  de markering staat er', !!db.world.marketNewsAt);
  ok('  met de verkoper erbij', db.world.marketNewsBy === 'anna',
    `by = ${db.world.marketNewsBy}`);
  ok('  en het is een leesbaar tijdstip', Number.isFinite(Date.parse(db.world.marketNewsAt!)));

  // Uit de verkoop halen wist de markering BEWUST niet: het is een logboekje van
  // "er is iets gebeurd", geen spiegel van wat er nu te koop staat. Zou het wel
  // wissen, dan poetst iemand die zijn duif meteen terugtrekt de stip weg bij
  // iedereen die nog niet gekeken heeft.
  const stamped = db.world.marketNewsAt;
  unlist(store, 'anna', 'duifje');
  ok('uit de verkoop halen wist de markering niet', db.world.marketNewsAt === stamped);

  // Een tweede listing schuift hem vooruit — anders zou een speler die al
  // gekeken heeft de volgende duif missen.
  const before = Date.parse(db.world.marketNewsAt!);
  listForSale(store, 'anna', 'tweede', 1200, null);
  ok('een volgende listing schuift de markering vooruit',
    Date.parse(db.world.marketNewsAt!) >= before);
}

// --- 2. Een opvangcentrum-veiling telt ook mee ------------------------------
console.log('\nEen nieuwe veiling telt ook als nieuw aanbod');
{
  const { db } = world();
  // Ver in het verleden gestempeld: de spawn-kans nadert 1. Math.random wordt
  // vastgezet zodat de test niet op een dobbelsteen leunt.
  db.world.lastShelterSpawn = new Date(Date.now() - 1000 * 3600000).toISOString();
  db.world.marketNewsAt = '';
  const real = Math.random;
  Math.random = () => 0.01;
  try {
    // Maandag 12:00 UTC — buiten élk zondagvenster, dus enkel het opvangcentrum.
    const monday = Date.parse('2026-09-07T12:00:00Z');
    ok('de gekozen dag is inderdaad geen zondag', new Date(monday).getUTCDay() === 1);
    ensureAuctions(db, monday);
    ok('er staat een opvangcentrum-veiling open', db.auctions.length === 1,
      `${db.auctions.length} veiling(en)`);
    ok('  en ze zette de markering', !!db.world.marketNewsAt);
    ok('  zonder verkoper, want het is het veilinghuis — dus niemand is vrijgesteld',
      db.world.marketNewsBy === '');
  } finally {
    Math.random = real;
  }
}

// --- 3. Een gewone poll stempelt NIETS -------------------------------------
// Dit is de regel uit §503-fix ronde 4: nooit `Date.now()` in een rij zetten op
// elk verzoek. Zou `noteMarketNews` in een tick belanden, dan schrijft elke poll
// de wereldrij en loopt het dagbudget leeg.
console.log('\nEen poll zonder nieuw aanbod laat de markering met rust');
{
  const { db } = world();
  const t0 = Date.parse('2026-09-07T12:00:00Z');
  db.world.lastShelterSpawn = new Date(t0).toISOString();
  db.world.marketNewsAt = '';
  db.world.marketNewsBy = '';
  const real = Math.random;
  Math.random = () => 0.999999; // geen enkele kansworp slaagt
  try {
    for (let i = 0; i < 12; i++) advanceRealtime(db, t0 + i * 20000);
    ok('twaalf polls over vier minuten laten de markering leeg', !db.world.marketNewsAt,
      `at = ${db.world.marketNewsAt}`);
  } finally {
    Math.random = real;
  }
}

// --- 4. De rondrit door D1 -------------------------------------------------
// Het stilste faalgeval van allemaal: de kolom vergeten in één van de twee
// schrijfpaden (INSERT voor een verse wereld, UPDATE daarna). Dan werkt alles in
// het geheugen en verdwijnt de markering pas in productie, bij de eerstvolgende
// request die de wereld opnieuw laadt.
console.log('\nDe markering overleeft de rondrit door D1');
{
  function fakeD1(): any {
    const sql = new DatabaseSync(':memory:');
    const prepare = (query: string) => {
      const bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) { bound.push(...args); return api; },
        async first() { return sql.prepare(query).get(...(bound as any[])) ?? null; },
        async all() { return { results: sql.prepare(query).all(...(bound as any[])) }; },
        run() { return sql.prepare(query).run(...(bound as any[])); },
      };
      return api;
    };
    return {
      prepare,
      async exec(query: string) { sql.exec(query); },
      async batch(stmts: any[]) { for (const s of stmts) s.run(); },
      _raw: sql,
    };
  }

  const d1 = fakeD1();
  d1._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  // ensureSchema bewaart zijn voortgang op de world-rij, dus die moet er eerst
  // zijn; ze wordt hieronder weer weggehaald om het INSERT-pad te testen.
  let complete = await ensureSchema(d1);
  if (!complete) {
    d1._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,1)').run();
    let guard = 0;
    while (!complete && guard++ < 40) complete = await ensureSchema(d1);
  }
  ok('het schema is bijgewerkt', complete);

  const cols = d1._raw.prepare('PRAGMA table_info(world)').all().map((r: any) => r.name);
  ok('de world-tabel heeft market_news_at', cols.includes('market_news_at'));
  ok('de world-tabel heeft market_news_by', cols.includes('market_news_by'));

  // Verse wereld → het INSERT-pad.
  d1._raw.prepare('DELETE FROM world WHERE id = 1').run();
  const iso = '2026-09-07T10:30:00.000Z';
  let store = await D1Store.load(d1, 'anna');
  store.mutate((w) => { noteMarketNews(w, 'anna', Date.parse(iso)); w.world.seeded = true; });
  await store.persist();
  store = await D1Store.load(d1, 'anna');
  ok('INSERT: de markering staat er na een herlading', store.data.world.marketNewsAt === iso,
    `at = ${store.data.world.marketNewsAt}`);
  ok('INSERT: de verkoper ook', store.data.world.marketNewsBy === 'anna');

  // Bestaande wereld → het UPDATE-pad.
  const iso2 = '2026-09-08T09:00:00.000Z';
  store.mutate((w) => { noteMarketNews(w, '', Date.parse(iso2)); });
  await store.persist();
  store = await D1Store.load(d1, 'anna');
  ok('UPDATE: de nieuwe markering staat er', store.data.world.marketNewsAt === iso2,
    `at = ${store.data.world.marketNewsAt}`);
  ok('UPDATE: een veiling laat de verkoper leeg', store.data.world.marketNewsBy === '');

  // En een herlading zonder wijziging mag de rij niet herschrijven (idle-writes).
  const versionBefore = (d1._raw.prepare('SELECT version FROM world WHERE id = 1').get() as any).version;
  await store.persist();
  const versionAfter = (d1._raw.prepare('SELECT version FROM world WHERE id = 1').get() as any).version;
  ok('een persist zonder wijziging schrijft de wereldrij niet', versionBefore === versionAfter);
}

// --- 5. De badge-regel zelf (client, React-vrij) ---------------------------
console.log('\nWie ziet de stip, en wanneer verdwijnt hij');
{
  // localStorage/window bestaan niet in node; een minimale stand-in volstaat,
  // want marketSeen.ts raakt ze enkel binnenin de functies.
  const bucket = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => bucket.get(k) ?? null,
    setItem: (k: string, v: string) => { bucket.set(k, v); },
  };
  (globalThis as any).window = { dispatchEvent() { return true; } };
  (globalThis as any).Event = class { constructor(public type: string) {} };

  const t = (iso: string) => Date.parse(iso);
  const T1 = '2026-09-07T10:00:00.000Z';
  const T2 = '2026-09-07T12:00:00.000Z';

  ok('zonder markering geen stip', !hasMarketNews('', '', 'bert', 0));
  ok('een markering die je nog niet zag geeft een stip', hasMarketNews(T1, 'anna', 'bert', 0));
  ok('een markering van vóór je bezoek geeft geen stip',
    !hasMarketNews(T1, 'anna', 'bert', t(T2)));
  ok('precies even oud als je bezoek telt als gezien',
    !hasMarketNews(T1, 'anna', 'bert', t(T1)));
  ok('je eigen listing nagt jezelf niet', !hasMarketNews(T1, 'anna', 'anna', 0));
  ok('  maar de andere speler wél', hasMarketNews(T1, 'anna', 'bert', 0));
  ok('een veiling (geen verkoper) nagt iedereen', hasMarketNews(T1, '', 'anna', 0));
  ok('een onleesbaar tijdstip geeft geen stip (en geen crash)',
    !hasMarketNews('geen datum', '', 'bert', 0));
  ok('een uitgelogde bezoeker krijgt geen stip', !hasMarketNews(T1, 'anna', null, 0));

  // Kijken wist de stip.
  ok('vóór het bezoek: nooit gekeken', marketSeenAt('bert') === 0);
  markMarketSeen('bert', [T1, null, undefined]);
  ok('na het bezoek staat de stand op het nieuwste wat op het scherm stond',
    marketSeenAt('bert') === t(T1), `seen = ${marketSeenAt('bert')}`);
  ok('  en de stip is weg', !hasMarketNews(T1, 'anna', 'bert', marketSeenAt('bert')));
  ok('  terwijl iets nieuwers hem meteen terugbrengt',
    hasMarketNews(T2, 'anna', 'bert', marketSeenAt('bert')));

  // Het nieuwste van wat op het scherm stond wint — de /market-lijst kan een
  // tel vóórlopen op de /state-poll die de badge leest.
  markMarketSeen('bert', ['2026-09-07T09:00:00.000Z', T2, '2026-09-06T00:00:00.000Z']);
  ok('markMarketSeen neemt het NIEUWSTE tijdstip', marketSeenAt('bert') === t(T2));

  // Een trage render mag een recenter bezoek niet ongedaan maken.
  markMarketSeen('bert', [T1]);
  ok('de stand gaat nooit achteruit', marketSeenAt('bert') === t(T2));

  // Elke speler zijn eigen stand.
  ok('een andere speler in dezelfde browser staat los', marketSeenAt('anna') === 0);

  // Privémodus: localStorage gooit. Mag niet crashen; de stip blijft dan gewoon
  // staan, wat een nag is en geen kapotte pagina.
  (globalThis as any).localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  let threw = false;
  try { markMarketSeen('bert', [T2]); } catch { threw = true; }
  ok('privémodus laat markMarketSeen niet crashen', !threw);
  ok('  en lezen valt terug op "nooit gekeken"', marketSeenAt('bert') === 0);
}

console.log(`\n${pass} geslaagd, ${fail} gefaald`);
if (fail > 0) process.exitCode = 1;
