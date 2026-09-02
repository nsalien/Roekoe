/**
 * Regressietest: kweken heeft een rust tussen twee nesten, en een uitgekomen
 * koppel BLIJFT ontbonden.
 *
 * Dat laatste is het echte faalgeval en het was een gemelde bug: `diff` schreef
 * een koppelrij met INSERT OR REPLACE, dus een gelijktijdig verzoek dat de rij
 * enkel herstempelde zette een net uitgekomen koppel terug — waarna het gewoon
 * bleef doorbroeden. Draai deze test na élke wijziging aan `tickBreedingHatch`,
 * `breeding.ts` of de breeding_pairs-diff in `core/d1.ts`.
 *
 * Run: npx tsx breeding-cooldown.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from './core/d1.js';
import { createLoftForUser, startBreeding } from './core/game/engine.js';
import { advanceRealtime, tickBreedingHatch } from './core/game/schedule.js';
import { breedingCooldownDaysLeft, breedingCooldownUntil } from './core/game/pigeon.js';
import { BREEDING, GAME_WEEKS_PER_REAL_WEEK } from './core/config/gameConfig.js';
import type { User } from './core/schema.js';

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) { failures += 1; process.exitCode = 1; }
}

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
  return {
    prepare,
    async exec(q: string) { sql.exec(q); },
    async batch(stmts: any[]) { for (const s of stmts) s.run(); },
    _raw: sql,
  };
}

async function freshDb() {
  const db = fakeD1();
  db._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  // De world-rij eerst: zonder haar kan ensureSchema zijn voortgang niet bewaren.
  await ensureSchema(db);
  db._raw.prepare('INSERT OR IGNORE INTO world (id, current_week, season_year, seeded) VALUES (1,60,1,1)').run();
  let guard = 0;
  while (!(await ensureSchema(db))) { if (++guard > 60) throw new Error('ensureSchema convergeert niet'); }
  return db;
}

const USER: User = {
  id: 'usr_test', username: 'tester', passwordHash: 'x',
  isAdmin: false, isBot: false, createdAt: new Date().toISOString(),
};

/** Eén speler, één doffer + één duivin, plaats zat. */
async function setup(db: any) {
  const store = await D1Store.load(db, USER.id);
  store.data.users.push(USER);
  createLoftForUser(store, USER, 'Testhok');
  store.mutate((d) => {
    const mine = d.pigeons.filter((p) => p.ownerId === USER.id);
    mine[0].sex = 'doffer';
    mine[1].sex = 'duivin';
    for (const p of mine.slice(0, 2)) { p.libido = 95; p.form = 95; p.ailment = null; }
    d.pigeons = d.pigeons.filter((p) => p === mine[0] || p === mine[1]);
    d.lofts.find((l) => l.userId === USER.id)!.capacity = 20;
  });
  const sireId = store.data.pigeons.find((p) => p.sex === 'doffer')!.id;
  const damId = store.data.pigeons.find((p) => p.sex === 'duivin')!.id;
  await store.persist();
  return { sireId, damId };
}

/** Draai de tick met een gestuurde muntworp (0 = komt uit, 1 = komt niet uit). */
function tickWith(data: any, nowMs: number, roll: number) {
  const real = Math.random;
  let calls = 0;
  // Enkel de hatch-worp sturen; de rest van de trekkingen (geslacht, mutatie,
  // namen) mag gewoon willekeurig blijven, anders krijgen twee jongen dezelfde
  // afgeleide waarden en meet je een artefact van de test.
  Math.random = () => (calls++ === 0 ? roll : real());
  try { tickBreedingHatch(data, nowMs); } finally { Math.random = real; }
}

const DAY = 86400000;

// === 1. Een uitgekomen koppel is weg, ook in SQL =============================
console.log('\nEen uitgekomen koppel wordt ontbonden');
{
  const db = await freshDb();
  const { sireId, damId } = await setup(db);
  let s = await D1Store.load(db, USER.id);
  assert(startBreeding(s, USER.id, sireId, damId) === null, 'koppelen lukt');
  await s.persist();

  const pairs = () => db._raw.prepare('SELECT COUNT(*) c FROM breeding_pairs').get().c as number;
  assert(pairs() === 1, 'koppel staat in SQL');

  s = await D1Store.load(db, USER.id);
  tickWith(s.data, Date.now() + 2 * DAY, 0);
  const young = s.data.pigeons.filter((p) => p.ownerId === USER.id).length - 2;
  await s.persist();
  assert(young >= 1, `er kwamen ${young} jong(en)`);
  assert(pairs() === 0, 'koppelrij is weg uit SQL');

  const fresh = await D1Store.load(db, USER.id);
  assert(fresh.data.breedingPairs.length === 0, 'een verse load ziet geen koppel meer');
  assert(fresh.data.pigeons.find((p) => p.id === sireId)!.lastBredAt != null, 'vader draagt lastBredAt');
  assert(fresh.data.pigeons.find((p) => p.id === damId)!.lastBredAt != null, 'moeder draagt lastBredAt');
}

