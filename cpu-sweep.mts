/**
 * Breed CPU-overzicht: wat kost elk zwaar stuk werk in het spel?
 * Workers gratis plan geeft 10 ms CPU per invocatie.
 *
 * Run: npx tsx cpu-sweep.mts [aantalDuiven]
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from './core/d1.js';
import { seedWorld, createLoftForUser, enterFlight } from './core/game/engine.js';
import { advanceRealtime } from './core/game/schedule.js';
import { newId } from './core/store.js';
import { generatePigeon } from './core/game/pigeon.js';
import { liveSnapshot, flightCommentary, flightTotalSeconds, finalizeFlight } from './core/game/flight.js';
import { flightDTO, liveFlightDTO, pigeonDTO, playerProfile, auctionsDTO } from './core/presenters.js';
import { previewBet, betsView } from './core/game/betting.js';
import { pigeonSeasonRankings } from './core/game/season.js';
import type { User, Flight } from './core/schema.js';

const N_PIGEONS = Number(process.argv[2] ?? 200);

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (q: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...a: unknown[]) { bound.push(...a); return api; },
      async first() { return sql.prepare(q).get(...(bound as any[])) ?? null; },
      async all() { return { results: sql.prepare(q).all(...(bound as any[])) }; },
      run() { return sql.prepare(q).run(...(bound as any[])); },
    };
    return api;
  };
  return { prepare, async exec(x: string) { sql.exec(x); }, async batch(s: any[]) { for (const y of s) y.run(); }, _raw: sql };
}

const results: { label: string; ms: number }[] = [];
function bench(label: string, fn: () => unknown, runs = 15) {
  try { fn(); } catch (e) { results.push({ label: label + ' (FOUT)', ms: NaN }); return; }
  const ts: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = process.hrtime.bigint();
    fn();
    ts.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  ts.sort((a, b) => a - b);
  results.push({ label, ms: ts[Math.floor(ts.length / 2)] });
}

const db = fakeD1();
db._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
db._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,0)').run();
while (!(await ensureSchema(db))) { /* resume */ }

const T0 = Date.parse('2026-08-16T04:00:00Z');
let store = await D1Store.load(db, undefined);
seedWorld(store);
await store.persist();

