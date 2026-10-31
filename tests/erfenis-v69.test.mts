/**
 * Migratie v69 — de erfenis voor drie spelers (27 okt, op vraag van de eigenaar:
 * "Geef de spelers 'marcel de neut', 'roekoeloos' en 'graanabolica' het event van
 * de erfenis van een oude melker waarbij ze kunnen kiezen tussen oud kampioen of
 * jonge belofte. Zorg dat de duif die ze nemen altijd een algemene score heeft
 * tussen 75 en 80."), migratie v70 — dezelfde erfenis voor 'onlyflaps' (blok 5c), en
 * migratie v71 — de GEWONE erfenis (spaarpot, kampioen, belofte) voor 'de vluchtige
 * Vleugel' (blok 5d).
 *
 * Gedekt:
 *  1. de gewone erfeniskaart is ongewijzigd (spaarpot, kampioen, belofte);
 *  2. de kaart van v69: enkel de twee duiven, geen spaarpot, geen willekeur;
 *  3. welke duif ze ook kiezen: altijd ★75–80, genen boven elke vaardigheid (max
 *     GENE.ceil), de kampioen oud en de belofte jong, nooit geld — ook niet met
 *     een knopnummer dat niet op de kaart staat;
 *  4. een vol hok: de duif wacht bij Kweek, ook op ★75–80;
 *  5. de migratie: precies die drie echte spelers (hoknaam of gebruikersnaam,
 *     hoofdletters en dubbele spaties maken niet uit), een bot met dezelfde naam
 *     en een andere speler krijgen niets; één bel per speler, met een eigen id;
 *     ze vuurt één keer;
 *  6. door de database: de kaart overleeft D1, en kiezen via de echte route geeft
 *     een duif van ★75–80 die ook na het opslaan ★75–80 is.
 *
 * Run: npx tsx tests/erfenis-v69.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from '../core/d1.js';
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Database, Loft, User } from '../core/schema.js';
import { seedWorld, createLoftForUser, chooseEvent } from '../core/game/engine.js';
import { advanceRealtime } from '../core/game/schedule.js';
import { inheritanceCard, resolveEvent } from '../core/game/events.js';
import { ageInWeeks, talent } from '../core/game/pigeon.js';
import { EVENTS, GENE } from '../core/config/gameConfig.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const NOW = Date.now();
const V69 = { cash: false, score: [75, 80] as [number, number] };
const inRange = (s: number) => s >= 75 && s <= 80;

function addPlayer(store: MemoryStore | D1Store, username: string, loftName: string, isBot = false): string {
  const u: User = { id: newId('usr'), username, passwordHash: 'x', isAdmin: false, isBot, createdAt: new Date(NOW).toISOString() };
  store.mutate((d) => d.users.push(u));
  createLoftForUser(store, u, loftName);
  return u.id;
}

/** A seeded world with one extra human player, migrations NOT run yet. */
function memWorld() {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const uid = addPlayer(store, 'tester', 'Testhok');
  const db = store.data;
  const loft = db.lofts.find((l) => l.userId === uid)!;
  return { store, db, loft };
}

/** Hand the v69 card to `loft`, resolve it with `choice`, return the bird it gave. */
function take(db: Database, loft: Loft, choice: number) {
  loft.pendingEvent = inheritanceCard(V69);
  const before = new Set(db.pigeons.map((p) => p.id));
  const waitingBefore = (loft.pendingBroods ?? []).length;
  const money = loft.money;
  const msg = resolveEvent(db, loft, choice, db.world.currentWeek);
  const added = db.pigeons.filter((p) => !before.has(p.id));
  const waiting = (loft.pendingBroods ?? []).slice(waitingBefore).flatMap((b) => b.young);
  const bird = added[0] ?? waiting[0];
  // Keep the loft from filling up across many draws.
  db.pigeons = db.pigeons.filter((p) => before.has(p.id));
  return { bird, msg, moneyDelta: loft.money - money, inLoft: added.length, waiting: waiting.length };
}