// === 2. DE BUG: een gelijktijdig verzoek mag het koppel niet terugschrijven ===
console.log('\nGelijktijdige verzoeken (de gemelde bug)');
{
  const db = await freshDb();
  const { sireId, damId } = await setup(db);
  let s = await D1Store.load(db, USER.id);
  startBreeding(s, USER.id, sireId, damId);
  await s.persist();

  const now = Date.now() + 2 * DAY;
  // A en B laden ALLEBEI de wereld mét het koppel — de hatch-tick loopt bij elk
  // verzoek over álle koppels, dus dit is geen exotisch geval.
  const A = await D1Store.load(db, USER.id);
  const B = await D1Store.load(db, USER.id);

  tickWith(A.data, now, 0); // A: komt uit
  await A.persist();
  const pairs = () => db._raw.prepare('SELECT COUNT(*) c FROM breeding_pairs').get().c as number;
  assert(pairs() === 0, 'A: koppel verwijderd');

  tickWith(B.data, now, 1); // B: komt niet uit → herstempelt enkel hatchAt
  await B.persist();
  assert(pairs() === 0, 'B schrijft het uitgekomen koppel NIET terug');

  const fresh = await D1Store.load(db, USER.id);
  assert(fresh.data.breedingPairs.length === 0, 'verse load: nog steeds geen koppel');
}

// === 3. Rust: opnieuw koppelen kan pas na de cooldown ========================
console.log(`\nRust tussen twee nesten (${BREEDING.cooldownDays} dagen)`);
{
  const db = await freshDb();
  const { sireId, damId } = await setup(db);
  let s = await D1Store.load(db, USER.id);
  startBreeding(s, USER.id, sireId, damId);
  await s.persist();

  // Ruim voorbij `hatchAt`: startBreeding zet die stempel op nu, dus tikken op
  // hetzelfde moment geeft dtHours <= 0 en dan komt er niets uit.
  const hatchAt = Date.now() + 2 * DAY;
  s = await D1Store.load(db, USER.id);
  tickWith(s.data, hatchAt, 0);
  await s.persist();

  s = await D1Store.load(db, USER.id);
  s.mutate((d) => { for (const p of d.pigeons) { p.form = 95; p.libido = 95; } });
  const err = startBreeding(s, USER.id, sireId, damId);
  assert(err !== null, `meteen opnieuw koppelen wordt geweigerd (${err})`);
  assert(/\d+ dag/.test(err ?? ''), 'de melding noemt het aantal dagen');

  const sire = s.data.pigeons.find((p) => p.id === sireId)!;
  const left = breedingCooldownDaysLeft(sire, hatchAt);
  assert(left === BREEDING.cooldownDays, `${BREEDING.cooldownDays} dagen te gaan vlak na het uitkomen (${left})`);
  assert(breedingCooldownDaysLeft(sire, hatchAt + (BREEDING.cooldownDays - 1) * DAY) === 1,
    'één dag te gaan op de voorlaatste dag');
  assert(breedingCooldownUntil(sire, hatchAt + BREEDING.cooldownDays * DAY + 1000) === null,
    'na de rustperiode is ze weer vrij');

  // Ná de cooldown moet het gewoon lukken. `startBreeding` leest de wandklok,
  // dus de stempel wordt teruggezet i.p.v. de klok vooruit.
  s.mutate((d) => {
    for (const p of d.pigeons) {
      p.lastBredAt = new Date(Date.now() - (BREEDING.cooldownDays + 1) * DAY).toISOString();
      p.form = 95;
    }
  });
  assert(startBreeding(s, USER.id, sireId, damId) === null, 'na de rustperiode lukt koppelen weer');
}

// === 4. Een MISLUKTE worp kost geen rust =====================================
console.log('\nEen mislukte worp legt geen rust op');
{
  const db = await freshDb();
  const { sireId, damId } = await setup(db);
  let s = await D1Store.load(db, USER.id);
  // Libido/energie laag → de worp komt leeg uit, maar het koppel gaat wél uiteen.
  s.mutate((d) => { for (const p of d.pigeons) { p.libido = 1; p.form = 20; } });
  startBreeding(s, USER.id, sireId, damId);
  await s.persist();

  s = await D1Store.load(db, USER.id);
  const before = s.data.pigeons.filter((p) => p.ownerId === USER.id).length;
  // 0 laat de hatch slagen; de succeskans binnen `breed` faalt door libido 1.
  const real = Math.random;
  let calls = 0;
  Math.random = () => (calls++ === 0 ? 0 : 0.999999);
  try { tickBreedingHatch(s.data, Date.now() + 5 * DAY); } finally { Math.random = real; }
  const after = s.data.pigeons.filter((p) => p.ownerId === USER.id).length;
  await s.persist();

  assert(after === before, 'geen jongen uit een mislukte worp');
  const fresh = await D1Store.load(db, USER.id);
  assert(fresh.data.breedingPairs.length === 0, 'het koppel gaat ook bij een mislukking uiteen');
  assert(fresh.data.pigeons.find((p) => p.id === sireId)!.lastBredAt == null,
    'geen rustperiode na een lege worp — dat zou een dobbelsteen bestraffen');
}

