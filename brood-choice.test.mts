/**
 * Young that hatch into a FULL loft are never lost silently.
 *
 * The old behaviour truncated the clutch to whatever fitted (`young.slice(0,
 * space)`) and told the owner nothing at all when nothing fitted — money and
 * birds gone without a word. Now the whole clutch is HELD as a `PendingBrood`
 * and the owner picks: keep some, keep all (after freeing perches), or keep none.
 *
 * This test drives the real store + D1 layer, so it also covers the new table
 * surviving a save/load round trip.
 *
 * Run: npx tsx brood-choice.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from './core/d1.js';
import { seedWorld, createLoftForUser, releasePigeon, resolveBrood, startBreeding } from './core/game/engine.js';
import { tickBreedingHatch } from './core/game/schedule.js';
import { newId } from './core/store.js';
import type { Store } from './core/store.js';
import type { User } from './core/schema.js';

let failures = 0;
const ok = (c: boolean, m: string) => { if (!c) failures++; console.log(`${c ? '  ✓' : '  ✗'} ${m}`); };

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { bound.push(...args); return api; },
      async first() { return sql.prepare(query).get(...(bound as any[])) ?? null; },
      async all() { return { results: sql.prepare(query).all(...(bound as any[])) }; },
      run() { return sql.prepare(query).run(...(bound as any[])); },
    };
    return api;
  };
  return { prepare, async exec(q: string) { sql.exec(q); }, async batch(s: any[]) { for (const x of s) x.run(); } };
}

const d1 = fakeD1();
d1.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
d1.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,0)').bind().run();
while (!(await ensureSchema(d1)));

// `startBreeding` stamps `hatchAt` from the real clock, so the hatch checks have
// to be dated from real "now" too — a fixed past timestamp would elapse 0 hours.
const T0 = Date.now();
/** Far enough past `hatchAt` that the per-hour hatch roll is a certainty. */
const HATCHED = 60 * 24 * 3600_000;
const USER: User = { id: newId('usr'), username: 'melker', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString() };

let store = await D1Store.load(d1, undefined);
seedWorld(store);
await store.persist();

store = await D1Store.load(d1, USER.id);
store.mutate((d) => d.users.push(USER));
createLoftForUser(store, USER, 'Het Volle Hok');
await store.persist();

/** Fill the loft to the brim and pair two birds that are certain to hatch twins. */
function primeFullLoftWithPair(s: Store): { sireId: string; damId: string } {
  return s.mutate((d) => {
    const loft = d.lofts.find((l) => l.userId === USER.id)!;
    const mine = d.pigeons.filter((p) => p.ownerId === USER.id);
    const sire = mine.find((p) => p.sex === 'doffer')!;
    const dam = mine.find((p) => p.sex === 'duivin')!;
    // Max libido + energie: `breed` then hits its success and twin ceilings, and
    // `tickBreedingHatch` hatches on the very first check.
    for (const p of [sire, dam]) { p.libido = 100; p.form = 100; p.health = 100; p.ailment = null; }
    // Exactly full: capacity equals the birds already owned.
    loft.capacity = mine.length;
    loft.money = 100000;
    return { sireId: sire.id, damId: dam.id };
  });
}

const { sireId, damId } = primeFullLoftWithPair(store);
ok(startBreeding(store, USER.id, sireId, damId) === null, 'koppelen mag ook met een vol hok');
await store.persist();

// --- Hatch into a full loft -------------------------------------------------
console.log('\nUitkomen in een vol hok');
store = await D1Store.load(d1, USER.id);
const beforeCount = store.data.pigeons.filter((p) => p.ownerId === USER.id).length;
tickBreedingHatch(store.data, T0 + HATCHED);
const myLoft = () => store.data.lofts.find((l) => l.userId === USER.id)!;
const nest = myLoft().pendingBroods[0];
ok(!!nest, 'het nest wacht op een keuze in plaats van te verdwijnen');
ok(nest!.young.length >= 1, `de hele worp is bewaard (${nest!.young.length} jong(en))`);
ok(
  store.data.pigeons.filter((p) => p.ownerId === USER.id).length === beforeCount,
  'geen enkel jong is stilzwijgend in het hok gezet',
);
ok(store.data.breedingPairs.length === 0, 'het koppel is afgehandeld');
ok(
  store.data.notifications.some((n) => n.userId === USER.id && n.title.includes('hok zit vol')),
  'de speler krijgt een melding dat er een keuze wacht',
);
await store.persist();