// ---------------------------------------------------------------------------
console.log('\n1. De gewone erfeniskaart is ongewijzigd');
{
  const c = inheritanceCard();
  ok(c.options.length === 3 && c.options[0].label.startsWith('De spaarpot'), 'drie keuzes, de spaarpot eerst');
  ok(c.data === undefined, 'geen extra gegevens op de kaart');
  ok(c.text.includes('spaarpot'), 'de tekst noemt de spaarpot');
  const { db, loft } = memWorld();
  loft.pendingEvent = inheritanceCard();
  const money = loft.money;
  resolveEvent(db, loft, 0, db.world.currentWeek);
  ok(loft.money === money + EVENTS.inheritanceCash, `knop 1 = de spaarpot (€${EVENTS.inheritanceCash})`);
}

// ---------------------------------------------------------------------------
console.log('\n2. De kaart van v69: enkel de twee duiven');
{
  const c = inheritanceCard(V69);
  ok(c.options.map((o) => o.label).join(' | ') === 'De oude kampioen | De jonge belofte', 'twee knoppen: de oude kampioen en de jonge belofte');
  ok(!c.text.includes('spaarpot') && !c.options.some((o) => o.label.includes('spaarpot')), 'geen spaarpot, ook niet in de tekst');
  ok(c.data?.noCash === 1 && c.data?.scoreMin === 75 && c.data?.scoreMax === 80, 'de kaart draagt "geen spaarpot" en ★75–80');
  ok(JSON.stringify(inheritanceCard(V69)) === JSON.stringify(c), 'geen willekeur: twee keer bouwen geeft dezelfde kaart');
}

// ---------------------------------------------------------------------------
console.log('\n3. Welke duif ze ook kiezen: altijd ★75–80');
{
  const { db, loft } = memWorld();
  loft.capacity = 200;
  const week = db.world.currentWeek;
  for (const [choice, label, minAge, maxAge] of [[0, 'de oude kampioen', 280, 430], [1, 'de jonge belofte', 8, 20]] as const) {
    const scores: number[] = [];
    let genesOk = true, ageOk = true, noMoney = true, oneBird = true;
    for (let i = 0; i < 1500; i++) {
      const r = take(db, loft, choice);
      if (!r.bird || r.inLoft !== 1) { oneBird = false; continue; }
      const p = r.bird;
      scores.push(talent(p));
      for (const a of ['speed', 'endurance', 'orientation'] as const) {
        if (!(p.genes && p[a] <= p.genes[a] && p.genes[a] <= GENE.ceil)) genesOk = false;
      }
      const age = ageInWeeks(p, week);
      if (age < minAge || age > maxAge) ageOk = false;
      if (r.moneyDelta !== 0) noMoney = false;
    }
    ok(oneBird, `${label}: telkens precies één duif, rechtstreeks in het hok`);
    ok(scores.every(inRange), `${label}: altijd ★75–80 (laagste ★${Math.min(...scores)}, hoogste ★${Math.max(...scores)})`);
    ok(Math.min(...scores) < 75.5 && Math.max(...scores) > 79.5, `${label}: de hele band wordt gebruikt`);
    ok(genesOk, `${label}: elke gen-cap boven haar vaardigheid, nooit boven ${GENE.ceil}`);
    ok(ageOk, `${label}: ${minAge}–${maxAge} weken oud, zoals altijd`);
    ok(noMoney, `${label}: er gaat geen geld bij of af`);
  }
  const r = take(db, loft, 1);
  ok(/ruwe diamant|veel in haar mars/.test(r.msg), `de belofte is altijd de ruwe diamant ("${r.msg}")`);
  for (const choice of [-1, 2, 7]) {
    const x = take(db, loft, choice);
    ok(x.moneyDelta === 0 && !!x.bird && inRange(talent(x.bird)) && ageInWeeks(x.bird, week) <= 20,
      `knopnummer ${choice} (niet op de kaart) geeft de jonge belofte, nooit de spaarpot`);
  }
  ok(loft.pendingEvent === null, 'na de keuze is de kaart weg');
}

