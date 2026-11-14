/**
 * Gelijktijdige verzoeken op dezelfde vlucht (14 nov).
 *
 * De vluchtrij werd als geheel weggeschreven. Twee spelers die op hetzelfde moment
 * voor dezelfde vlucht inschreven, laadden elk de lijst zonder de duif van de
 * ander; de laatste schrijver won, de andere betaalde zijn inschrijfgeld, kreeg
 * "ok" en stond niet op de vlucht. En een verzoek dat enkel een tribune-regel
 * postte, schreef de `status` en `results` terug die het geladen had: een vlucht
 * die een ander verzoek net afgerond had, werd zo weer `live`.
 *
 * Nu: vluchten per kolom (zoals duiven en hokken), en de inschrijvingen als een
 * samenvoeging in SQL (`entryMergeStatements`, core/d1.ts).
 *
 * De nep-D1 hier WACHT bij elke query, zoals de echte D1 (een netwerkronde): zonder
 * dat lopen twee verzoeken in Node netjes na elkaar en zie je de race nooit.
 *
 * Run: npx tsx tests/flight-concurrency.test.mts
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/[[path]].ts';
import { D1Store, ensureSchema } from '../core/d1.js';
import { seedWorld } from '../core/game/engine.js';
import { advanceRealtime } from '../core/game/schedule.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const val = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  const tick = () => new Promise<void>((r) => setTimeout(r, 1));
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { bound.push(...args.map(val)); return api; },
      async first() { await tick(); return sql.prepare(query).get(...(bound as any[])) ?? null; },
      async all() { await tick(); return { results: sql.prepare(query).all(...(bound as any[])) }; },
      async run() { return sql.prepare(query).run(...(bound as any[])); },
    };
    return api;
  };
  return {
    prepare,
    async exec(query: string) { sql.exec(query); },
    // One batch = one transaction, as on D1: nothing of another request in between.
    async batch(stmts: any[]) { await tick(); for (const st of stmts) await st.run(); },
    _raw: sql,
  };
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
const SECRET = 'test-geheim';
async function call(path: string, method = 'GET', body?: unknown, token?: string) {
  const request = new Request(`http://t.local/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res: Response = await (onRequest as any)({
    request, env: { DB: d1, JWT_SECRET: SECRET, INVITE_CODE: '' }, params: {}, data: {},
    waitUntil() {}, passThroughOnException() {}, next: () => Promise.reject(new Error('no next')),
  });
  return { status: res.status, json: await res.json() as any };
}
const entriesOf = (flightId: string): { pigeonId: string; ownerId: string; leg?: number }[] =>
  JSON.parse((d1._raw.prepare('SELECT entries FROM flights WHERE id = ?').get(flightId) as any).entries);
const moneyOf = (userId: string): number =>
  (d1._raw.prepare('SELECT money FROM lofts WHERE user_id = ?').get(userId) as any).money;

const a = (await call('/auth/register', 'POST', { username: 'an', password: 'an-geheim', loftName: 'Hok An' })).json;
const b = (await call('/auth/register', 'POST', { username: 'bob', password: 'bob-geheim', loftName: 'Hok Bob' })).json;
const stateA = (await call('/state', 'GET', undefined, a.token)).json;
const stateB = (await call('/state', 'GET', undefined, b.token)).json;
const birdsA: string[] = stateA.pigeons.filter((p: any) => p.canRace).map((p: any) => p.id);
const birdsB: string[] = stateB.pigeons.filter((p: any) => p.canRace).map((p: any) => p.id);
// A plain competition flight far enough ahead: no league (score limits), no titan/relay.
const flight = stateA.scheduledFlights.find((f: any) =>
  f.status === 'scheduled' && !f.practice && !f.titan && !f.relay && !f.league && Date.parse(f.startAt) > Date.now() + 3600_000);
const F: string = flight.id;
const fee: number = flight.entryFee;

console.log('\n1. Twee spelers schrijven op hetzelfde moment in voor dezelfde vlucht');
for (let round = 0; round < 3; round++) {
  const mA = moneyOf(a.user.id), mB = moneyOf(b.user.id);
  const [ra, rb] = await Promise.all([
    call(`/flights/${F}/enter`, 'POST', { pigeonId: birdsA[0] }, a.token),
    call(`/flights/${F}/enter`, 'POST', { pigeonId: birdsB[0] }, b.token),
  ]);
  const ids = entriesOf(F).map((e) => e.pigeonId);
  ok(ra.status === 200 && rb.status === 200, `ronde ${round + 1}: beide krijgen "ok"`);
  ok(ids.includes(birdsA[0]) && ids.includes(birdsB[0]), `ronde ${round + 1}: beide duiven staan op de vlucht`);
  ok(new Set(ids).size === ids.length, `ronde ${round + 1}: geen duif staat er twee keer op`);
  // The daily-mission reward for entering may come on top, so: at most the fee.
  ok(mA - moneyOf(a.user.id) <= fee && mB - moneyOf(b.user.id) <= fee, `ronde ${round + 1}: elk betaalt hoogstens één inschrijfgeld`);
  await call(`/flights/${F}/withdraw`, 'POST', { pigeonId: birdsA[0] }, a.token);
  await call(`/flights/${F}/withdraw`, 'POST', { pigeonId: birdsB[0] }, b.token);
}
ok(!entriesOf(F).some((e) => e.pigeonId === birdsA[0] || e.pigeonId === birdsB[0]), 'na het uitschrijven zijn beide er weer af');

console.log('\n2. De ene schrijft in terwijl de andere uitschrijft');
await call(`/flights/${F}/enter`, 'POST', { pigeonId: birdsA[0] }, a.token);
await Promise.all([
  call(`/flights/${F}/withdraw`, 'POST', { pigeonId: birdsA[0] }, a.token),
  call(`/flights/${F}/enter`, 'POST', { pigeonId: birdsB[0] }, b.token),
]);
{
  const ids = entriesOf(F).map((e) => e.pigeonId);
  ok(!ids.includes(birdsA[0]), 'de uitgeschreven duif is eraf');
  ok(ids.includes(birdsB[0]), 'de ingeschreven duif staat erop');
}

console.log('\n3. De bots die er al op stonden, blijven staan');
{
  const before = entriesOf(F).filter((e) => e.ownerId !== a.user.id && e.ownerId !== b.user.id).length;
  await Promise.all([
    call(`/flights/${F}/enter`, 'POST', { pigeonId: birdsA[1] }, a.token),
    call(`/flights/${F}/enter`, 'POST', { pigeonId: birdsB[1] }, b.token),
  ]);
  const after = entriesOf(F).filter((e) => e.ownerId !== a.user.id && e.ownerId !== b.user.id).length;
  ok(after === before, `de inschrijvingen van de anderen zijn ongemoeid (${before} → ${after})`);
}

console.log('\n4. Twee verzoeken voegen dezelfde duif toe: één inschrijving');
{
  const s1 = await D1Store.load(d1), s2 = await D1Store.load(d1);
  const bot = s1.data.lofts.find((l) => l.isBot)!;
  const bird = s1.data.pigeons.find((p) => p.ownerId === bot.userId && !entriesOf(F).some((e) => e.pigeonId === p.id))!;
  for (const s of [s1, s2]) s.data.flights.find((f) => f.id === F)!.entries.push({ pigeonId: bird.id, ownerId: bot.userId });
  await Promise.all([s1.persist(), s2.persist()]);
  ok(entriesOf(F).filter((e) => e.pigeonId === bird.id).length === 1, 'ze staat er precies één keer op');
}

console.log('\n5. Een etappe wisselen vervangt de inschrijving, zonder dubbels');
{
  const s = await D1Store.load(d1);
  const f = s.data.flights.find((x) => x.id === F)!;
  const first = f.entries[0];
  f.entries = f.entries.map((e) => (e.pigeonId === first.pigeonId ? { ...e, leg: 2 } : e));
  await s.persist();
  const now = entriesOf(F);
  ok(now.filter((e) => e.pigeonId === first.pigeonId).length === 1 && now.find((e) => e.pigeonId === first.pigeonId)!.leg === 2,
    'de gewijzigde inschrijving staat er één keer op, met de nieuwe etappe');
  const s2 = await D1Store.load(d1);
  const f2 = s2.data.flights.find((x) => x.id === F)!;
  f2.entries = f2.entries.map((e) => { const { leg, ...rest } = e; return e.pigeonId === first.pigeonId ? rest : e; });
  await s2.persist();
}

console.log('\n6. Een verouderd verzoek zet een afgeronde vlucht niet terug op live');
{
  const stale = await D1Store.load(d1);
  const fresh = await D1Store.load(d1);
  const ff = fresh.data.flights.find((x) => x.id === F)!;
  ff.status = 'completed';
  ff.recap = 'Afgerond door een ander verzoek.';
  await fresh.persist();
  // The stale request only shouts on the tribune and enters a bird.
  const sf = stale.data.flights.find((x) => x.id === F)!;
  sf.chat = [...(sf.chat ?? []), { id: 'c1', at: new Date().toISOString(), userId: a.user.id, userName: 'Hok An', templateId: 't', text: 'Hup!', cat: 'cheer' }];
  await stale.persist();
  const row = d1._raw.prepare('SELECT status, recap, chat FROM flights WHERE id = ?').get(F) as any;
  ok(row.status === 'completed' && row.recap === 'Afgerond door een ander verzoek.', 'status en verslag van de afronding blijven staan');
  ok(JSON.parse(row.chat).some((c: any) => c.id === 'c1'), 'de tribune-regel is wel bewaard');
}

console.log('\n7. Een poll zonder wijziging schrijft niets naar de vluchten');
{
  const before = d1._raw.prepare('SELECT total_changes() AS n').get() as any;
  const s = await D1Store.load(d1);
  await s.persist();
  const after = d1._raw.prepare('SELECT total_changes() AS n').get() as any;
  ok(after.n === before.n, 'geen enkele rij geschreven');
}

console.log(`\n${fail === 0 ? 'Alles OK' : 'MISLUKT'} — ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
