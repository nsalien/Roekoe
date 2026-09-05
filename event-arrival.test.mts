/**
 * Regressietest: een duif die je uit een gebeurtenis krijgt gaat NOOIT verloren
 * omdat je hok vol zit.
 *
 * Het gemelde geval: de erfeniskaart ("de oude kampioen") werd geweigerd met
 * "je hok zit vol — de erfenis gaat aan je neus voorbij", terwijl de kaart op dat
 * moment al verbruikt was. De speler had dus al twee andere opties opgegeven en
 * kreeg níets. De duif wacht nu in dezelfde wachtrij als een nest dat in een vol
 * hok uitkwam (`Loft.pendingBroods`), zodat hij plaats kan maken.
 *
 * ⚠️ De kern van de test is niet de wachtrij zelf maar de SCHEIDING: zo'n duif
 * deelt het scherm met een nest maar is er geen — geen kweekbadges, geen slot op
 * het koppelformulier. En dat ze de rit door D1 overleeft: dat is het stilste
 * faalgeval (`origin` is een optioneel veld in een JSON-kolom).
 *
 * Draai deze test na élke wijziging aan `events.ts`, `resolveBrood` of het
 * `pending_broods`-veld in `core/d1.ts`.
 *
 * Run: npx tsx event-arrival.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from './core/d1.js';
import {
  chooseEvent, createLoftForUser, releasePigeon, resolveBrood, sellToRestaurant, startBreeding,
} from './core/game/engine.js';
import type { EventCard, User } from './core/schema.js';

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

const INHERITANCE: EventCard = {
  key: 'inheritance', icon: '📜', title: 'Erfenis van een oude melker',
  text: 'test', options: [{ label: 'De spaarpot (€600)' }, { label: 'De oude kampioen' }, { label: 'De jonge belofte' }],
};

const STRAY: EventCard = {
  key: 'stray', icon: '🕊️', title: 'Verdwaalde duif',
  text: 'test', options: [{ label: 'Houden' }, { label: 'Laten gaan' }],
};

/**
 * Eén speler met een hok dat exact vol zit (`capacity` = het aantal duiven),
 * en een openstaande gebeurtenis klaar om te beantwoorden.
 */
async function setup(db: any, card: EventCard, opts: { free?: number } = {}) {
  const store = await D1Store.load(db, USER.id);
  store.data.users.push(USER);
  createLoftForUser(store, USER, 'Testhok');
  store.mutate((d) => {
    const loft = d.lofts.find((l) => l.userId === USER.id)!;
    const mine = d.pigeons.filter((p) => p.ownerId === USER.id);
    // Vol = capaciteit gelijk aan het aantal duiven; `free` maakt er plaatsen bij.
    loft.capacity = mine.length + (opts.free ?? 0);
    loft.pendingEvent = { ...card };
    loft.money = 50_000;
    // Twee vrije, koppelbare duiven om het koppelformulier mee te testen.
    mine[0].sex = 'doffer';
    mine[1].sex = 'duivin';
    for (const p of mine.slice(0, 2)) { p.libido = 95; p.form = 95; p.ailment = null; }
  });
  await store.persist();
  return store;
}

function mine(store: any) {
  return store.data.pigeons.filter((p: any) => p.ownerId === USER.id);
}
function loftOf(store: any) {
  return store.data.lofts.find((l: any) => l.userId === USER.id)!;
}