// ---------------------------------------------------------------------------
console.log('\n4. Een vol hok: de duif wacht bij Kweek, ook op ★75–80');
{
  const { db, loft } = memWorld();
  loft.capacity = db.pigeons.filter((p) => p.ownerId === loft.userId).length;
  for (const choice of [0, 1]) {
    const r = take(db, loft, choice);
    ok(r.inLoft === 0 && r.waiting === 1 && inRange(talent(r.bird)), `${choice === 0 ? 'de kampioen' : 'de belofte'} wacht in de wachtkamer op ★${talent(r.bird)}`);
  }
  ok((loft.pendingBroods ?? []).every((b) => b.origin === 'erfenis'), 'met herkomst "erfenis" (telt niet als nest)');
}

// ---------------------------------------------------------------------------
console.log('\n5. De migratie: precies die drie echte spelers');
{
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const marcel = addPlayer(store, 'marcel', 'Marcel  De Neut');        // hoknaam, dubbele spatie
  const roekoe = addPlayer(store, 'Roekoeloos', 'Het Roekoehok');      // gebruikersnaam
  const graan = addPlayer(store, 'gb', ' GRAANABOLICA ');             // hoknaam, hoofdletters
  const other = addPlayer(store, 'jan', 'Jan zijn hok');
  const bot = addPlayer(store, 'roekoeloos-bot', 'Roekoeloos', true);  // bot met dezelfde hoknaam
  const db = store.data;
  db.world.dataVersion = 68;
  advanceRealtime(db, NOW);
  ok((db.world.dataVersion ?? 0) >= 69, `de migratie liep (dataVersion ${db.world.dataVersion})`);
  const lofts = (id: string) => db.lofts.find((l) => l.userId === id)!;
  for (const [id, who] of [[marcel, 'Marcel De Neut (hoknaam, dubbele spatie)'], [roekoe, 'Roekoeloos (gebruikersnaam)'], [graan, 'Graanabolica (hoknaam, hoofdletters)']] as const) {
    const ev = lofts(id).pendingEvent;
    ok(ev?.key === 'inheritance' && ev.options.length === 2 && ev.data?.scoreMin === 75 && ev.data?.scoreMax === 80, `${who} krijgt de erfenis zonder spaarpot, ★75–80`);
    const bells = db.notifications.filter((n) => n.userId === id && n.id.startsWith('ntf:admin:erfenis3'));
    ok(bells.length === 1 && bells[0].id === `ntf:admin:erfenis3:${id}` && !bells[0].body.includes('spaarpot'), `${who}: één bel, eigen id, zonder spaarpot`);
  }
  ok(lofts(other).pendingEvent?.data?.noCash === undefined, 'een andere speler krijgt de kaart niet');
  ok(lofts(bot).pendingEvent?.data?.noCash === undefined, 'een bot met de naam "Roekoeloos" krijgt de kaart niet');
  ok(!db.notifications.some((n) => n.id.startsWith('ntf:admin:erfenis3') && (n.userId === other || n.userId === bot)), 'en ook geen bel');

  const loft = lofts(marcel);
  resolveEvent(db, loft, 0, db.world.currentWeek);
  advanceRealtime(db, NOW + 60000);
  ok(loft.pendingEvent?.data?.noCash === undefined, 'ze vuurt één keer: na de keuze komt de kaart niet terug');
  ok(db.notifications.filter((n) => n.userId === marcel && n.id.startsWith('ntf:admin:erfenis3')).length === 1, 'en er komt geen tweede bel');
}

