/**
 * How many D1 queries does ONE request cost?
 *
 * D1's free plan allows **50 queries per Worker invocation**, and every
 * statement inside a `batch()` counts. Go over and the request dies before it
 * reaches the game — a 503 on whatever route it happened to be, which is what
 * took the site down twice (see context.md § Performance). This test walks a
 * realistic Sunday — calendar, a live race, its finish, the midnight tick — on a
 * production-sized world and asserts every request stays under budget.
 *
 * Run: npx tsx query-budget.test.mts       (PIGEONS=300 to check headroom)
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from './core/d1.js';
import { seedWorld, createLoftForUser, enterFlight } from './core/game/engine.js';
import { advanceRealtime } from './core/game/schedule.js';
import { newId } from './core/store.js';
import { generatePigeon } from './core/game/pigeon.js';
import type { User } from './core/schema.js';

let queries = 0;
/** SQL van het laatst gemeten verzoek — voor de BREAKDOWN=1-diagnose hieronder. */
const SEEN_SQL: string[] = [];
let batchCalls = 0;
let biggestBatch = 0;

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { bound.push(...args); return api; },
      async first() { queries += 1; SEEN_SQL.push(query); return sql.prepare(query).get(...(bound as any[])) ?? null; },
      async all() { queries += 1; SEEN_SQL.push(query); return { results: sql.prepare(query).all(...(bound as any[])) }; },
      run() { queries += 1; SEEN_SQL.push(query); return sql.prepare(query).run(...(bound as any[])); },
    };
    return api;
  };
  return {
    prepare,
    async exec(q: string) { queries += 1; sql.exec(q); },
    async batch(stmts: any[]) {
      batchCalls += 1;
      biggestBatch = Math.max(biggestBatch, stmts.length);
      for (const s of stmts) s.run();
    },
    _raw: sql,
  };
}

const db = fakeD1();
db._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
db._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,0)').run();
let ready = false;
while (!ready) ready = await ensureSchema(db);

// --- build a production-shaped world ---------------------------------------
// Sunday 16 Aug 2026, 06:00 CEST — before the 08:00 national flight.
const T0 = Date.parse('2026-08-16T04:00:00Z');
let store = await D1Store.load(db, undefined);
seedWorld(store);
await store.persist();

// 10 real players, each with a starting loft (6 pigeons).
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
await store.persist();

// Grow the world to production size (~200 birds across the 16 lofts).
const TARGET_PIGEONS = Number(process.env.PIGEONS ?? 200);
store.mutate((d) => {
  const owners = d.lofts.map((l) => l.userId);
  let i = 0;
  while (d.pigeons.length < TARGET_PIGEONS) {
    const owner = owners[i % owners.length];
    const p = generatePigeon({ currentWeek: d.world.currentWeek, quality: 0.5 });
    p.ownerId = owner;
    d.pigeons.push(p);
    i += 1;
  }
});
await store.persist();

console.log(`Wereld: ${store.data.users.length} gebruikers, ${store.data.lofts.length} hokken, ${store.data.pigeons.length} duiven`);

/** D1 free plan: 50 queries per Worker invocation, batch statements included. */
const D1_QUERIES_PER_INVOCATION_FREE = 50;
let worstRequest = 0;
let failures = 0;

/** One full request: load + advanceRealtime + persist, counting queries. */
async function request(nowMs: number, viewer?: string, label?: string) {
  queries = 0; batchCalls = 0; biggestBatch = 0;
  SEEN_SQL.length = 0;
  queries += 1; // ensureSchema on a warm isolate = 1 query (gated)
  const s = await D1Store.load(db, viewer);
  advanceRealtime(s.data, nowMs, new Map());
  await s.persist();
  if (label) {
    worstRequest = Math.max(worstRequest, queries);
    const over = queries >= D1_QUERIES_PER_INVOCATION_FREE;
    if (over) failures += 1;
    const flag = over ? '  ✗ OVER DE LIMIET' : queries > 40 ? '  ⚠️ weinig marge' : '  ✓';
    console.log(`  ${label.padEnd(46)} ${String(queries).padStart(4)} queries (grootste batch ${biggestBatch})${flag}`);
  }
  return s;
}

console.log('\n--- Verzoeken door de zondag heen ---------------------------------');
// Warm-up: let the scheduler plan the calendar and bots enter.
await request(T0, undefined, 'eerste verzoek (kalender plannen)');
await request(T0 + 60_000, undefined, 'poll, niets te doen');

// Everyone enters the 08:00 national flight.
store = await D1Store.load(db, undefined);
advanceRealtime(store.data, T0 + 120_000, new Map());
const flight = store.data.flights.find((f) => f.status === 'scheduled' && !f.practice && !f.ageCat);
if (!flight) { console.log('geen vlucht gevonden'); process.exit(1); }
await store.persist();
for (const h of humans) {
  const s2 = await D1Store.load(db, h);
  const mine = s2.data.pigeons.filter((p) => p.ownerId === h);
  for (const p of mine.slice(0, 4)) enterFlight(s2, h, flight.id, p.id);
  await s2.persist();
}
const s3 = await D1Store.load(db, undefined);
const f3 = s3.data.flights.find((f) => f.id === flight.id)!;
console.log(`\nVlucht ${f3.type} ${f3.distanceKm} km — ${f3.entries.length} duiven aan de start, start ${f3.startAt}`);

const startMs = Date.parse(f3.startAt);
console.log('\n--- Tijdens de live vlucht ----------------------------------------');
await request(startMs + 1000, humans[0], 'het verzoek dat de vlucht START');
await request(startMs + 5 * 60_000, humans[0], 'live poll (5 min in)');
await request(startMs + 31 * 60_000, humans[0], 'live poll (31 min: energie-aftrek)');
await request(startMs + 61 * 60_000, humans[0], 'live poll (61 min: energie-aftrek)');
await request(startMs + 91 * 60_000, humans[1], 'live poll (91 min, andere speler)');

console.log('\n--- Afronding -----------------------------------------------------');
const sLive = await D1Store.load(db, undefined);
const fLive = sLive.data.flights.find((f) => f.id === flight.id)!;
const total = Math.max(...fLive.sim.map((s) => s.durationSeconds ?? 0));
console.log(`  (vlucht duurt ${Math.round(total / 60)} min)`);
await request(startMs + (total + 60) * 1000, humans[0], 'het verzoek dat de vlucht AFRONDT');
// `BREAKDOWN=1 npx tsx query-budget.test.mts` splitst het duurste verzoek uit
// per statement. Zo vond je dat de meldingen-opruiming 10 van de 49 queries at.
if (process.env.BREAKDOWN) {
  const counts = new Map<string, number>();
  for (const q of SEEN_SQL) {
    const k = q.replace(/\s+/g, ' ').slice(0, 76);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  console.log('\n  statements van DIT verzoek:');
  for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)} × ${k}`);
}

console.log('\n--- Dagovergang (00:00) -------------------------------------------');
const midnight = Date.parse('2026-08-17T22:00:00Z'); // 17 Aug 00:00 CEST + a bit
await request(midnight, humans[0], 'eerste verzoek na middernacht');

console.log(
  `\nDuurste verzoek: ${worstRequest} van de ${D1_QUERIES_PER_INVOCATION_FREE} queries ` +
    `die één Worker-invocatie mag doen (${store.data.pigeons.length} duiven).`,
);
if (failures > 0) {
  console.error(`\nFAILED — ${failures} verzoek(en) over de limiet: die geven in productie een 503.`);
  process.exitCode = 1;
} else {
  console.log('Alles OK');
}