console.log('\n📜 De oude kampioen in een VOL hok');
{
  const db = await freshDb();
  const store = await setup(db, INHERITANCE);
  const before = mine(store).length;
  const babiesBefore = loftOf(store).stats.babies;

  const msg = chooseEvent(store, USER.id, 1);

  assert(!msg.startsWith('!'), 'de keuze wordt aanvaard, geen fout');
  assert(!/voorbij|jammer/i.test(msg), `de erfenis gaat NIET aan je neus voorbij ("${msg.slice(0, 60)}…")`);
  assert(mine(store).length === before, 'ze staat nog niet in het hok (er is geen plaats)');

  const waiting = loftOf(store).pendingBroods ?? [];
  assert(waiting.length === 1, 'er wacht precies één duif op je keuze');
  assert(waiting[0]?.origin === 'erfenis', 'de wachtrij weet dat het een erfenis is, geen nest');
  assert(waiting[0]?.young.length === 1, 'het is één duif, niet een worp');
  assert(waiting[0]?.sireName === '' && waiting[0]?.damName === '', 'geen verzonnen ouders op een erfenis');
  assert(loftOf(store).stats.babies === babiesBefore, 'ze telt niet mee als gekweekt jong');
  assert(msg.includes(waiting[0]?.young[0]?.name ?? '#'), 'de melding noemt haar naam');

  const bell = store.data.notifications.filter((n: any) => n.userId === USER.id);
  assert(bell.some((n: any) => /vol/i.test(n.title) && /Kweek/.test(n.body)), 'de belmelding zegt wáár je moet beslissen');

  // ⚠️ Het stilste faalgeval: `origin` rijdt mee in een JSON-kolom.
  await store.persist();
  const reloaded = await D1Store.load(db, USER.id);
  const after = (reloaded.data.lofts.find((l: any) => l.userId === USER.id)!.pendingBroods ?? [])[0];
  assert(after?.origin === 'erfenis', 'de erfenis overleeft de rondrit door D1');
  assert(after?.young[0]?.name === waiting[0]?.young[0]?.name, 'en het is nog steeds dezelfde duif');
}

console.log('\n🕊️ Plaats maken en haar alsnog houden');
{
  const db = await freshDb();
  const store = await setup(db, INHERITANCE);
  chooseEvent(store, USER.id, 1);
  const brood = loftOf(store).pendingBroods[0];
  const heir = brood.young[0];

  const tooSoon = resolveBrood(store, USER.id, brood.id, [heir.id]);
  assert(typeof tooSoon === 'string' && /vol/i.test(tooSoon), 'houden lukt niet zolang je hok vol zit');
  assert((loftOf(store).pendingBroods ?? []).length === 1, 'en ze blijft netjes wachten na die weigering');

  // Plaats maken op precies de manier die het scherm aanbiedt: vrijlaten.
  const victim = mine(store)[0];
  assert(releasePigeon(store, USER.id, victim.id) === null, 'een duif vrijlaten lukt');

  assert(resolveBrood(store, USER.id, brood.id, [heir.id]) === null, 'nu kan je haar houden');
  assert(mine(store).some((p: any) => p.id === heir.id), 'ze staat in het hok');
  assert((loftOf(store).pendingBroods ?? []).length === 0, 'de wachtrij is leeg');
  assert(!mine(store).some((p: any) => p.id === victim.id), 'de vrijgelaten duif is weg');
  assert(loftOf(store).stats.babies === 0, 'nog steeds geen enkel "gekweekt jong" geteld');
  assert(!loftOf(store).badges.some((b: any) => b.id === 'tweeling' || b.id === 'dynastie'), 'geen kweekbadges van een erfenis');
}

console.log('\n🍲 Plaats maken via het restaurant werkt net zo goed');
{
  const db = await freshDb();
  const store = await setup(db, INHERITANCE);
  chooseEvent(store, USER.id, 1);
  const brood = loftOf(store).pendingBroods[0];
  const heir = brood.young[0];
  const victim = mine(store)[0];
  const moneyBefore = loftOf(store).money;

  assert(sellToRestaurant(store, USER.id, victim.id) === null, 'een duif naar de bistro lukt');
  assert(loftOf(store).money > moneyBefore, 'en dat brengt geld op');
  assert(resolveBrood(store, USER.id, brood.id, [heir.id]) === null, 'de erfenis kan nu binnen');
  assert(mine(store).some((p: any) => p.id === heir.id), 'ze staat in het hok');
}

console.log('\n👋 Toch niet houden mag ook');
{
  const db = await freshDb();
  const store = await setup(db, INHERITANCE);
  chooseEvent(store, USER.id, 1);
  const brood = loftOf(store).pendingBroods[0];
  const count = mine(store).length;

  assert(resolveBrood(store, USER.id, brood.id, []) === null, 'niets houden wordt aanvaard');
  assert((loftOf(store).pendingBroods ?? []).length === 0, 'de wachtrij is leeg');
  assert(mine(store).length === count, 'er kwam geen duif bij');
  const bell = store.data.notifications.filter((n: any) => /vrijgelaten/i.test(n.title));
  assert(bell.length === 1, 'je krijgt te horen dat ze weg is');
  assert(!/nest van/i.test(bell[0]?.body ?? ''), 'en die melding verzint geen nest');
}