// ---------------------------------------------------------------------------
console.log('\n5b. v69 wacht tot v68 klaar is, en slaat een vluchtverzoek over');
{
  // Production-like: season 4, v68 still filling the bots (3 birds per request).
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const graan = addPlayer(store, 'graanabolica', 'De Graanschuur');
  const db = store.data;
  db.world.seasonYear = 4;
  db.world.dataVersion = 67;
  const botIds = new Set(db.lofts.filter((l) => l.isBot).map((l) => l.userId));
  db.pigeons = db.pigeons.filter((p) => !botIds.has(p.ownerId) || Math.random() < 0.3);
  const loft = db.lofts.find((l) => l.userId === graan)!;
  advanceRealtime(db, NOW);
  ok(db.world.dataVersion === 67 && loft.pendingEvent?.data?.noCash === undefined, 'v68 nog open: de erfenis wacht (en v68 blijft open)');
  let n = 1;
  while ((db.world.dataVersion ?? 0) < 69 && n < 100) advanceRealtime(db, NOW + 1000 * n++);
  const full = [...botIds].every((id) => db.pigeons.filter((p) => p.ownerId === id).length >= 10);
  ok((db.world.dataVersion ?? 0) >= 69 && full, `na ${n} verzoeken: elke bot op 10 duiven, en dan pas v69`);
  ok(loft.pendingEvent?.data?.noCash === 1, 'en dan krijgt Graanabolica de erfenis');
}
{
  // A request that finishes a flight already sits near D1's 50 queries.
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const db = store.data;
  advanceRealtime(db, NOW - 60000);
  db.world.dataVersion = 68;
  const graan = addPlayer(store, 'graanabolica', 'De Graanschuur');
  const f = db.flights.find((x) => x.status === 'scheduled' && !x.practice)!;
  f.status = 'live';
  f.startAt = new Date(NOW - 3 * 86400000).toISOString();
  const loft = db.lofts.find((l) => l.userId === graan)!;
  advanceRealtime(db, NOW);
  ok(db.world.dataVersion === 68 && loft.pendingEvent?.data?.noCash === undefined, 'een verzoek dat een vlucht afrondt, deelt niets uit');
  advanceRealtime(db, NOW + 1000);
  ok((db.world.dataVersion ?? 0) >= 69 && loft.pendingEvent?.data?.noCash === 1, 'het volgende verzoek wel');
}

// ---------------------------------------------------------------------------
console.log('\n5c. v70: dezelfde erfenis voor OnlyFlaps');
{
  // Production after v69: the three already had theirs (and Roekoeloos answered).
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const db = store.data;
  advanceRealtime(db, NOW - 60000);
  db.world.dataVersion = 69;
  const only = addPlayer(store, 'OnlyFlaps', 'Het Fladderhok');       // gebruikersnaam, hoofdletters
  const only2 = addPlayer(store, 'flapper', ' onlyflaps ');           // hoknaam, spaties
  const roekoe = addPlayer(store, 'roekoeloos', 'Het Roekoehok');
  const other = addPlayer(store, 'jan', 'Jan zijn hok');
  const bot = addPlayer(store, 'onlyflaps-bot', 'OnlyFlaps', true);
  const loftOf = (id: string) => db.lofts.find((l) => l.userId === id)!;
  advanceRealtime(db, NOW);
  ok((db.world.dataVersion ?? 0) >= 70, `de migratie liep (dataVersion ${db.world.dataVersion})`);
  for (const [id, who] of [[only, 'gebruikersnaam "OnlyFlaps"'], [only2, 'hoknaam " onlyflaps "']] as const) {
    const ev = loftOf(id).pendingEvent;
    ok(ev?.key === 'inheritance' && ev.options.length === 2 && ev.data?.noCash === 1 && ev.data?.scoreMin === 75 && ev.data?.scoreMax === 80,
      `${who}: de erfenis zonder spaarpot, ★75–80`);
    const bells = db.notifications.filter((n) => n.userId === id && n.id.startsWith('ntf:admin:erfenis'));
    ok(bells.length === 1 && bells[0].id === `ntf:admin:erfenis4:${id}`, `${who}: één bel, eigen id (erfenis4)`);
  }
  ok(loftOf(roekoe).pendingEvent?.data?.noCash === undefined, 'Roekoeloos krijgt ze niet nog eens');
  ok(loftOf(other).pendingEvent?.data?.noCash === undefined, 'een andere speler krijgt niets');
  ok(loftOf(bot).pendingEvent?.data?.noCash === undefined, 'een bot met de naam "OnlyFlaps" krijgt niets');
  const r = take(db, loftOf(only), 1);
  ok(!!r.bird && inRange(talent(r.bird)), `kiezen geeft een duif van ★${r.bird ? talent(r.bird) : '?'}`);
  advanceRealtime(db, NOW + 60000);
  ok(loftOf(only).pendingEvent?.data?.noCash === undefined, 'ze vuurt één keer');
}
{
  // v70 waits while v69 is still open (a flight request), like v69 waits on v68.
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const db = store.data;
  advanceRealtime(db, NOW - 60000);
  db.world.dataVersion = 68;
  const only = addPlayer(store, 'onlyflaps', 'X');
  const f = db.flights.find((x) => x.status === 'scheduled' && !x.practice)!;
  f.status = 'live';
  f.startAt = new Date(NOW - 3 * 86400000).toISOString();
  advanceRealtime(db, NOW);
  const loft = db.lofts.find((l) => l.userId === only)!;
  ok(db.world.dataVersion === 68 && loft.pendingEvent?.data?.noCash === undefined, 'een vluchtverzoek: v69 en v70 wachten');
  advanceRealtime(db, NOW + 1000);
  ok((db.world.dataVersion ?? 0) >= 70 && loft.pendingEvent?.data?.noCash === 1, 'het volgende verzoek: v69 en dan v70');
}

