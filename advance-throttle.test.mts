/**
 * De advanceRealtime-throttle (ADVANCE_THROTTLE_SECONDS).
 *
 * Cloudflare doodt een Worker die door zijn CPU heen gaat (Error 1102 — gemeten:
 * 69 op één dag, p50 26 ms / p99 68 ms per verzoek). Van de ~14 ms die een
 * verzoek kost zit ~9 ms in `advanceRealtime` + `persist`, en op een poll waar
 * niets gebeurt is dat weggegooid werk. Een read-only verzoek binnen het venster
 * slaat beide over.
 *
 * Deze test bootst het middleware-pad na en bewaakt drie dingen:
 *  1. een leesverzoek binnen het venster raakt de engine NIET,
 *  2. een schrijvend verzoek draait ALTIJD (nooit een verouderde wereld),
 *  3. de wereldklok loopt niet achter: vluchten starten en de dagovergang
 *     gebeurt nog steeds, hoogstens het venster later.
 *
 * Run: npx tsx advance-throttle.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from './core/d1.js';
import { seedWorld, createLoftForUser, enterFlight } from './core/game/engine.js';
import { advanceRealtime } from './core/game/schedule.js';
import { ADVANCE_THROTTLE_SECONDS } from './core/config/gameConfig.js';
import { newId } from './core/store.js';
import { generatePigeon } from './core/game/pigeon.js';
import type { User } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

let written = 0;
function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (q: string) => { const b: unknown[] = []; const api: any = {
    bind(...a: unknown[]) { b.push(...a); return api; },
    async first() { return sql.prepare(q).get(...(b as any[])) ?? null; },
    async all() { return { results: sql.prepare(q).all(...(b as any[])) }; },
    run() { const r: any = sql.prepare(q).run(...(b as any[]));
      if (/INSERT|UPDATE|DELETE/i.test(q)) written += Number(r?.changes ?? 0); return r; } }; return api; };
  return { prepare, async exec(q: string) { sql.exec(q); }, async batch(s: any[]) { for (const x of s) x.run(); }, _raw: sql };
}

const db = fakeD1();
db._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
db._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,0)').run();
while (!(await ensureSchema(db))) {}

const T0 = Date.parse('2026-08-21T08:00:00Z');
let store = await D1Store.load(db, undefined); seedWorld(store); await store.persist();
store = await D1Store.load(db, undefined);
const humans: string[] = [];
for (let i = 0; i < 6; i++) {
  const u: User = { id: newId('usr'), username: `s${i}`, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString() };
  store.mutate((d) => d.users.push(u)); createLoftForUser(store, u, `Hok ${i}`); humans.push(u.id);
}
await store.persist();
store = await D1Store.load(db, undefined);
store.mutate((d) => { const o = d.lofts.map((l) => l.userId); let i = 0;
  while (d.pigeons.length < 200) { const p = generatePigeon({ currentWeek: d.world.currentWeek, quality: 0.5 }); p.ownerId = o[i % o.length]; d.pigeons.push(p); i++; } });
await store.persist();

/** Eén verzoek door dezelfde beslissing als de middleware. */
let advances = 0;
async function request(nowMs: number, method: 'GET' | 'POST' = 'GET') {
  const s = await D1Store.load(db, humans[0]);
  const last = Date.parse(s.data.world.lastAdvance ?? '');
  const fresh = !Number.isNaN(last) && nowMs - last >= 0 && nowMs - last < ADVANCE_THROTTLE_SECONDS * 1000;
  const throttled = fresh && method === 'GET';
  if (!throttled) {
    advanceRealtime(s.data, nowMs, new Map());
    s.data.world.lastAdvance = new Date(nowMs).toISOString();
    await s.persist();
  }
  return { store: s, throttled };
}

console.log(`\nThrottle staat op ${ADVANCE_THROTTLE_SECONDS} s`);
console.log('\nLeesverzoeken binnen het venster');
await request(T0); // eerste: draait altijd (lastAdvance leeg)
{
  const r1 = await request(T0 + 1000);
  ok(r1.throttled, 'poll 1 s later slaat de engine over');
  const r2 = await request(T0 + 5000);
  ok(r2.throttled, 'poll 5 s later ook');
  const r3 = await request(T0 + (ADVANCE_THROTTLE_SECONDS - 1) * 1000);
  ok(r3.throttled, `poll ${ADVANCE_THROTTLE_SECONDS - 1} s later nog steeds`);
  const r4 = await request(T0 + ADVANCE_THROTTLE_SECONDS * 1000 + 500);
  ok(!r4.throttled, 'net voorbij het venster draait de engine wél weer');
}

console.log('\nSchrijvende verzoeken wachten nooit');
{
  const base = T0 + 60_000;
  await request(base);
  const w = await request(base + 1000, 'POST');
  ok(!w.throttled, 'een POST 1 s later draait de engine tóch');
}

console.log('\nEen doorgethrottelde poll schrijft niets');
{
  const base = T0 + 120_000;
  await request(base);
  written = 0;
  for (let i = 1; i <= 5; i++) await request(base + i * 2000);
  ok(written === 0, `5 doorgethrottelde polls schreven ${written} rijen`);
}

console.log('\nDe wereldklok loopt niet achter');
{
  // Schrijf iedereen in voor de eerstvolgende vlucht en laat de tijd doorlopen
  // met louter leespolls; de vlucht moet gewoon live gaan en afgerond worden.
  let s = await D1Store.load(db, undefined);
  const flight = s.data.flights.find((f) => f.status === 'scheduled' && !f.practice && !f.relay);
  ok(!!flight, 'er staat een gewone vlucht op de kalender');
  for (const h of humans) {
    const s2 = await D1Store.load(db, h);
    for (const p of s2.data.pigeons.filter((p) => p.ownerId === h && p.form > 40).slice(0, 2)) enterFlight(s2, h, flight!.id, p.id);
    await s2.persist();
  }
  const startMs = Date.parse(flight!.startAt);
  // Alleen GET-polls, elke 3 s, tot ruim na de start.
  for (let t = startMs - 30_000; t <= startMs + 120_000; t += 3000) await request(t);
  s = await D1Store.load(db, undefined);
  const f = s.data.flights.find((x) => x.id === flight!.id)!;
  ok(f.status === 'live' || f.status === 'completed', `de vlucht is gestart ondanks alleen leespolls (status ${f.status})`);
  ok(f.sim.length > 0, 'de sim is bevroren, dus de start is echt verwerkt');
}

console.log('\nDe throttle bespaart het leeuwendeel van het werk');
{
  const base = T0 + 400_000;
  await request(base);
  let ran = 0;
  const N = 30;
  for (let i = 1; i <= N; i++) { const r = await request(base + i * 2000); if (!r.throttled) ran++; }
  // 30 polls × 2 s = 60 s → bij een venster van 20 s hoogstens ~3 echte runs.
  ok(ran <= Math.ceil((N * 2) / ADVANCE_THROTTLE_SECONDS) + 1,
    `van ${N} polls over 60 s draaide de engine er ${ran} (venster ${ADVANCE_THROTTLE_SECONDS} s)`);
}

console.log(`\n${fail === 0 ? 'Alles OK' : 'GEFAALD'} — ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