store = await D1Store.load(db, undefined);
const humans: string[] = [];
for (let i = 0; i < 10; i++) {
  const u: User = { id: newId('usr'), username: `speler${i}`, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString() };
  store.mutate((d) => d.users.push(u));
  createLoftForUser(store, u, `Hok ${i}`);
  humans.push(u.id);
}
store.mutate((d) => {
  const owners = d.lofts.map((l) => l.userId);
  let i = 0;
  while (d.pigeons.length < N_PIGEONS) {
    const p = generatePigeon({ currentWeek: d.world.currentWeek, quality: 0.5 });
    p.ownerId = owners[i % owners.length];
    d.pigeons.push(p);
    i += 1;
  }
});
await store.persist();
for (let t = 0; t < 100; t++) {
  db._raw.prepare('INSERT INTO trades (id, pigeon_id, pigeon_name, seller_id, seller_name, buyer_id, buyer_name, price, at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(`trd_${t}`, `p`, 'Duif', humans[0], 'a', humans[1], 'b', 100, new Date(T0 - t * 60000).toISOString());
}
for (const h of humans) {
  for (let n = 0; n < 40; n++) {
    db._raw.prepare('INSERT INTO notifications (id, user_id, kind, title, body, flight_id, created_at, read) VALUES (?,?,?,?,?,NULL,?,0)')
      .run(`ntf_${h}_${n}`, h, 'i', 't', 'b', new Date(T0 - n * 60000).toISOString());
  }
}

store = await D1Store.load(db, undefined);
advanceRealtime(store.data, T0 + 120_000, new Map());
await store.persist();
store = await D1Store.load(db, undefined);
const target = store.data.flights.filter((f) => f.status === 'scheduled' && !f.practice && !f.relay).sort((a, b) => b.distanceKm - a.distanceKm)[0]!;
for (const h of humans) {
  const s2 = await D1Store.load(db, h);
  for (const p of s2.data.pigeons.filter((p) => p.ownerId === h).slice(0, 8)) enterFlight(s2, h, target.id, p.id);
  await s2.persist();
}

// --- Vóór de start: weddenschappen ---
const pre = await D1Store.load(db, humans[0]);
const preFlight = pre.data.flights.find((f) => f.id === target.id)!;
const myBird = pre.data.pigeons.find((p) => p.ownerId === humans[0] && preFlight.entries.some((e) => e.pigeonId === p.id))!;
bench(`previewBet (Monte-Carlo, ${preFlight.entries.length} duiven)`, () => previewBet(pre.data, preFlight, 'win', humans[0], myBird.id, null, 100), 5);
bench('betsView', () => betsView(pre.data, humans[0]));

// --- Live vlucht ---
const startMs = Date.parse(preFlight.startAt);
let s = await D1Store.load(db, undefined);
advanceRealtime(s.data, startMs + 1000, new Map());
await s.persist();
s = await D1Store.load(db, undefined);
const live = s.data.flights.find((f) => f.id === target.id)! as Flight;
const total = flightTotalSeconds(live);
const mid = startMs + total * 0.6 * 1000;

console.log(`Vlucht ${live.distanceKm} km · ${live.entries.length} duiven · ${(total / 3600).toFixed(1)} u · ${Math.floor(total / 600)} intervallen`);
console.log(`Wereld ${s.data.pigeons.length} duiven, ${s.data.lofts.length} hokken\n`);

bench('liveSnapshot', () => liveSnapshot(live, mid));
bench('flightCommentary', () => flightCommentary(live, mid));
bench('liveFlightDTO (= /flights/:id/live)', () => liveFlightDTO(s.data, live, mid));

// --- /state en /flights ---
const st = await D1Store.load(db, humans[0]);
const mine = st.data.pigeons.filter((p) => p.ownerId === humans[0]);
bench(`pigeonDTO x${mine.length} (/state)`, () => mine.map((p) => pigeonDTO(st.data, p, humans[0])));
const upcoming = st.data.flights.filter((f) => f.status === 'scheduled' || f.status === 'live');
bench(`flightDTO x${upcoming.length} (/state + /flights)`, () => upcoming.map((f) => flightDTO(st.data, f)));
bench('playerProfile (/profiel)', () => playerProfile(st.data, humans[0]));
bench('auctionsDTO (/market)', () => auctionsDTO(st.data, humans[0]));
bench('pigeonSeasonRankings (/state)', () => pigeonSeasonRankings(st.data));
const all = st.data.pigeons.filter((p) => p.ownerId !== humans[0]);
bench(`pigeonDTO x${all.length} (/market biddable)`, () => all.map((p) => pigeonDTO(st.data, p, humans[0])));

// --- Afronding ---
const fin = await D1Store.load(db, undefined);
const finFlight = fin.data.flights.find((f) => f.id === target.id)!;
bench('finalizeFlight', () => finalizeFlight(structuredClone(finFlight), fin.data.pigeons), 5);

// --- Infrastructuur ---
const t1 = process.hrtime.bigint();
for (let i = 0; i < 10; i++) await D1Store.load(db, humans[0]);
results.push({ label: 'D1Store.load (elke request)', ms: Number(process.hrtime.bigint() - t1) / 1e6 / 10 });
const s5 = await D1Store.load(db, humans[0]);
bench('advanceRealtime (elke schrijf-request)', () => advanceRealtime(s5.data, mid, new Map()));
const t2 = process.hrtime.bigint();
for (let i = 0; i < 10; i++) { const x = await D1Store.load(db, humans[0]); await x.persist(); }
results.push({ label: 'load + persist (ongewijzigd)', ms: Number(process.hrtime.bigint() - t2) / 1e6 / 10 });

results.sort((a, b) => (b.ms || 0) - (a.ms || 0));
console.log('Kost per operatie (mediaan), duurste eerst — budget is 10 ms per verzoek:\n');
for (const r of results) {
  const bar = '█'.repeat(Math.min(40, Math.round((r.ms || 0) * 2)));
  const flag = r.ms >= 10 ? '  ⛔ OVER BUDGET' : r.ms >= 3 ? '  ⚠️' : '';
  console.log(`  ${(r.ms || 0).toFixed(2).padStart(7)} ms  ${r.label.padEnd(42)} ${bar}${flag}`);
}
