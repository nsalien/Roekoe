/**
 * Integration test for the partial-load store (core/d1.ts) against a real SQLite
 * engine, standing in for D1. Verifies the three things that could break when a
 * table is no longer loaded whole:
 *   1. the right (small) slice comes back,
 *   2. nothing gets deleted just because it wasn't loaded,
 *   3. the SQL cleanups actually bound the tables.
 * Run: npx tsx d1-partial-load.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { D1Store, ensureSchema, findUserById, findUserByUsername } from './core/d1.js';
import { readFileSync } from 'node:fs';

let rowsRead = 0;

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { bound.push(...args); return api; },
      async first() {
        const r = sql.prepare(query).get(...(bound as any[]));
        if (r) rowsRead += 1;
        return r ?? null;
      },
      async all() {
        const results = sql.prepare(query).all(...(bound as any[]));
        rowsRead += results.length;
        return { results };
      },
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

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }
  else console.log(`  ✓ ${msg}`);
}

const db = fakeD1();
db._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
await ensureSchema(db);

// --- seed: 3 players, a fat notification/trade/bet history ------------------
const now = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
const users = ['alice', 'bob', 'carol'];
for (const [i, u] of users.entries()) {
  db._raw.prepare('INSERT INTO users (id, username, password_hash, is_admin, is_bot, created_at) VALUES (?,?,?,0,0,?)')
    .run(`usr_${u}`, u, `hash_${u}`, now(i));
  db._raw.prepare('INSERT INTO lofts (user_id, name, money, food, feed_ration, capacity) VALUES (?,?,?,0,?,8)')
    .run(`usr_${u}`, `Hok ${u}`, 5000, 'normal');
  for (let n = 0; n < 60; n++) {
    db._raw.prepare('INSERT INTO notifications (id, user_id, kind, title, body, flight_id, created_at, read) VALUES (?,?,?,?,?,NULL,?,0)')
      .run(`ntf_${u}_${n}`, `usr_${u}`, 'info', `t${n}`, 'b', now(n));
  }
}
for (let t = 0; t < 250; t++) {
  db._raw.prepare('INSERT INTO trades (id, pigeon_id, pigeon_name, seller_id, seller_name, buyer_id, buyer_name, price, at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(`trd_${t}`, `pig_${t}`, 'Duif', 'usr_bob', 'bob', 'usr_alice', 'alice', 100, now(t));
}
// bob has settled bets; every player has one open bet.
for (let x = 0; x < 150; x++) {
  db._raw.prepare("INSERT INTO bets (id, user_id, user_name, flight_id, kind, pigeon_id, pigeon_name, rival_id, rival_name, stake, ratio, potential_win, status, placed_at, settled_at) VALUES (?,?,?,?,?,NULL,?,NULL,NULL,10,2,20,'lost',?,?)")
    .run(`bet_bob_${x}`, 'usr_bob', 'bob', 'fl_1', 'win', 'Duif', now(x), now(x));
}
for (const u of users) {
  db._raw.prepare("INSERT INTO bets (id, user_id, user_name, flight_id, kind, pigeon_id, pigeon_name, rival_id, rival_name, stake, ratio, potential_win, status, placed_at, settled_at) VALUES (?,?,?,?,?,NULL,?,NULL,NULL,10,2,20,'open',?,NULL)")
    .run(`bet_open_${u}`, `usr_${u}`, u, 'fl_live', 'win', 'Duif', now(999));
}

const count = (t: string) => db._raw.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c as number;

// --- 1. what a viewer actually loads ----------------------------------------
console.log('\nPartiële load (viewer = alice)');
rowsRead = 0;
const store = await D1Store.load(db, 'usr_alice');
const loadCost = rowsRead;
assert(store.data.notifications.length === 40 || store.data.notifications.length === 60,
  `alleen alice's inbox geladen (${store.data.notifications.length} rijen, geen 180)`);
assert(store.data.notifications.every((n) => n.userId === 'usr_alice'), 'geen inbox van andere spelers geladen');
assert(store.data.trades.length === 100, `trades afgetopt op 100 (van ${count('trades')} op schijf)`);
assert(store.data.trades[store.data.trades.length - 1].id === 'trd_249', 'nieuwste trade zit erbij (juiste kant van de LIMIT)');
assert(store.data.bets.filter((b) => b.status === 'open').length === 3, 'álle open weddenschappen geladen (ook van anderen)');
assert(store.data.bets.filter((b) => b.status !== 'open').every((b) => b.userId === 'usr_alice'),
  'afgehandelde weddenschappen enkel van de viewer');

const fullRows = count('users') + count('lofts') + count('notifications') + count('trades') + count('bets');
console.log(`  → ${loadCost} rijen gelezen i.p.v. ${fullRows} bij een volledige scan`);
assert(loadCost < fullRows / 2, 'leeskost meer dan gehalveerd');

// --- 2. persist mag niets wissen wat niet geladen was ------------------------
console.log('\nPersist met een partiële load');
const beforeNtf = count('notifications');
const beforeTrades = count('trades');
const beforeBets = count('bets');
store.data.lofts.find((l) => l.userId === 'usr_alice')!.money = 4321;
await store.persist();
assert(count('notifications') === beforeNtf, 'meldingen van bob/carol blijven staan');
assert(count('trades') === beforeTrades, 'niet-geladen trades blijven staan');
assert(count('bets') === beforeBets, 'niet-geladen weddenschappen blijven staan');
assert(db._raw.prepare('SELECT money FROM lofts WHERE user_id = ?').get('usr_alice').money === 4321, 'de echte wijziging is wél geschreven');

// --- 3. de SQL-opruiming begrenst de tabellen --------------------------------
console.log('\nBegrensde opruiming (enkel bij een echte toevoeging)');
const s2 = await D1Store.load(db, 'usr_alice');
s2.data.notifications.push({
  id: 'ntf_new', userId: 'usr_carol', kind: 'info', title: 'x', body: 'y',
  flightId: null, createdAt: now(1000), read: false,
});
s2.data.trades.push({
  id: 'trd_new', pigeonId: 'p', pigeonName: 'Duif', sellerId: 'usr_bob', sellerName: 'bob',
  buyerId: 'usr_alice', buyerName: 'alice', price: 1, at: now(1000),
});
s2.data.bets.push({
  id: 'bet_new', userId: 'usr_bob', userName: 'bob', flightId: 'fl_1', kind: 'win',
  pigeonId: null, pigeonName: 'Duif', rivalId: null, rivalName: null, stake: 10, ratio: 2,
  potentialWin: 20, status: 'lost', placedAt: now(1000), settledAt: now(1000),
});
await s2.persist();

const carolInbox = db._raw.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ?').get('usr_carol').c as number;
const bobInbox = db._raw.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ?').get('usr_bob').c as number;
assert(carolInbox <= 41, `carol's inbox afgetopt na haar nieuwe melding (${carolInbox})`);
assert(bobInbox === 60, `bob kreeg niets, dus zijn inbox is niet aangeraakt (${bobInbox})`);
assert(count('trades') <= 101, `trades afgetopt (${count('trades')})`);
assert(db._raw.prepare("SELECT COUNT(*) c FROM bets WHERE status = 'open'").get().c === 3, 'open weddenschappen overleven de opruiming');
assert(count('bets') <= 104, `afgehandelde weddenschappen afgetopt (${count('bets')})`);

// --- 4. het lichte inlogpad --------------------------------------------------
console.log('\nLicht inlogpad (geen wereldlading)');
rowsRead = 0;
const byName = await findUserByUsername(db, 'ALICE');
const byId = await findUserById(db, 'usr_alice');
assert(byName?.id === 'usr_alice', 'login vindt de speler hoofdletter-ongevoelig');
assert(byId?.username === 'alice', '/auth/me vindt de speler op id');
assert(rowsRead === 2, `login + me kosten samen ${rowsRead} rijen (was ±${fullRows})`);
assert((await findUserByUsername(db, 'niemand')) === null, 'onbekende gebruiker geeft null');

console.log(process.exitCode ? '\nFAILED' : '\nAlles OK');
