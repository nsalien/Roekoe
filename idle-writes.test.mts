/**
 * A poll where nothing happens must write NOTHING.
 *
 * D1's free plan allows 100k rows written per day. Anything that stamps "now"
 * into a row on every request (a healing clock, a spawn timestamp) turns every
 * poll into a write, and with a 20-second poll that drains the daily budget on
 * its own — after which every write fails and nobody can play. This test polls
 * repeatedly in a live and a quiet world and asserts the rows written stay zero.
 *
 * Run: npx tsx idle-writes.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from './core/d1.js';
import { seedWorld, createLoftForUser, enterFlight } from './core/game/engine.js';
import { advanceRealtime } from './core/game/schedule.js';
import { newId } from './core/store.js';
import { generatePigeon } from './core/game/pigeon.js';
import { randomDisease } from './core/game/health.js';
import type { User } from './core/schema.js';

const written: Record<string, number> = {};

function tableOf(sql: string): string {
  const cleaned = sql.replace(/^\s*WITH[\s\S]*?\)\s*(?=UPDATE)/i, '');
  const m = cleaned.match(/(?:INSERT\s+(?:OR\s+REPLACE\s+)?INTO|UPDATE|DELETE\s+FROM)\s+([a-z_]+)/i);
  return m ? m[1] : `?? ${sql.slice(0, 40)}`;
}

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { bound.push(...args); return api; },
      async first() { return sql.prepare(query).get(...(bound as any[])) ?? null; },
      async all() { return { results: sql.prepare(query).all(...(bound as any[])) }; },
      run() {
        const r = sql.prepare(query).run(...(bound as any[]));
        if (/^\s*(WITH|UPDATE|INSERT|DELETE)/i.test(query) && Number(r.changes) > 0) {
          const t = tableOf(query);
          written[t] = (written[t] ?? 0) + Number(r.changes);
        }
        return r;
      },
    };
    return api;
  };
  return { prepare, async exec(q: string) { sql.exec(q); }, async batch(s: any[]) { for (const x of s) x.run(); }, _raw: sql };
}

const db = fakeD1();
db._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
db._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,0)').run();
while (!(await ensureSchema(db)));

const T0 = Date.parse('2026-08-16T04:00:00Z');
let store = await D1Store.load(db, undefined);
seedWorld(store);
await store.persist();

store = await D1Store.load(db, undefined);
const humans: string[] = [];
for (let i = 0; i < 10; i++) {
  const user: User = { id: newId('usr'), username: `s${i}`, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString() };
  store.mutate((d) => d.users.push(user));
  createLoftForUser(store, user, `Hok ${i}`);
  humans.push(user.id);
}
store.mutate((d) => {
  const owners = d.lofts.map((l) => l.userId);
  let i = 0;
  while (d.pigeons.length < 200) {
    const p = generatePigeon({ currentWeek: d.world.currentWeek, quality: 0.5 });
    p.ownerId = owners[i++ % owners.length];
    d.pigeons.push(p);
  }
  // A few sick birds, as in a real loft.
  for (const p of d.pigeons.slice(0, 6)) p.ailment = randomDisease(d.world.currentWeek, p.health);
});
await store.persist();

// Get a flight live so we measure the state players actually poll in.
store = await D1Store.load(db, undefined);
advanceRealtime(store.data, T0 + 60_000, new Map());
const flight = store.data.flights.find((f) => f.status === 'scheduled' && !f.practice)!;
await store.persist();
for (const h of humans) {
  const s = await D1Store.load(db, h);
  for (const p of s.data.pigeons.filter((p) => p.ownerId === h && !p.ailment).slice(0, 4)) enterFlight(s, h, flight.id, p.id);
  await s.persist();
}
const startMs = Date.parse((await D1Store.load(db, undefined)).data.flights.find((f) => f.id === flight.id)!.startAt);

let failures = 0;

async function poll(nowMs: number, label: string, mustBeQuiet: boolean) {
  for (const k of Object.keys(written)) delete written[k];
  const s = await D1Store.load(db, humans[0]);
  advanceRealtime(s.data, nowMs, new Map());
  await s.persist();
  const total = Object.values(written).reduce((a, x) => a + x, 0);
  const detail = Object.entries(written).map(([t, n]) => `${t}:${n}`).join(' ');
  const bad = mustBeQuiet && total > 0;
  if (bad) failures += 1;
  console.log(`  ${label.padEnd(34)} ${String(total).padStart(4)} rijen  ${(bad ? '✗ schrijft terwijl er niets gebeurt  ' : mustBeQuiet ? '✓  ' : '   ')}${detail}`);
  return total;
}

console.log('\nOpeenvolgende polls tijdens een live vlucht (1 minuut uit elkaar):');
// The first poll of a series may legitimately catch up on real events; the
// ones after it, a minute apart, must be free.
for (let i = 1; i <= 6; i++) await poll(startMs + (10 + i) * 60_000, `poll ${i} (${10 + i} min na start)`, i > 1);

console.log('\nOpeenvolgende polls met de vlucht al afgelopen:');
const done = startMs + 20 * 3600_000;
// Twintig uur verder ligt er een dagovergang open, en die wordt sinds de CPU-fix
// in stukjes ingehaald (DAILY_CARE_LOFTS_PER_RUN hokken per verzoek). Zulke polls
// schrijven terecht rijen — ze doen echt werk. Laat de achterstand eerst leeglopen
// en eis daarna stilte: dát is wat deze test bewaakt (geen klok die bij élk
// verzoek een rij stempelt).
let drained = 0;
while (drained < 60) {
  const n = await poll(done + (drained + 1) * 60_000, `inhalen ${drained + 1}`, false);
  drained += 1;
  if (n === 0) break;
}
for (let i = 1; i <= 3; i++) await poll(done + (drained + i) * 60_000, `poll ${i} (rustige wereld)`, true);

// Which field of the world row keeps changing?
console.log('\nWereldrij: welk veld beweegt er per poll?');
let prev = '';
for (let i = 1; i <= 3; i++) {
  const s = await D1Store.load(db, humans[0]);
  advanceRealtime(s.data, done + (10 + i) * 60_000, new Map());
  const now = JSON.stringify(s.data.world);
  if (prev) {
    const a = JSON.parse(prev), bb = JSON.parse(now);
    const diffs = Object.keys(bb).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(bb[k]));
    console.log(`  poll ${i}: gewijzigde velden = ${diffs.length ? diffs.map((k) => `${k}: ${JSON.stringify(a[k])} -> ${JSON.stringify(bb[k])}`).join(', ') : '(geen)'}`);
  }
  prev = now;
  await s.persist();
}

if (failures > 0) {
  console.error(`\nFAILED — ${failures} poll(s) schreven rijen terwijl er niets gebeurde.`);
  process.exitCode = 1;
} else {
  console.log('\nAlles OK — een poll zonder gebeurtenissen schrijft niets.');
}
