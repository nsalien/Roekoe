/**
 * Regressietest: "zoekertje naar boven" (MARKET_BOOST, ⚠️ dev).
 *
 * Wens van de eigenaar: een verkoper zet zijn zoekertje voor 50 bovenaan de markt;
 * zodra iemand anders boost, zakt het zijne terug naar beneden; een boost blijft
 * 12 uur actief.
 *
 * Bewaakt:
 *  1. boosten kost MARKET_BOOST.cost en zet je zoekertje bovenaan;
 *  2. er is één plek bovenaan: de recentste boost wint, de vorige zakt terug;
 *  3. na MARKET_BOOST.hours is het voorbij, ook zonder nieuwe boost;
 *  4. de regels: enkel je eigen zoekertje, niet dubbel betalen terwijl je al
 *     bovenaan staat, niet in het rood, genoeg geld;
 *  5. een boost hoort bij één zoekertje: intrekken, verkopen of een aanvaard bod
 *     wist hem, een nieuw zoekertje begint zonder, een prijswijziging behoudt hem;
 *  6. boosted_at overleeft de rondrit door D1 (INSERT én UPDATE).
 *
 * Draai: npx tsx tests/market-boost.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { MemoryStore } from '../core/store.js';
import { D1Store, ensureSchema } from '../core/d1.js';
import { boostListing, buyPigeon, createLoftForUser, listForSale, seedWorld, unlist } from '../core/game/engine.js';
import { featuredListingId } from '../core/game/market.js';
import { makeOffer, respondOffer } from '../core/game/offers.js';
import { MARKET_BOOST } from '../core/config/gameConfig.js';
import { emptyDatabase, type User } from '../core/schema.js';

let pass = 0, fail = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); }
};
const HOUR = 3600000;

function world() {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const users: User[] = ['anna', 'bert', 'cas'].map((n) => ({
    id: `usr_${n}`, username: n, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString(),
  }));
  for (const u of users) {
    store.mutate((db) => db.users.push(u));
    createLoftForUser(store, u, `Hok ${u.username}`);
  }
  const db = store.data;
  for (const l of db.lofts) if (!l.isBot) l.money = 5000;
  const bird = (userId: string, i = 0) => db.pigeons.filter((p) => p.ownerId === userId)[i];
  const loft = (userId: string) => db.lofts.find((l) => l.userId === userId)!;
  const list = (userId: string, i = 0) => listForSale(store, userId, bird(userId, i).id, 999999, null);
  return { store, db, bird, loft, list };
}

console.log('\n=== 1. Boosten kost geld en zet je bovenaan ===');
{
  const { store, db, bird, loft, list } = world();
  list('usr_anna'); list('usr_bert');
  const a = bird('usr_anna');
  ok(featuredListingId(db) === null, 'zonder boost staat niemand bovenaan');
  const before = loft('usr_anna').money;
  ok(boostListing(store, 'usr_anna', a.id) === null, 'anna haalt haar zoekertje naar boven');
  ok(loft('usr_anna').money === before - MARKET_BOOST.cost, `dat kost €${MARKET_BOOST.cost}`);
  ok(featuredListingId(db) === a.id, 'haar zoekertje staat bovenaan');
}

console.log('\n=== 2. Eén plek bovenaan: de recentste boost wint ===');
{
  const { store, db, bird, list } = world();
  list('usr_anna'); list('usr_bert'); list('usr_cas');
  const t0 = Date.now();
  boostListing(store, 'usr_anna', bird('usr_anna').id, t0);
  ok(featuredListingId(db, t0 + 1000) === bird('usr_anna').id, 'anna staat bovenaan');
  boostListing(store, 'usr_bert', bird('usr_bert').id, t0 + HOUR);
  ok(featuredListingId(db, t0 + HOUR + 1000) === bird('usr_bert').id, 'bert boost een uur later: hij staat bovenaan, anna zakt terug');
  ok(boostListing(store, 'usr_anna', bird('usr_anna').id, t0 + 2 * HOUR) === null && featuredListingId(db, t0 + 2 * HOUR + 1000) === bird('usr_anna').id,
    'anna kan opnieuw betalen om terug bovenaan te staan');
}

console.log('\n=== 3. Na 12 uur is het voorbij ===');
{
  const { store, db, bird, list } = world();
  list('usr_anna');
  const t0 = Date.now();
  boostListing(store, 'usr_anna', bird('usr_anna').id, t0);
  ok(featuredListingId(db, t0 + (MARKET_BOOST.hours - 0.1) * HOUR) === bird('usr_anna').id, `na ${MARKET_BOOST.hours - 0.1} uur nog bovenaan`);
  ok(featuredListingId(db, t0 + (MARKET_BOOST.hours + 0.1) * HOUR) === null, `na ${MARKET_BOOST.hours} uur niet meer`);
  // A newer boost that has expired does not hide an older one that still runs? It cannot:
  // a newer boost always ends later. But an expired one must not block a fresh one.
  ok(boostListing(store, 'usr_anna', bird('usr_anna').id, t0 + 13 * HOUR) === null && featuredListingId(db, t0 + 13 * HOUR + 1000) === bird('usr_anna').id,
    'daarna kan ze opnieuw boosten');
}

console.log('\n=== 4. De regels ===');
{
  const { store, db, bird, loft, list } = world();
  list('usr_anna');
  const a = bird('usr_anna');
  ok((boostListing(store, 'usr_bert', a.id) ?? '').includes('niet gevonden'), 'andermans zoekertje boost je niet');
  ok((boostListing(store, 'usr_bert', bird('usr_bert').id) ?? '').includes('niet te koop'), 'een duif die niet te koop staat ook niet');
  boostListing(store, 'usr_anna', a.id);
  const m = loft('usr_anna').money;
  ok((boostListing(store, 'usr_anna', a.id) ?? '').includes('al bovenaan') && loft('usr_anna').money === m, 'al bovenaan: niet nog eens betalen');
  list('usr_bert');
  loft('usr_bert').money = MARKET_BOOST.cost - 1;
  ok((boostListing(store, 'usr_bert', bird('usr_bert').id) ?? '').includes('Niet genoeg geld'), 'te weinig geld');
  loft('usr_bert').money = -10;
  ok(boostListing(store, 'usr_bert', bird('usr_bert').id) !== null && featuredListingId(db) === a.id, 'in het rood: niet boosten');
}

console.log('\n=== 5. Een boost hoort bij één zoekertje ===');
{
  const { store, db, bird, loft, list } = world();
  list('usr_anna');
  const a = bird('usr_anna');
  boostListing(store, 'usr_anna', a.id);
  listForSale(store, 'usr_anna', a.id, 888888, null);
  ok(featuredListingId(db) === a.id, 'de prijs aanpassen: de boost blijft');
  unlist(store, 'usr_anna', a.id);
  ok(!a.boostedAt && featuredListingId(db) === null, 'uit de verkoop halen: de boost is weg');
  list('usr_anna');
  ok(featuredListingId(db) === null, 'opnieuw te koop zetten: een nieuw zoekertje, zonder boost');

  boostListing(store, 'usr_anna', a.id);
  loft('usr_bert').money = 2_000_000;
  ok(buyPigeon(store, 'usr_bert', a.id) === null && !a.boostedAt && featuredListingId(db) === null, 'verkocht: de boost is weg');

  const c = bird('usr_cas');
  listForSale(store, 'usr_cas', c.id, 999999, 500000);
  boostListing(store, 'usr_cas', c.id);
  loft('usr_anna').money = 2_000_000;
  const err = makeOffer(db, 'usr_anna', c.id, 600000);
  const offer = db.offers.find((o) => o.pigeonId === c.id && o.fromUserId === 'usr_anna');
  ok(err === null && !!offer && respondOffer(db, 'usr_cas', offer!.id, true) === null && !c.boostedAt && featuredListingId(db) === null,
    'een aanvaard bod: de boost is weg');
}

console.log('\n=== 6. De rondrit door D1 ===');
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
    return { prepare, async exec(query: string) { sql.exec(query); }, async batch(stmts: any[]) { for (const s of stmts) s.run(); }, _raw: sql };
  }
  const d1 = fakeD1();
  d1._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  let complete = await ensureSchema(d1);
  if (!complete) {
    d1._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,1)').run();
    let guard = 0;
    while (!complete && guard++ < 40) complete = await ensureSchema(d1);
  }
  const cols = d1._raw.prepare('PRAGMA table_info(pigeons)').all().map((r: any) => r.name);
  ok(complete && cols.includes('boosted_at'), 'de pigeons-tabel heeft boosted_at');

  // INSERT-pad: een verse duif met een boost.
  let store = await D1Store.load(d1, 'usr_anna');
  const iso = '2026-10-11T09:00:00.000Z';
  store.mutate((w) => {
    w.world.seeded = true;
    w.users.push({ id: 'usr_anna', username: 'anna', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: iso });
  });
  createLoftForUser(store, { id: 'usr_anna', username: 'anna', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: iso }, 'Hok anna');
  const id = store.data.pigeons.find((p) => p.ownerId === 'usr_anna')!.id;
  store.mutate((w) => { const p = w.pigeons.find((x) => x.id === id)!; p.forSale = true; p.price = 999999; p.boostedAt = iso; });
  await store.persist();
  store = await D1Store.load(d1, 'usr_anna');
  ok(store.data.pigeons.find((p) => p.id === id)?.boostedAt === iso, 'INSERT: de boost staat er na een herlading');

  // UPDATE-pad: een nieuwe boost op een bestaande duif.
  const iso2 = '2026-10-11T15:00:00.000Z';
  store.mutate((w) => { w.pigeons.find((x) => x.id === id)!.boostedAt = iso2; });
  await store.persist();
  store = await D1Store.load(d1, 'usr_anna');
  ok(store.data.pigeons.find((p) => p.id === id)?.boostedAt === iso2, 'UPDATE: de nieuwe boost staat er');
  store.mutate((w) => { w.pigeons.find((x) => x.id === id)!.boostedAt = null; });
  await store.persist();
  store = await D1Store.load(d1, 'usr_anna');
  ok(!store.data.pigeons.find((p) => p.id === id)?.boostedAt, 'en gewist blijft ze gewist');
}

console.log(`\n${fail === 0 ? 'alles groen' : `${fail} ROOD`} (${pass} van ${pass + fail})`);
if (fail > 0) process.exit(1);