// ---------------------------------------------------------------------------
console.log('\n5d. v71: de gewone erfenis (spaarpot, kampioen, belofte) voor De Vluchtige Vleugel');
{
  // Production after v70.
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const db = store.data;
  advanceRealtime(db, NOW - 60000);
  db.world.dataVersion = 70;
  const vv = addPlayer(store, 'vleugel', 'De Vluchtige  Vleugel');       // hoknaam, dubbele spatie
  const vv2 = addPlayer(store, 'De vluchtige Vleugel', 'Een ander hok'); // gebruikersnaam
  const only = addPlayer(store, 'onlyflaps', 'Het Fladderhok');
  const other = addPlayer(store, 'jan', 'Jan zijn hok');
  const bot = addPlayer(store, 'vv-bot', 'De Vluchtige Vleugel', true);
  const loftOf = (id: string) => db.lofts.find((l) => l.userId === id)!;
  advanceRealtime(db, NOW);
  ok(db.world.dataVersion === 71, `de migratie liep (dataVersion ${db.world.dataVersion})`);
  for (const [id, who] of [[vv, 'hoknaam "De Vluchtige  Vleugel"'], [vv2, 'gebruikersnaam "De vluchtige Vleugel"']] as const) {
    const ev = loftOf(id).pendingEvent;
    ok(JSON.stringify(ev) === JSON.stringify(inheritanceCard()), `${who}: de gewone erfeniskaart (drie keuzes, geen vaste score)`);
    const bells = db.notifications.filter((n) => n.userId === id && n.id.startsWith('ntf:admin:erfenis'));
    ok(bells.length === 1 && bells[0].id === `ntf:admin:erfenis5:${id}` && bells[0].body.includes('spaarpot'),
      `${who}: één bel, eigen id (erfenis5), noemt de spaarpot`);
  }
  ok(loftOf(only).pendingEvent === null, 'OnlyFlaps krijgt niet nog een kaart');
  ok(loftOf(other).pendingEvent === null, 'een andere speler krijgt niets');
  ok(loftOf(bot).pendingEvent === null, 'een bot met de naam "De Vluchtige Vleugel" krijgt niets');
  ok(!db.notifications.some((n) => n.id.startsWith('ntf:admin:erfenis5') && [only, other, bot].includes(n.userId)), 'en ook geen bel');

  const loft = loftOf(vv);
  const money = loft.money;
  resolveEvent(db, loft, 0, db.world.currentWeek);
  ok(loft.money === money + EVENTS.inheritanceCash, `knop 1 = de spaarpot (€${EVENTS.inheritanceCash})`);
  // Resolve the card the migration put there (not `take`, which swaps in the v69 card).
  const loft2 = loftOf(vv2);
  const before = new Set(db.pigeons.map((p) => p.id));
  const money2 = loft2.money;
  resolveEvent(db, loft2, 1, db.world.currentWeek);
  const champ = db.pigeons.filter((p) => !before.has(p.id));
  ok(champ.length === 1 && champ[0].ownerId === vv2 && ageInWeeks(champ[0], db.world.currentWeek) >= 280 && loft2.money === money2,
    `knop 2 = de oude kampioen (${champ[0]?.name}, ${champ[0] ? ageInWeeks(champ[0], db.world.currentWeek) : '?'} weken, geen geld)`);
  ok(loft2.pendingEvent === null, 'na de keuze is de kaart weg');
  advanceRealtime(db, NOW + 60000);
  ok(loft.pendingEvent === null, 'ze vuurt één keer: na de keuze komt de kaart niet terug');
  ok(db.notifications.filter((n) => n.userId === vv && n.id.startsWith('ntf:admin:erfenis5')).length === 1, 'en er komt geen tweede bel');
}
{
  // Like v69/v70: a request that finishes a flight hands nothing out.
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const db = store.data;
  advanceRealtime(db, NOW - 60000);
  db.world.dataVersion = 70;
  const vv = addPlayer(store, 'vleugel', 'De Vluchtige Vleugel');
  const f = db.flights.find((x) => x.status === 'scheduled' && !x.practice)!;
  f.status = 'live';
  f.startAt = new Date(NOW - 3 * 86400000).toISOString();
  advanceRealtime(db, NOW);
  const loft = db.lofts.find((l) => l.userId === vv)!;
  ok(db.world.dataVersion === 70 && loft.pendingEvent === null, 'een vluchtverzoek: v71 wacht');
  advanceRealtime(db, NOW + 1000);
  ok(db.world.dataVersion === 71 && loft.pendingEvent?.key === 'inheritance', 'het volgende verzoek: v71');
}

