/**
 * De markt in drie routes (14 nov).
 *
 * `/market` bouwde voor élke duif van élke andere speler een volledige DTO (160
 * stuks) — de duurste leesroute van het spel, en ze werd om de 15 s gepolld in de
 * slotfase van een veiling. Nu:
 *   - `/market`                  : zoekertjes, veilingen, historiek + WIE je een bod kan doen (naam, aantal);
 *   - `/market/biddable/:speler` : de duiven van één speler, pas als je hem kiest;
 *   - `/market/auctions`         : enkel de lopende veilingen, op de smalle load.
 * En `/state` stuurt de ranglijst nog één keer (niet ook als ruwe tekst in `world`).
 *
 * Run: npx tsx tests/market-routes.test.mts
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/[[path]].ts';
import { D1Store, ensureSchema } from '../core/d1.js';
import { seedWorld } from '../core/game/engine.js';
import { advanceRealtime } from '../core/game/schedule.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const queries: string[] = [];
function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const val = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { bound.push(...args.map(val)); return api; },
      async first() { queries.push(query); return sql.prepare(query).get(...(bound as any[])) ?? null; },
      async all() { queries.push(query); return { results: sql.prepare(query).all(...(bound as any[])) }; },
      async run() { return sql.prepare(query).run(...(bound as any[])); },
    };
    return api;
  };
  return { prepare, async exec(query: string) { sql.exec(query); }, async batch(stmts: any[]) { for (const st of stmts) await st.run(); }, _raw: sql };
}

const d1 = fakeD1();
d1._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
d1._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1, 1, 1, 0)').run();
for (let i = 0; i < 40 && !(await ensureSchema(d1)); i++);
{
  let s = await D1Store.load(d1);
  seedWorld(s);
  await s.persist();
  s = await D1Store.load(d1);
  advanceRealtime(s.data, Date.now(), new Map());
  s.data.world.lastAdvance = new Date().toISOString();
  await s.persist();
}
async function call(path: string, method = 'GET', body?: unknown, token?: string) {
  const request = new Request(`http://t.local/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res: Response = await (onRequest as any)({
    request, env: { DB: d1, JWT_SECRET: 'test-geheim', INVITE_CODE: '' }, params: {}, data: {},
    waitUntil() {}, passThroughOnException() {}, next: () => Promise.reject(new Error('no next')),
  });
  return { status: res.status, json: await res.json() as any };
}

// The first player is the beheerder, who sees every bird in full — so the viewer here is the second.
const baas = (await call('/auth/register', 'POST', { username: 'baas', password: 'baas-geheim', loftName: 'Het Baashok' })).json;
const an = (await call('/auth/register', 'POST', { username: 'an', password: 'an-geheim', loftName: 'Hok An' })).json;
const bob = (await call('/auth/register', 'POST', { username: 'bob', password: 'bob-geheim', loftName: 'Hok Bob' })).json;
const bobBirds: any[] = (await call('/state', 'GET', undefined, bob.token)).json.pigeons;
await call('/market/list', 'POST', { pigeonId: bobBirds[0].id, price: 5000 }, bob.token);

console.log('\n1. /market: wie, niet welke duiven');
const market = (await call('/market', 'GET', undefined, an.token)).json;
ok(!('biddable' in market), 'de lijst met alle duiven van alle spelers zit er niet meer in');
const owners: any[] = market.biddableOwners ?? [];
ok(owners.length === 2 && owners.every((o) => o.id === bob.user.id || o.id === baas.user.id),
  'enkel de andere echte spelers staan erin (geen bots, niet jezelf)');
const bobRow = owners.find((o) => o.id === bob.user.id);
ok(bobRow?.name === 'Hok Bob' && bobRow.count === bobBirds.length - 1,
  `met hun hoknaam en het aantal duiven dat niet te koop staat (${bobRow?.count})`);
ok(owners.every((o, i) => i === 0 || owners[i - 1].name.localeCompare(o.name) <= 0), 'alfabetisch');
const asAdmin = (await call(`/market/biddable/${bob.user.id}`, 'GET', undefined, baas.token)).json.pigeons as any[];
ok(asAdmin.length > 0 && asAdmin.every((p) => p.speed != null), 'de beheerder ziet ze volledig, zoals overal');
ok(market.listings.some((p: any) => p.id === bobBirds[0].id && p.speed != null), 'zijn zoekertje staat bij de zoekertjes, volledig zichtbaar');
ok(Array.isArray(market.trades) && Array.isArray(market.auctions) && market.boost, 'historiek, veilingen en de boostprijs zijn er nog');

console.log('\n2. /market/biddable/:speler: de duiven van één speler');
const his = (await call(`/market/biddable/${bob.user.id}`, 'GET', undefined, an.token)).json.pigeons as any[];
ok(his.length === bobBirds.length - 1 && his.every((p) => p.ownerId === bob.user.id), 'al zijn duiven die niet te koop staan, en enkel de zijne');
ok(!his.some((p) => p.id === bobBirds[0].id), 'de duif die te koop staat zit er niet bij');
ok(his.every((p) => p.revealed === false && p.speed === null && typeof p.talent === 'number' && typeof p.minPrice === 'number'),
  'eigenschappen verborgen, ★ en de minimumprijs wel');
ok(his.every((p, i) => i === 0 || his[i - 1].talent >= p.talent), 'gesorteerd op ★');
const botId = (d1._raw.prepare('SELECT user_id FROM lofts WHERE is_bot = 1 LIMIT 1').get() as any).user_id;
ok(((await call(`/market/biddable/${botId}`, 'GET', undefined, an.token)).json.pigeons as any[]).length === 0, 'een bot: niets');
ok(((await call(`/market/biddable/${an.user.id}`, 'GET', undefined, an.token)).json.pigeons as any[]).length === 0, 'jezelf: niets');
ok((await call(`/market/biddable/${bob.user.id}`)).status === 401, 'zonder in te loggen: 401');
const bid = await call(`/pigeons/${his[0].id}/offer`, 'POST', { amount: his[0].minPrice }, an.token);
ok(bid.status === 200, 'een bod op zo een duif werkt');

console.log('\n3. /market/auctions: enkel de veilingen, op de smalle load');
{
  // An open auction with a bird of the auction house.
  const s = await D1Store.load(d1);
  const lot = { ...s.data.pigeons.find((p) => p.ownerId === botId)!, id: 'pig_lot_1', ownerId: 'auction_house', name: 'Lot Eén', forSale: false };
  s.data.pigeons.push(lot);
  const now = Date.now();
  s.data.auctions.push({
    id: 'auc_test_1', templateKey: 'auction:test', pigeonId: lot.id, startAt: new Date(now - 3600_000).toISOString(),
    endAt: new Date(now + 3600_000).toISOString(), minBid: 100, minIncrement: 10, currentBid: 0,
    currentBidderId: null, currentBidderName: null, bids: [], status: 'open',
  } as any);
  s.data.world.lastAdvance = new Date().toISOString(); // the engine is fresh → narrow load
  await s.persist();
}
queries.length = 0;
const auctions = await call('/market/auctions', 'GET', undefined, an.token);
ok(auctions.status === 200 && auctions.json.auctions.length === 1, 'de lopende veiling komt terug');
ok(auctions.json.auctions[0].pigeon?.name === 'Lot Eén' && auctions.json.auctions[0].pigeon.speed != null, 'met haar duif, volledig zichtbaar');
const pigeonQueries = queries.filter((q) => /FROM pigeons/.test(q));
ok(pigeonQueries.length === 1 && /WHERE owner_id = \?/.test(pigeonQueries[0]), 'de duiven kwamen van de smalle load (eigen duiven + de veilingduif), niet de hele tabel');
const full = (await call('/market', 'GET', undefined, an.token)).json.auctions;
ok(JSON.stringify(full) === JSON.stringify(auctions.json.auctions), 'en ze is identiek aan de veilingen in /market');

console.log('\n4. /state: de ranglijst één keer');
const state = (await call('/state', 'GET', undefined, an.token)).json;
ok(!('leaderboard' in state.world), 'niet meer als ruwe tekst in `world`');
ok(Array.isArray(state.rankings) && state.rankings.length > 0 && 'pigeonRankings' in state, 'wel uitgepakt, zoals altijd');
ok(typeof state.world.seasonWeek === 'number' && 'marketNewsAt' in state.world, 'de rest van `world` is er nog');

console.log(`\n${fail === 0 ? 'Alles OK' : 'MISLUKT'} — ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