// --- The nest survives a round trip through D1 ------------------------------
console.log('\nBewaren en herladen');
store = await D1Store.load(d1, USER.id);
const reloaded = myLoft().pendingBroods.find((b) => b.id === nest!.id);
ok(!!reloaded, 'het nest overleeft opslaan en herladen');
ok(reloaded!.young.length === nest!.young.length, 'met evenveel jongen als bij het uitkomen');
ok(reloaded!.young[0].name === nest!.young[0].name, 'en met dezelfde duiven erin');

// A second pair is refused while the nest is open.
ok(
  startBreeding(store, USER.id, sireId, damId) !== null,
  'een nieuw koppel wordt geweigerd zolang het nest openstaat',
);

// --- Keeping more than fits is refused --------------------------------------
console.log('\nKiezen zonder plaats');
const allIds = reloaded!.young.map((y) => y.id);
ok(
  resolveBrood(store, USER.id, reloaded!.id, allIds) !== null,
  'alles houden kan niet zolang het hok vol is',
);
ok(myLoft().pendingBroods.length === 1, 'het nest blijft staan na een geweigerde keuze');
ok(
  resolveBrood(store, USER.id, reloaded!.id, ['pig_bestaat_niet']) !== null,
  'een onbekend jong in de keuze wordt geweigerd',
);

// --- Free a perch, then keep one --------------------------------------------
console.log('\nPlaats maken en één jong houden');
const spare = store.data.pigeons.find((p) => p.ownerId === USER.id && p.id !== sireId && p.id !== damId)!;
ok(releasePigeon(store, USER.id, spare.id) === null, 'een volwassen duif vrijlaten maakt een plaats vrij');
const keepId = allIds[0];
ok(resolveBrood(store, USER.id, reloaded!.id, [keepId]) === null, 'nu kan één jong gehouden worden');
ok(store.data.pigeons.some((p) => p.id === keepId), 'het gekozen jong zit in het hok');
ok(
  allIds.slice(1).every((id) => !store.data.pigeons.some((p) => p.id === id)),
  'de niet-gekozen jongen zijn vrijgelaten',
);
ok(myLoft().pendingBroods.length === 0, 'het nest is afgehandeld');
const loft = myLoft();
ok(loft.stats.babies === 1, 'enkel het gehouden jong telt mee voor de fokstatistiek');
ok(
  store.data.pigeons.filter((p) => p.ownerId === USER.id).length <= loft.capacity,
  'het hok blijft binnen zijn capaciteit',
);
await store.persist();
store = await D1Store.load(d1, USER.id);
ok(myLoft().pendingBroods.length === 0, 'en het afgehandelde nest is ook uit de database weg');

// --- Keeping nothing is a valid answer --------------------------------------
console.log('\nGeen enkel jong houden');
primeFullLoftWithPair(store);
ok(startBreeding(store, USER.id, sireId, damId) === null, 'nieuw koppel na een afgehandeld nest');
tickBreedingHatch(store.data, T0 + 2 * HATCHED);
const nest2 = myLoft().pendingBroods[0];
ok(!!nest2, 'opnieuw een nest in afwachting');
const babiesBefore = store.data.lofts.find((l) => l.userId === USER.id)!.stats.babies;
ok(resolveBrood(store, USER.id, nest2.id, []) === null, 'niets houden is een geldige keuze');
ok(myLoft().pendingBroods.length === 0, 'het nest is opgeruimd');
ok(
  store.data.lofts.find((l) => l.userId === USER.id)!.stats.babies === babiesBefore,
  'een leeg gehouden nest telt niet mee als geboorte',
);
ok(
  store.data.notifications.some((n) => n.userId === USER.id && n.title.includes('vrijgelaten')),
  'de speler krijgt te horen dat de jongen zijn uitgevlogen',
);

// --- Someone else's nest is not yours ---------------------------------------
console.log('\nEen nest van een ander');
const other: User = { id: newId('usr'), username: 'buur', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString() };
store.mutate((d) => d.users.push(other));
createLoftForUser(store, other, 'Hok van de buur');
store.mutate((d) => {
  d.lofts.find((l) => l.userId === other.id)!.pendingBroods = [{
    id: newId('brood'), sireId: 'x', damId: 'y', sireName: 'A', damName: 'B',
    young: [], dynasty: false, createdAt: new Date(T0).toISOString(), createdAtWeek: 1,
  }];
});
const foreign = store.data.lofts.find((l) => l.userId === other.id)!.pendingBroods[0];
ok(resolveBrood(store, USER.id, foreign.id, []) !== null, 'je kan het nest van een ander niet afhandelen');

console.log(failures === 0 ? '\n✅ Alles in orde\n' : `\n❌ ${failures} test(s) gefaald\n`);
process.exit(failures === 0 ? 0 : 1);
