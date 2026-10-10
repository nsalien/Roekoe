/**
 * Demomodus: the ready-made world and the in-page API, run in Node on the same
 * sql.js the browser uses (client/demo/d1.ts + client/demo/seed.ts).
 *
 * Checks the world the demo player gets — 8 bots, the flight calendar, a loft
 * of 12 with 2 compartments, a pair on the nest and a sick bird in the
 * infirmary — and that the real API (functions/api/[[path]].ts) answers on it.
 * Run from the repo root: npx tsx tests/demo-world.test.mts
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { DemoD1 } from '../client/demo/d1.ts';
import { createDemoWorld, DEMO_MONEY, DEMO_USER_ID, DEMO_USERNAME, topUpDemoMoney } from '../client/demo/seed.ts';
import { onRequest } from '../functions/api/[[path]].ts';
import { D1Store } from '../core/d1.js';
import { signToken } from '../core/auth.js';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }
  else console.log(`  ✓ ${msg}`);
}

const require = createRequire(new URL('../client/package.json', import.meta.url));
const initSqlJs = require('sql.js');
const SQL = await initSqlJs();
const d1 = new DemoD1(new SQL.Database());
d1.sql.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
await createDemoWorld(d1);

console.log('\nDe klaargezette wereld');
const store = await D1Store.load(d1 as any, DEMO_USER_ID);
const w = store.data;
const loft = w.lofts.find((l) => l.userId === DEMO_USER_ID)!;
const mine = w.pigeons.filter((p) => p.ownerId === DEMO_USER_ID);
assert(w.users.find((u) => u.id === DEMO_USER_ID)?.isAdmin === true, 'de demospeler is beheerder');
assert(w.lofts.filter((l) => l.isBot).length === 8, '8 bots');
assert(w.flights.some((f) => f.status === 'scheduled'), 'de gewone vluchtkalender is gepland');
assert(loft.capacity === 12 && loft.compartments === 2, 'capaciteit 12 met 2 aparte hokken');
assert(loft.money === 100000 && DEMO_MONEY === 100000, `de demospeler start met €100.000 (kreeg €${loft.money})`);
assert(mine.length === 10, `10 duiven (2 vrije plaatsen), kreeg ${mine.length}`);
assert(mine.filter((p) => p.compartment).length === 2, '2 duiven in een apart hok');
assert(w.breedingPairs.filter((bp) => bp.ownerId === DEMO_USER_ID).length === 1, 'één broedend koppel');
const sick = mine.filter((p) => p.ailment && p.inInfirmary);
assert(sick.length === 1, 'één zieke duif in de ziekenboeg');

console.log('\nDe echte API, in de pagina');
const SECRET = 'roekoe-demo-niet-echt';
const token = await signToken({ sub: DEMO_USER_ID, username: DEMO_USERNAME }, SECRET, 3600);
async function call(path: string, method = 'GET', body?: unknown) {
  const request = new Request(`http://demo.local/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res: Response = await (onRequest as any)({
    request, env: { DB: d1, JWT_SECRET: SECRET }, params: {}, data: {},
    waitUntil() {}, passThroughOnException() {}, next: () => Promise.reject(new Error('no next')),
  });
  return { status: res.status, json: await res.json() as any };
}
const me = await call('/auth/me');
assert(me.status === 200 && me.json.isAdmin === true, '/auth/me kent de demospeler als beheerder');
const state = await call('/state');
assert(state.status === 200 && state.json.loft?.capacity === 12, '/state geeft het demohok');
assert(state.json.pigeons?.length === 10, '/state geeft de 10 duiven');
const flights = await call('/flights');
assert(flights.status === 200, '/flights antwoordt');
const lokaal = await call('/lokaal');
assert(lokaal.status === 200, 'Het Lokaal antwoordt (leeg mag)');
const stem = await call('/stem');
assert(stem.status === 200, 'De Stem antwoordt');
const food = await call('/loft/food', 'POST', { type: 'normal', kg: 5 });
assert(food.status === 200, 'een schrijfactie (voer kopen) lukt');

console.log('\nAltijd €100.000 bij de start van de demo');
const moneyNow = async () => (await D1Store.load(d1 as any, DEMO_USER_ID)).data.lofts.find((l) => l.userId === DEMO_USER_ID)!.money;
async function setMoney(n: number) {
  const s = await D1Store.load(d1 as any, DEMO_USER_ID);
  s.data.lofts.find((l) => l.userId === DEMO_USER_ID)!.money = n;
  await s.persist();
}
await setMoney(41250); // as if the visit spent most of it
await topUpDemoMoney(d1);
assert(await moneyNow() === DEMO_MONEY, 'na uitgaven: bij de volgende start staat de kassa weer op €100.000');
await setMoney(-500); // even in the red
await topUpDemoMoney(d1);
assert(await moneyNow() === DEMO_MONEY, 'ook vanuit het rood terug naar €100.000');
await setMoney(123456);
await topUpDemoMoney(d1);
assert(await moneyNow() === 123456, 'meer dan €100.000 (prijzengeld) blijft staan');
