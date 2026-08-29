/**
 * Diagnose: wat kost `SELECT * FROM pigeons` ons echt?
 *
 * ⚠️ De query zélf is I/O. Wachten op D1 telt NIET mee voor de 10 ms CPU van een
 * Worker-invocatie; wat wél telt is wat er met die rijen gebeurt: ze omzetten
 * naar entiteiten, ze snapshotten voor de diff, en ze achteraf weer vergelijken.
 * Lokaal draait SQLite synchroon in hetzelfde proces, dus een kale timing meet
 * beide door elkaar en zegt niets.
 *
 * Daarom meet dit script de MARGINALE kost: hetzelfde verzoek bij een oplopend
 * aantal duiven. De helling is wat de duiven kosten, los van de vaste kost — en
 * die helling is in productie wél zo goed als volledig CPU.
 *
 * Geen assertie: dit is een meetinstrument, zoals cpu-sweep.mts.
 * Run: npx tsx cpu-pigeons.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from './core/d1.js';
import { seedWorld, createLoftForUser } from './core/game/engine.js';
import { advanceRealtime } from './core/game/schedule.js';
import { generatePigeon } from './core/game/pigeon.js';
import { newId } from './core/store.js';
import type { User } from './core/schema.js';

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (q: string) => { const b: unknown[] = []; const api: any = {
    bind(...a: unknown[]) { b.push(...a); return api; },
    async first() { return sql.prepare(q).get(...(b as any[])) ?? null; },
    async all() { return { results: sql.prepare(q).all(...(b as any[])) }; },
    run() { return sql.prepare(q).run(...(b as any[])); } }; return api; };
  return { prepare, async exec(q: string) { sql.exec(q); }, async batch(s: any[]) { for (const x of s) x.run(); }, _raw: sql };
}

async function world(target: number) {
  const d1 = fakeD1();
  d1._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  d1._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,0)').run();
  while (!(await ensureSchema(d1))) {}
  let store = await D1Store.load(d1, undefined); seedWorld(store); await store.persist();
  store = await D1Store.load(d1, undefined);
  const humans: string[] = [];
  for (let i = 0; i < 10; i++) {
    const u: User = { id: newId('usr'), username: `s${i}`, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
    store.mutate((d) => d.users.push(u)); createLoftForUser(store, u, `Hok ${i}`); humans.push(u.id);
  }
  store.mutate((d) => {
    const owners = d.lofts.map((l) => l.userId);
    let i = 0;
    while (d.pigeons.length < target) {
      const p = generatePigeon({ currentWeek: d.world.currentWeek, quality: 0.5 });
      p.ownerId = owners[i % owners.length]; d.pigeons.push(p); i++;
    }
    while (d.pigeons.length > target) d.pigeons.pop();
  });
  await store.persist();
  const s = await D1Store.load(d1, humans[0]);
  advanceRealtime(s.data, Date.now(), new Map());
  s.data.world.lastAdvance = new Date().toISOString(); // engine "fresh", as the middleware stamps it
  await s.persist();
  return { d1, humans, count: (d1._raw.prepare('SELECT COUNT(*) c FROM pigeons').get() as any).c as number };
}

async function timeAvg(n: number, f: () => Promise<void>) {
  for (let i = 0; i < 3; i++) await f();
  const t = performance.now();
  for (let i = 0; i < n; i++) await f();
  return (performance.now() - t) / n;
}

const SIZES = [40, 120, 200, 300, 420];
const rows: { n: number; full: number; narrow: number; persist: number }[] = [];

for (const size of SIZES) {
  const { d1, humans, count } = await world(size);
  const nowMs = Date.now();
  const full = await timeAvg(25, async () => { await D1Store.load(d1, humans[0]); });
  const narrow = await timeAvg(25, async () => {
    await D1Store.load(d1, humans[0], { narrowWhenIdle: true, nowMs });
  });
  // A read-only poll that is NOT throttled: load + engine + persist.
  const persist = await timeAvg(10, async () => {
    const s = await D1Store.load(d1, humans[0]);
    await s.persist();
  });
  rows.push({ n: count, full, narrow, persist });
}

console.log('\nKost van één verzoek, bij een oplopend aantal duiven in de wereld');
console.log('(lokaal; de HELLING is wat telt, niet de absolute waarde)\n');
console.log('  duiven | volle load | smalle load | load+persist | winst smal');
console.log('  -------+------------+-------------+--------------+-----------');
for (const r of rows) {
  console.log(
    `  ${String(r.n).padStart(6)} | ${r.full.toFixed(2).padStart(9)}ms | ${r.narrow.toFixed(2).padStart(10)}ms | ` +
    `${r.persist.toFixed(2).padStart(11)}ms | ${String(Math.round((1 - r.narrow / r.full) * 100)).padStart(8)}%`,
  );
}

const a = rows[0], b = rows[rows.length - 1];
const slopeFull = (b.full - a.full) / (b.n - a.n);
const slopeNarrow = (b.narrow - a.narrow) / (b.n - a.n);
const slopePersist = (b.persist - a.persist) / (b.n - a.n);
console.log(`\nMarginale kost per duif in de wereld:`);
console.log(`  volle load       ${(slopeFull * 1000).toFixed(1)} µs/duif  → ${(slopeFull * 264).toFixed(2)} ms bij 264 duiven`);
console.log(`  smalle load      ${(slopeNarrow * 1000).toFixed(1)} µs/duif  → ${(slopeNarrow * 264).toFixed(2)} ms bij 264 duiven`);
console.log(`  load + persist   ${(slopePersist * 1000).toFixed(1)} µs/duif  → ${(slopePersist * 264).toFixed(2)} ms bij 264 duiven`);


// ---------------------------------------------------------------------------
// Waarin zit die marginale kost? Ablatie op de twee grote JSON-kolommen.
//
// `race_log` (cap 40 plaatsingen) en `attr_log` (cap 40 skill-wijzigingen) zijn
// veruit de dikste velden op een duif. Ze worden bij ÉLKE load geparsed en in de
// snapshot weer gestringify'd — terwijl de engine ze nooit aanraakt: enkel de
// duif-historiek, de trofeeënkast en de admin-inspector lezen ze.
{
  const { d1, humans } = await world(260);
  const nowMs = Date.now();
  const fill = (n: number) => {
    // Vul beide logs tot hun cap, zoals bij een duif die al weken meedraait.
    const log = JSON.stringify(Array.from({ length: n }, (_, i) => ({
      flightId: `flt_${i}`, name: 'Nationale vlucht', fromCity: 'Bordeaux', toCity: 'Gent',
      distanceKm: 700, startAt: new Date().toISOString(), rank: 3, total: 40, points: 65,
      prize: 500, velocity: 1234.5, finished: true, ownerId: 'usr_x',
    })));
    const attr = JSON.stringify(Array.from({ length: n }, () => ({
      attr: 'speed', from: 70.1, to: 70.6, reason: 'coach', at: new Date().toISOString(),
    })));
    d1._raw.prepare('UPDATE pigeons SET race_log = ?, attr_log = ?').run(log, attr);
  };

  d1._raw.prepare('UPDATE pigeons SET race_log = NULL, attr_log = NULL').run();
  const empty = await timeAvg(25, async () => { await D1Store.load(d1, humans[0]); });
  fill(40);
  const loaded = await timeAvg(25, async () => { await D1Store.load(d1, humans[0]); });

  console.log('\nWaarin zit de kost? (260 duiven, volle load)');
  console.log(`  zonder race_log/attr_log      ${empty.toFixed(2)} ms`);
  console.log(`  met beide logs op hun cap     ${loaded.toFixed(2)} ms`);
  console.log(`  → de twee logboeken kosten    ${(loaded - empty).toFixed(2)} ms  (${Math.round((1 - empty / loaded) * 100)} % van de volle load)`);
  console.log('\n  Die logs worden door de engine NOOIT gelezen — enkel door de');
  console.log('  duif-historiek, de trofeeënkast en de admin-inspector.');
}

// ---------------------------------------------------------------------------
// Parsen of snapshotten? Dat bepaalt welke fix werkt.
{
  const entry = {
    flightId: 'flt_abc123', name: 'Nationale vlucht', fromCity: 'Bordeaux', toCity: 'Gent',
    distanceKm: 700, startAt: new Date().toISOString(), ownerId: 'usr_abc',
    rank: 3, total: 40, points: 65, prize: 500, velocity: 1234.5, finished: true,
  };
  const attr = { attr: 'speed', from: 70.1, to: 70.6, reason: 'coach', at: new Date().toISOString() };
  const raceRaw = JSON.stringify(Array.from({ length: 40 }, () => entry));
  const attrRaw = JSON.stringify(Array.from({ length: 40 }, () => attr));
  const N = 264;
  console.log(`\nEén duif draagt ${((raceRaw.length + attrRaw.length) / 1024).toFixed(1)} KB aan logboeken; ${N} duiven = ${(((raceRaw.length + attrRaw.length) * N) / 1024 / 1024).toFixed(2)} MB per verzoek.`);

  const t = (label: string, f: () => void) => {
    for (let i = 0; i < 3; i++) f();
    const s = performance.now();
    for (let i = 0; i < 10; i++) f();
    console.log(`  ${label.padEnd(46)} ${((performance.now() - s) / 10).toFixed(2)} ms`);
  };
  const parsed = { race: JSON.parse(raceRaw), attr: JSON.parse(attrRaw) };
  console.log(`\nPer volle load van ${N} duiven kost alleen dit al:`);
  t('JSON.parse van beide logs (rowToPigeon)', () => {
    for (let i = 0; i < N; i++) { JSON.parse(raceRaw); JSON.parse(attrRaw); }
  });
  t('JSON.stringify ervan (snapshot voor de diff)', () => {
    for (let i = 0; i < N; i++) JSON.stringify(parsed);
  });
  t('stringify als ze RAW strings blijven', () => {
    for (let i = 0; i < N; i++) JSON.stringify({ race: raceRaw, attr: attrRaw });
  });
}
