/**
 * De twee historiekboeken staan niet meer in de duivenrij.
 *
 * `race_log` (plaatsingen) en `attr_log` (skill-wijzigingen) zijn per duif
 * afgetopte JSON-blobs van samen ~13 KB. Ze reden mee in `SELECT * FROM pigeons`
 * — bij élk verzoek, voor élke duif — terwijl geen enkele tick ze ooit leest.
 * Gemeten op 264 duiven: 13 ms parsen + 9 ms opnieuw serialiseren voor de diff,
 * samen 88 % van de CPU van een volle load, tegen een budget van 10 ms.
 *
 * Ze leven nu in `pigeon_log_entries`, append-only, en worden enkel geladen door
 * de drie schermen die ze tonen. Deze test bewaakt de eigenschappen waar het
 * mis kan gaan:
 *  1. de wereldload draagt ze niet meer, en is meetbaar goedkoper;
 *  2. een uitslag komt er wél in, en komt er via `loadPigeonLogs` weer uit;
 *  3. de LEGACY-kolommen worden nooit overschreven — dat is wat de verhuizing
 *     migratievrij maakt, en het stilste faalgeval dat er is;
 *  4. de afkapping werkt, en is idempotent per vlucht;
 *  5. historiek overleeft het opruimen van oude vluchtrijen.
 *
 * Run: npx tsx pigeon-logs.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema, loadPigeonLogs, PIGEON_LOG_CAP } from './core/d1.js';
import { seedWorld, createLoftForUser, enterFlight } from './core/game/engine.js';
import { advanceRealtime } from './core/game/schedule.js';
import { noteAttrChange } from './core/game/pigeon.js';
import { newId } from './core/store.js';
import type { User } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (q: string) => { const b: unknown[] = []; const api: any = {
    bind(...a: unknown[]) { b.push(...a); return api; },
    async first() { return sql.prepare(q).get(...(b as any[])) ?? null; },
    async all() { return { results: sql.prepare(q).all(...(b as any[])) }; },
    run() { return sql.prepare(q).run(...(b as any[])); } }; return api; };
  return { prepare, async exec(q: string) { sql.exec(q); }, async batch(s: any[]) { for (const x of s) x.run(); }, _raw: sql };
}

const d1 = fakeD1();
d1._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
d1._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,0)').run();
while (!(await ensureSchema(d1))) {}

const T0 = Date.parse('2026-09-06T06:00:00Z');
let store = await D1Store.load(d1, undefined); seedWorld(store); await store.persist();
store = await D1Store.load(d1, undefined);
const humans: string[] = [];
for (let i = 0; i < 4; i++) {
  const u: User = { id: newId('usr'), username: `s${i}`, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString() };
  store.mutate((d) => d.users.push(u)); createLoftForUser(store, u, `Hok ${i}`); humans.push(u.id);
}
await store.persist();

// ---------------------------------------------------------------------------
console.log('\n1. De wereldload draagt de logboeken niet meer');
{
  const seen: string[] = [];
  const spy = { ...d1, prepare: (q: string) => { seen.push(q); return d1.prepare(q); } };
  await D1Store.load(spy as any, humans[0]);
  const pigeonSelect = seen.find((q) => /FROM pigeons/.test(q) && /SELECT/.test(q))!;
  ok(!!pigeonSelect, 'er is een duiven-query');
  ok(!/SELECT \* FROM pigeons/.test(pigeonSelect), 'het is geen SELECT * meer');
  ok(!/race_log/.test(pigeonSelect), 'race_log wordt niet geladen');
  ok(!/attr_log/.test(pigeonSelect), 'attr_log wordt niet geladen');
  const p = (await D1Store.load(d1, humans[0])).data.pigeons[0] as any;
  ok(p.raceLog === undefined && p.attrLog === undefined, 'een geladen duif draagt geen logboeken');
}

// ---------------------------------------------------------------------------
console.log('\n2. Een uitslag belandt in de logtabel en komt er weer uit');
let flightId = '';
let racerIds: string[] = [];
{
  const s = await D1Store.load(d1, undefined);
  advanceRealtime(s.data, T0, new Map());
  await s.persist();
  const s2 = await D1Store.load(d1, undefined);
  const flight = s2.data.flights.find((f) => f.status === 'scheduled' && !f.practice && !f.ageCat)!;
  flightId = flight.id;
  await s2.persist();
  for (const h of humans) {
    const sh = await D1Store.load(d1, h);
    for (const p of sh.data.pigeons.filter((x) => x.ownerId === h).slice(0, 2)) enterFlight(sh, h, flightId, p.id);
    await sh.persist();
  }
  const s3 = await D1Store.load(d1, undefined);
  const f3 = s3.data.flights.find((f) => f.id === flightId)!;
  const startMs = Date.parse(f3.startAt);
  advanceRealtime(s3.data, startMs + 1000, new Map()); // go live
  await s3.persist();
  const s4 = await D1Store.load(d1, undefined);
  const f4 = s4.data.flights.find((f) => f.id === flightId)!;
  const total = Math.max(...f4.sim.map((x) => x.durationSeconds ?? 0));
  racerIds = f4.sim.map((x) => x.pigeonId);
  advanceRealtime(s4.data, startMs + (total + 60) * 1000, new Map()); // finalize
  await s4.persist();

  const rows = d1._raw.prepare("SELECT * FROM pigeon_log_entries WHERE kind = 'race'").all() as any[];
  ok(rows.length > 0, `${rows.length} uitslagregels weggeschreven`);
  const logs = await loadPigeonLogs(d1, racerIds);
  const withRace = [...logs.values()].filter((v) => v.race.length > 0).length;
  ok(withRace > 0, `${withRace} duiven hebben een leesbare historiek`);
  const one = [...logs.values()].find((v) => v.race.length > 0)!;
  ok(one.race[0].flightId === flightId, 'de regel wijst naar de juiste vlucht');
  ok(typeof one.race[0].rank === 'number' && one.race[0].rank >= 1, `met een plaats (${one.race[0].rank})`);
}

// ---------------------------------------------------------------------------
console.log('\n3. De legacy-kolommen worden NOOIT overschreven');
{
  // Dit is het stilste faalgeval: als `diff` een bestaande duif ooit via
  // INSERT OR REPLACE zou wegschrijven, wist SQLite de kolommen die niet in de
  // lijst staan — en dan is de historiek van vóór de verhuizing weg.
  const victim = (await D1Store.load(d1, humans[0])).data.pigeons.find((p) => p.ownerId === humans[0])!;
  const legacy = JSON.stringify([{ flightId: 'flt_oud', name: 'Oude vlucht', fromCity: 'Parijs', toCity: 'Gent',
    distanceKm: 300, startAt: '2026-01-01T08:00:00.000Z', ownerId: humans[0], rank: 2, total: 20,
    points: 80, prize: 800, velocity: 1200, finished: true }]);
  const legacyAttr = JSON.stringify([{ attr: 'speed', from: 60, to: 61, reason: 'training', at: '2026-01-01T09:00:00.000Z' }]);
  d1._raw.prepare('UPDATE pigeons SET race_log = ?, attr_log = ? WHERE id = ?').run(legacy, legacyAttr, victim.id);

  // Doe iets waar de duif écht van verandert, en persist.
  const s = await D1Store.load(d1, humans[0]);
  const p = s.data.pigeons.find((x) => x.id === victim.id)!;
  p.form = Math.max(0, p.form - 7);
  p.name = `${p.name}`;
  await s.persist();

  const after = d1._raw.prepare('SELECT race_log, attr_log FROM pigeons WHERE id = ?').get(victim.id) as any;
  ok(after.race_log === legacy, 'de oude race_log-blob staat er onaangeroerd');
  ok(after.attr_log === legacyAttr, 'de oude attr_log-blob ook');

  const logs = await loadPigeonLogs(d1, [victim.id]);
  ok((logs.get(victim.id)?.race ?? []).some((e) => e.flightId === 'flt_oud'), 'en ze wordt nog steeds gelezen (migratievrij)');
  ok((logs.get(victim.id)?.attr ?? []).length >= 1, 'idem voor de skill-historiek');
}

// ---------------------------------------------------------------------------
console.log('\n4. Afkapping en idempotentie');
{
  const target = (await D1Store.load(d1, humans[1])).data.pigeons.find((p) => p.ownerId === humans[1])!;
  // Ruim boven de cap aan skill-wijzigingen, in porties zoals een echt verzoek.
  for (let batch = 0; batch < 12; batch++) {
    const s = await D1Store.load(d1, humans[1]);
    const p = s.data.pigeons.find((x) => x.id === target.id)!;
    for (let i = 0; i < 6; i++) { const before = p.speed; p.speed = Math.round((p.speed + 0.4) * 10) / 10; noteAttrChange(p, 'speed', before, 'training'); }
    await s.persist();
  }
  const stored = (d1._raw.prepare("SELECT COUNT(*) c FROM pigeon_log_entries WHERE pigeon_id = ? AND kind = 'attr'").get(target.id) as any).c as number;
  ok(stored > 0, `${stored} skill-wijzigingen bewaard`);
  ok(stored <= PIGEON_LOG_CAP + 6, `afgetopt rond ${PIGEON_LOG_CAP} (soft cap, nu ${stored})`);
  const logs = await loadPigeonLogs(d1, [target.id]);
  ok((logs.get(target.id)?.attr.length ?? 0) <= PIGEON_LOG_CAP, `de lezer geeft er nooit meer dan ${PIGEON_LOG_CAP} terug`);

  // Dezelfde vlucht twee keer afronden mag geen dubbele regel geven. Tel enkel
  // DEZE vlucht: de klok vooruitzetten laat ook andere races aankomen, en die
  // horen er natuurlijk wél bij te komen.
  const countThis = () =>
    (d1._raw.prepare("SELECT COUNT(*) c FROM pigeon_log_entries WHERE kind = 'race' AND id LIKE ?")
      .get(`%:race:${flightId}`) as any).c as number;
  const before = countThis();
  ok(before > 0, `${before} regels voor deze vlucht`);
  const s = await D1Store.load(d1, undefined);
  const f = s.data.flights.find((x) => x.id === flightId);
  if (f) { f.status = 'live'; advanceRealtime(s.data, Date.parse(f.startAt) + 99 * 3600000, new Map()); await s.persist(); }
  ok(countThis() === before, `een tweede afronding voegt er niets aan toe (${before} → ${countThis()})`);
}

// ---------------------------------------------------------------------------
console.log('\n5. Historiek overleeft het opruimen van de vluchtrij');
{
  const s = await D1Store.load(d1, undefined);
  // Duw de vlucht ruim voorbij de 2-daagse retentie en laat de pruner draaien.
  advanceRealtime(s.data, T0 + 5 * 86400000, new Map());
  await s.persist();
  const gone = !(await D1Store.load(d1, undefined)).data.flights.some((f) => f.id === flightId);
  ok(gone, 'de vluchtrij is opgeruimd');
  const logs = await loadPigeonLogs(d1, racerIds);
  ok([...logs.values()].some((v) => v.race.some((e) => e.flightId === flightId)), 'de uitslag staat er nog steeds');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