// ---------------------------------------------------------------------------
console.log('\n6. Door de database: de kaart overleeft D1, kiezen via de echte route');
{
  const sql = new DatabaseSync(':memory:');
  const d1: any = (() => {
    const prepare = (q: string) => { const b: unknown[] = []; const api: any = {
      bind(...a: unknown[]) { b.push(...a); return api; },
      async first() { return sql.prepare(q).get(...(b as any[])) ?? null; },
      async all() { return { results: sql.prepare(q).all(...(b as any[])) }; },
      run() { return sql.prepare(q).run(...(b as any[])); } }; return api; };
    return { prepare, async exec(q: string) { sql.exec(q); }, async batch(s: any[]) { for (const x of s) x.run(); } };
  })();
  sql.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  sql.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,0)').run();
  while (!(await ensureSchema(d1))) {}
  let store = await D1Store.load(d1, undefined); seedWorld(store); await store.persist();
  store = await D1Store.load(d1, undefined);
  const uid = addPlayer(store, 'graanabolica', 'De Graanschuur');
  advanceRealtime(store.data, NOW, new Map());
  await store.persist();

  store = await D1Store.load(d1, uid);
  const loft = store.data.lofts.find((l) => l.userId === uid)!;
  ok(loft.pendingEvent?.options.length === 2 && loft.pendingEvent?.data?.noCash === 1 && loft.pendingEvent?.data?.scoreMin === 75,
    'de kaart staat na het opslaan nog in D1, zonder spaarpot en met ★75–80');
  ok(store.data.notifications.some((n) => n.id === `ntf:admin:erfenis3:${uid}`), 'de bel staat in D1');
  const before = new Set(store.data.pigeons.filter((p) => p.ownerId === uid).map((p) => p.id));
  const money = loft.money;
  const msg = chooseEvent(store, uid, 1);
  await store.persist();
  ok(!msg.startsWith('!'), `de keuze lukt ("${msg}")`);

  store = await D1Store.load(d1, uid);
  const mine = store.data.pigeons.filter((p) => p.ownerId === uid && !before.has(p.id));
  const after = store.data.lofts.find((l) => l.userId === uid)!;
  ok(mine.length === 1 && inRange(talent(mine[0])), `na het opslaan: één nieuwe duif, ★${mine[0] ? talent(mine[0]) : '?'}`);
  ok(after.pendingEvent === null, 'de kaart is weg');
  ok(after.money === money, 'geen geld bij of af');
}

console.log(`\n${pass} geslaagd, ${fail} mislukt`);
process.exit(fail > 0 ? 1 : 0);