// === 5. Migratie v44: bestaande koppels die al gebroed hebben ================
console.log('\nMigratie v44');
{
  const db = await freshDb();
  const { sireId, damId } = await setup(db);
  const s = await D1Store.load(db, USER.id);
  startBreeding(s, USER.id, sireId, damId);
  s.mutate((d) => {
    d.world.dataVersion = 43;
    // Een jong van ditzelfde koppel, geboren 4 gameweken terug (= 1 echte week):
    // het bewijs dat ze onlangs gebroed hebben.
    const child = { ...d.pigeons[0], id: 'pig_child', name: 'Jong de Jonge', sireId, damId,
      birthWeek: d.world.currentWeek - GAME_WEEKS_PER_REAL_WEEK, lastBredAt: null };
    d.pigeons.push(child as any);
  });
  advanceRealtime(s.data, Date.now());
  await s.persist();

  const fresh = await D1Store.load(db, USER.id);
  // Niet vastpinnen op 44: latere migraties lopen in dezelfde run door. Wat telt
  // is dat v44 gepasseerd is.
  assert((fresh.data.world.dataVersion ?? 0) >= 44, `migratie v44 is gedraaid (${fresh.data.world.dataVersion})`);
  assert(fresh.data.breedingPairs.length === 0, 'het doorbroedende koppel is ontbonden');
  const sire = fresh.data.pigeons.find((p) => p.id === sireId)!;
  assert(sire.lastBredAt != null, 'lastBredAt is teruggerekend uit het jong');
  const left = breedingCooldownDaysLeft(sire);
  assert(left > 0 && left < BREEDING.cooldownDays,
    `de rust loopt al deels (${left} van ${BREEDING.cooldownDays} dagen te gaan)`);

  const inbox = fresh.data.notifications.filter((n) => n.userId === USER.id);
  assert(inbox.some((n) => n.id.startsWith('ntf:admin:breedreset:')), 'speler krijgt te horen waarom het koppel weg is');
  assert(inbox.some((n) => n.id.startsWith('ntf:news:breeding:')), 'speler krijgt de algemene aankondiging');
  const reset = inbox.find((n) => n.id.startsWith('ntf:admin:breedreset:'))!;
  assert(/over \d+ dag/.test(reset.body), 'die melding zegt binnen hoeveel dagen ze weer mogen');

  // Idempotent: een tweede run mag niets nog eens doen.
  const s2 = await D1Store.load(db, USER.id);
  advanceRealtime(s2.data, Date.now());
  await s2.persist();
  const after = await D1Store.load(db, USER.id);
  const resets = after.data.notifications.filter((n) => n.id.startsWith('ntf:admin:breedreset:')).length;
  const news = after.data.notifications.filter((n) => n.id.startsWith('ntf:news:breeding:')).length;
  assert(resets === 1 && news === 1, `tweede run voegt niets toe (${resets} reset, ${news} nieuws)`);
}

// === 6. Een koppel dat NOG NIET gebroed heeft blijft staan ===================
console.log('\nMigratie v44 raakt een vers koppel niet');
{
  const db = await freshDb();
  const { sireId, damId } = await setup(db);
  const s = await D1Store.load(db, USER.id);
  startBreeding(s, USER.id, sireId, damId);
  s.mutate((d) => { d.world.dataVersion = 43; }); // geen nakomelingen in de wereld
  advanceRealtime(s.data, Date.now());
  await s.persist();

  const fresh = await D1Store.load(db, USER.id);
  assert(fresh.data.breedingPairs.length === 1, 'een koppel zonder nest blijft gewoon broeden');
  assert(fresh.data.pigeons.find((p) => p.id === damId)!.lastBredAt == null, 'en krijgt geen rustperiode opgelegd');
}

// === 7. De prijs ============================================================
console.log('\nPrijs');
assert(BREEDING.cost === 750, `koppelen kost €${BREEDING.cost}`);

console.log(failures === 0 ? '\nAlles groen.\n' : `\n${failures} controle(s) gefaald.\n`);