console.log('\n🏠 Met plaats zat verandert er niets aan het oude gedrag');
{
  const db = await freshDb();
  const store = await setup(db, INHERITANCE, { free: 3 });
  const before = mine(store).length;
  chooseEvent(store, USER.id, 1);
  assert(mine(store).length === before + 1, 'ze gaat rechtstreeks het hok in');
  assert((loftOf(store).pendingBroods ?? []).length === 0, 'geen wachtrij, geen extra klik');
}

console.log('\n🐣 De jonge belofte volgt dezelfde regel');
{
  const db = await freshDb();
  const store = await setup(db, INHERITANCE);
  const msg = chooseEvent(store, USER.id, 2);
  assert(!/voorbij/i.test(msg), 'ook de jonge belofte gaat niet verloren');
  assert((loftOf(store).pendingBroods ?? [])[0]?.origin === 'erfenis', 'ze wacht als erfenis');
}

console.log('\n💰 De spaarpot blijft gewoon geld, ook met een vol hok');
{
  const db = await freshDb();
  const store = await setup(db, INHERITANCE);
  const before = loftOf(store).money;
  chooseEvent(store, USER.id, 0);
  assert(loftOf(store).money === before + 600, 'de spaarpot betaalt €600 uit');
  assert((loftOf(store).pendingBroods ?? []).length === 0, 'en zet niets in de wachtrij');
}

console.log('\n🕊️ De verdwaalde duif vliegt niet meer zomaar weg');
{
  const db = await freshDb();
  const store = await setup(db, STRAY);
  const msg = chooseEvent(store, USER.id, 0);
  assert(!/vliegt weg/i.test(msg), 'ze vliegt niet weg omdat je hok toevallig vol zit');
  const waiting = (loftOf(store).pendingBroods ?? [])[0];
  assert(waiting?.origin === 'zwerver', 'ze wacht als zwerver, niet als nest');

  // Laten gaan (keuze 1) blijft een fooi, geen wachtende duif.
  const db2 = await freshDb();
  const store2 = await setup(db2, STRAY);
  const money = loftOf(store2).money;
  chooseEvent(store2, USER.id, 1);
  assert(loftOf(store2).money > money, 'ze laten gaan levert nog steeds een fooi op');
  assert((loftOf(store2).pendingBroods ?? []).length === 0, 'en zet niets in de wachtrij');
}

console.log('\n🔓 Een wachtende erfenis blokkeert het koppelen NIET');
{
  const db = await freshDb();
  // Plaats voor het jong, zodat enkel de wachtrij het koppelen zou kunnen tegenhouden.
  const store = await setup(db, INHERITANCE, { free: 0 });
  chooseEvent(store, USER.id, 1);
  assert((loftOf(store).pendingBroods ?? []).length === 1, 'er wacht een erfenis');

  const sire = mine(store).find((p: any) => p.sex === 'doffer');
  const dam = mine(store).find((p: any) => p.sex === 'duivin');
  const err = startBreeding(store, USER.id, sire.id, dam.id);
  assert(err === null || !/nest/i.test(err), `koppelen mag gewoon (${err ?? 'gelukt'})`);

  // Contrast: een ECHT nest hoort het wel te blokkeren.
  const db2 = await freshDb();
  const store2 = await setup(db2, INHERITANCE);
  store2.mutate((d: any) => {
    const loft = d.lofts.find((l: any) => l.userId === USER.id)!;
    const heir = { ...d.pigeons[0], id: 'pig_fake_young' };
    loft.pendingBroods = [{
      id: 'brood_fake', sireId: 'a', damId: 'b', sireName: 'Papa', damName: 'Mama',
      young: [heir], dynasty: false, createdAt: new Date().toISOString(), createdAtWeek: 60,
    }];
  });
  const s2 = mine(store2).find((p: any) => p.sex === 'doffer');
  const d2 = mine(store2).find((p: any) => p.sex === 'duivin');
  const err2 = startBreeding(store2, USER.id, s2.id, d2.id);
  assert(typeof err2 === 'string' && /nest/i.test(err2), 'een echt nest blokkeert het koppelen nog steeds');
}

console.log(failures === 0 ? '\n✅ Alles groen\n' : `\n❌ ${failures} controle(s) rood\n`);
