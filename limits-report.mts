/**
 * What does ONE request cost against each Cloudflare free-plan budget?
 *
 * Builds a production-shaped world (200 birds, 16 lofts, a trade history and a
 * full inbox) and reports queries / rows read / rows written per request kind,
 * then works out how many requests a day each limit allows. The binding limit is
 * **D1 rows read**: every request loads the world, so a plain poll costs ~350
 * rows and the 5M/day budget runs out at ~14k requests.
 *
 * Run: npx tsx limits-report.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from './core/d1.js';
import { seedWorld, createLoftForUser, enterFlight } from './core/game/engine.js';
import { advanceRealtime } from './core/game/schedule.js';
import { newId } from './core/store.js';
import { generatePigeon } from './core/game/pigeon.js';
import type { User } from './core/schema.js';

/** Extra index entries D1 must write per row of a table (write amplification). */
const INDEXES: Record<string, number> = {
  users: 1, lofts: 0, pigeons: 1, breeding_pairs: 0, flights: 2,
  notifications: 2, trades: 1, auctions: 0, auction_bids: 1, bets: 2, offers: 0, world: 0,
};

let queries = 0;
let rowsRead = 0;
let rowsWritten = 0;

function tableOf(sql: string): string {
  const m = sql.match(/(?:INTO|FROM|UPDATE)\s+([a-z_]+)/i);
  return m ? m[1] : '';
}

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { bound.push(...args); return api; },
      async first() {
        queries += 1;
        const r = sql.prepare(query).get(...(bound as any[]));
        if (r) rowsRead += 1;
        return r ?? null;
      },
      async all() {
        queries += 1;
        const results = sql.prepare(query).all(...(bound as any[]));
        rowsRead += results.length;
        return { results };
      },
      run() {
        queries += 1;
        const r = sql.prepare(query).run(...(bound as any[]));
        // D1 bills every index entry it has to rewrite as a "row written".
        const table = /^\s*(WITH|UPDATE|INSERT|DELETE)/i.test(query)
          ? tableOf(query.replace(/^\s*WITH[\s\S]*?\)\s*/i, ''))
          : '';
        rowsWritten += Number(r.changes ?? 0) * (1 + (INDEXES[table] ?? 1));
        return r;
      },
    };
    return api;
  };
  return {
    prepare,
    async exec(q: string) { queries += 1; sql.exec(q); },
    async batch(stmts: any[]) { for (const s of stmts) s.run(); },
    _raw: sql,
  };
}

const db = fakeD1();
db._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
db._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,0)').run();
let ready = false;
while (!ready) ready = await ensureSchema(db);

const T0 = Date.parse('2026-08-16T04:00:00Z');
let store = await D1Store.load(db, undefined);
seedWorld(store);
await store.persist();

store = await D1Store.load(db, undefined);
const humans: string[] = [];
for (let i = 0; i < 10; i++) {
  const user: User = {
    id: newId('usr'), username: `speler${i}`, passwordHash: 'x',
    isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString(),
  };
  store.mutate((d) => d.users.push(user));
  createLoftForUser(store, user, `Hok ${i}`);
  humans.push(user.id);
}
store.mutate((d) => {
  const owners = d.lofts.map((l) => l.userId);
  let i = 0;
  while (d.pigeons.length < 200) {
    const p = generatePigeon({ currentWeek: d.world.currentWeek, quality: 0.5 });
    p.ownerId = owners[i % owners.length];
    d.pigeons.push(p);
    i += 1;
  }
});
await store.persist();

// Production also carries a trade history and a full inbox per player — both are
// read on EVERY request, so they belong in the per-request cost.
for (let t = 0; t < 250; t++) {
  db._raw.prepare('INSERT INTO trades (id, pigeon_id, pigeon_name, seller_id, seller_name, buyer_id, buyer_name, price, at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(`trd_${t}`, `pig_${t}`, 'Duif', humans[0], 'a', humans[1], 'b', 100, new Date(T0 - t * 60000).toISOString());
}
for (const h of humans) {
  for (let n = 0; n < 40; n++) {
    db._raw.prepare('INSERT INTO notifications (id, user_id, kind, title, body, flight_id, created_at, read) VALUES (?,?,?,?,?,NULL,?,0)')
      .run(`ntf_${h}_${n}`, h, 'info', 't', 'b', new Date(T0 - n * 60000).toISOString());
  }
}

const rows: { label: string; q: number; r: number; w: number }[] = [];
async function request(nowMs: number, viewer?: string, label?: string) {
  queries = 0; rowsRead = 0; rowsWritten = 0;
  queries += 1; rowsRead += 1; // gated ensureSchema
  const s = await D1Store.load(db, viewer);
  advanceRealtime(s.data, nowMs, new Map());
  await s.persist();
  if (label) rows.push({ label, q: queries, r: rowsRead, w: rowsWritten });
  return s;
}

await request(T0, undefined, 'kalender plannen (koud)');
await request(T0 + 60_000, humans[0], 'poll, niets te doen');

store = await D1Store.load(db, undefined);
advanceRealtime(store.data, T0 + 120_000, new Map());
const flight = store.data.flights.find((f) => f.status === 'scheduled' && !f.practice)!;
await store.persist();
for (const h of humans) {
  const s2 = await D1Store.load(db, h);
  for (const p of s2.data.pigeons.filter((p) => p.ownerId === h).slice(0, 4)) enterFlight(s2, h, flight.id, p.id);
  await s2.persist();
}
const startMs = Date.parse((await D1Store.load(db, undefined)).data.flights.find((f) => f.id === flight.id)!.startAt);

await request(startMs + 1000, humans[0], 'vlucht start');
await request(startMs + 5 * 60_000, humans[0], 'poll tijdens live vlucht');
await request(startMs + 31 * 60_000, humans[0], 'live poll met energie-aftrek (per 30 min)');
const live = await D1Store.load(db, undefined);
const total = Math.max(...live.data.flights.find((f) => f.id === flight.id)!.sim.map((s) => s.durationSeconds ?? 0));
await request(startMs + (total + 60) * 1000, humans[0], 'vluchtafronding');
await request(Date.parse('2026-08-17T22:00:00Z'), humans[0], 'dagovergang 00:00');

const pad = (s: string, n: number) => s.padEnd(n);
console.log(`\n${pad('Verzoek', 44)} queries  rijen gelezen  rijen geschreven`);
for (const r of rows) {
  console.log(`${pad(r.label, 44)} ${String(r.q).padStart(6)} ${String(r.r).padStart(14)} ${String(r.w).padStart(17)}`);
}

const poll = rows.find((r) => r.label === 'poll, niets te doen')!;
console.log(`\nStorage: ${(db._raw.prepare('SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()').get() as any).b} bytes bij ${store.data.pigeons.length} duiven`);
console.log('\n--- Hoeveel verzoeken/dag haalt elke limiet? (o.b.v. een gewone poll) ---');
console.log(`  Workers verzoeken/dag (100.000)      : 100000 verzoeken`);
console.log(`  D1 rijen gelezen/dag (5.000.000)     : ${Math.floor(5_000_000 / poll.r)} verzoeken  (${poll.r} rijen/poll)`);
console.log(`  D1 rijen geschreven/dag (100.000)    : ${poll.w > 0 ? Math.floor(100_000 / poll.w) : '∞'} verzoeken  (${poll.w} rijen/poll)`);
