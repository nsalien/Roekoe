/**
 * Migratie v75 — een duif van ★80–82 voor De Bronstige Bek (7 nov, op vraag van de
 * eigenaar: "'De Bronstige Bek' is een nieuwe speler. Hij heeft zijn duiven niet
 * mogen upgraden met punten, waarom niet? Geef deze speler een duif met score 80
 * tussen 82."), plus een bel voor de beheerders met wat zijn starterspakket écht
 * bevat (de sandbox kan prod niet lezen).
 *
 * Gedekt:
 *  1. de duif: precies één, van hem, ★80–82, genen boven elke vaardigheid (max
 *     GENE.ceil), in haar beste jaren, uitgerust, geen valse "vooruitgang";
 *  2. de match: hoknaam of gebruikersnaam, hoofdletters en dubbele spaties maken
 *     niet uit; een bot met dezelfde naam en een andere speler krijgen niets;
 *  3. één bel voor hem, met een eigen id; ze vuurt één keer;
 *  4. een vol hok: de duif wacht bij Kweek (herkomst `geschenk`), ook op ★80–82;
 *  5. de beheerdersbel: zegt of het pakket er is en wat er nog over is, en zegt
 *     het ook als er niemand met die naam is;
 *  6. een verzoek dat een vlucht afrondt, geeft niets (de querylimiet);
 *  7. door de database: de duif overleeft D1, met haar vaste id.
 *
 * En migratie v76 (blok 8, eigenaar: "Geef hem ook het starterspakket opnieuw"):
 * een vers pakket (alle punten, ervaring niet meer vastgelegd, 28 dagen vanaf nu,
 * afloopmelding opnieuw gewapend), zijn duiven bijgetankt behalve wie vliegt,
 * niemand anders, één bel, één keer — en pas ná het verslag van v75, zodat dat
 * verslag de oude toestand beschrijft. Ook door D1.
 *
 * Run: npx tsx tests/geschenk-v75.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from '../core/d1.js';
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { User } from '../core/schema.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import { advanceRealtime } from '../core/game/schedule.js';
import { spendAttribute, spendExperience } from '../core/game/newcomer.js';
import { ageInWeeks, seasonScore, talent } from '../core/game/pigeon.js';
import { AGING, GENE, NEWCOMER } from '../core/config/gameConfig.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const NOW = Date.now();
const inRange = (s: number) => s >= 80 && s <= 82;

function addPlayer(store: MemoryStore | D1Store, username: string, loftName: string, opts: { bot?: boolean; admin?: boolean } = {}): string {
  const u: User = {
    id: newId('usr'), username, passwordHash: 'x', isAdmin: !!opts.admin, isBot: !!opts.bot,
    createdAt: new Date(NOW).toISOString(),
  };
  store.mutate((d) => d.users.push(u));
  createLoftForUser(store, u, loftName);
  return u.id;
}

/** Production just before v75: a seeded world with a calendar, dataVersion 74. */
function prodWorld() {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const db = store.data;
  advanceRealtime(db, NOW - 60000);
  db.world.dataVersion = 74;
  return { store, db };
}

const gifts = (db: ReturnType<typeof prodWorld>['db'], uid: string) =>
  db.pigeons.filter((p) => p.ownerId === uid && p.id.startsWith('pig_gift_v75_'));

// ---------------------------------------------------------------------------
console.log('\n1–3. De duif, de match en de bel');
{
  const { store, db } = prodWorld();
  const admin = addPlayer(store, 'eigenaar', 'Het Hok van de Baas', { admin: true });
  const bek = addPlayer(store, 'bronstig', 'De  Bronstige Bek');          // hoknaam, dubbele spatie
  const other = addPlayer(store, 'jan', 'Jan zijn hok');
  const bot = addPlayer(store, 'bek-bot', 'De Bronstige Bek', { bot: true });
  const before = new Map(db.pigeons.map((p) => [p.id, p.ownerId]));
  advanceRealtime(db, NOW);
  ok((db.world.dataVersion ?? 0) >= 75, `de migratie liep (dataVersion ${db.world.dataVersion})`);

  const mine = gifts(db, bek);
  ok(mine.length === 1, 'De Bronstige Bek krijgt precies één duif');
  const p = mine[0];
  ok(!!p && p.id === `pig_gift_v75_${bek}`, `met een vaste id (${p?.id})`);
  ok(!!p && inRange(talent(p)), `★${p ? talent(p) : '?'} ligt tussen 80 en 82`);
  ok(!!p && (['speed', 'endurance', 'orientation'] as const).every((a) => (p.genes?.[a] ?? 0) > p[a] && (p.genes?.[a] ?? 99) <= GENE.ceil),
    `genen boven elke vaardigheid, max ${GENE.ceil}`);
  const age = p ? ageInWeeks(p, db.world.currentWeek) : 0;
  ok(age >= 52 && age < AGING.peakEndWeeks, `in haar beste jaren (${age} weken)`);
  ok(!!p && p.form === 100 && p.health === 100, 'uitgerust: energie en gezondheid 100');
  ok(!!p && p.seasonStartScore === seasonScore(p), 'geen valse vooruitgang in de seizoensranglijst');
  ok(!!p && !db.pigeons.some((x) => x !== p && x.name === p.name), `een unieke naam (${p?.name})`);

  ok(gifts(db, other).length === 0, 'een andere speler krijgt niets');
  ok(gifts(db, bot).length === 0, 'een bot met de naam "De Bronstige Bek" krijgt niets');
  ok(db.pigeons.every((x) => !before.has(x.id) || before.get(x.id) === x.ownerId), 'geen bestaande duif verandert van eigenaar');

  const bells = db.notifications.filter((n) => n.userId === bek && n.id.startsWith('ntf:admin:geschenk'));
  ok(bells.length === 1 && bells[0].id === `ntf:admin:geschenk1:${bek}` && bells[0].body.includes(p?.name ?? '#') && bells[0].body.includes('in je hok'),
    'één bel, eigen id, met haar naam en "in je hok"');
  ok(!db.notifications.some((n) => n.id.startsWith('ntf:admin:geschenk') && n.userId !== bek), 'niemand anders krijgt die bel');

  advanceRealtime(db, NOW + 60000);
  ok(gifts(db, bek).length === 1, 'ze vuurt één keer: geen tweede duif');
  ok(db.notifications.filter((n) => n.userId === bek && n.id.startsWith('ntf:admin:geschenk')).length === 1, 'en geen tweede bel');

  const diag = db.notifications.filter((n) => n.id.startsWith('ntf:admin:diag-starter1'));
  ok(diag.length === 1 && diag[0].userId === admin, 'de beheerder (en enkel hij) krijgt het verslag');
  ok(!!diag[0] && diag[0].body.includes('wél') && diag[0].body.includes('30 van 30') && diag[0].body.includes('5 van 5') &&
    diag[0].body.includes('nog niets uitgegeven'), 'het verslag: pakket aanwezig, niets uitgegeven');
  ok(!!diag[0] && diag[0].body.includes(p?.name ?? '#') && diag[0].body.includes('zit in zijn hok'), 'en het noemt de duif');
}
{
  // Gebruikersnaam i.p.v. hoknaam, en een deels uitgegeven pakket.
  const { store, db } = prodWorld();
  addPlayer(store, 'eigenaar', 'Baas', { admin: true });
  const bek = addPlayer(store, 'De Bronstige Bek', 'Een heel ander hok');
  const loft = db.lofts.find((l) => l.userId === bek)!;
  const first = db.pigeons.find((p) => p.ownerId === bek)!;
  spendAttribute(loft, first, 'speed', 2);
  advanceRealtime(db, NOW);
  ok(gifts(db, bek).length === 1, 'gebruikersnaam "De Bronstige Bek": ook één duif');
  const diag = db.notifications.find((n) => n.id.startsWith('ntf:admin:diag-starter1'));
  ok(!!diag && diag.body.includes('3 van 5') && diag.body.includes('deel is dus wél uitgegeven'), 'het verslag ziet de uitgegeven punten');
}
{
  // Geen pakket op het hok (bv. een hok van vóór het starterspakket).
  const { store, db } = prodWorld();
  addPlayer(store, 'eigenaar', 'Baas', { admin: true });
  const bek = addPlayer(store, 'bronstig', 'De Bronstige Bek');
  delete db.lofts.find((l) => l.userId === bek)!.newcomer;
  advanceRealtime(db, NOW);
  const diag = db.notifications.find((n) => n.id.startsWith('ntf:admin:diag-starter1'));
  ok(!!diag && diag.body.includes('GEEN starterspakket'), 'zonder pakket zegt het verslag dat');
  ok(gifts(db, bek).length === 1, 'en de duif komt er gewoon');
}
{
  // Niemand met die naam.
  const { store, db } = prodWorld();
  const admin = addPlayer(store, 'eigenaar', 'Baas', { admin: true });
  addPlayer(store, 'jan', 'Jan zijn hok');
  advanceRealtime(db, NOW);
  ok((db.world.dataVersion ?? 0) >= 75, 'zonder match loopt de migratie ook af');
  ok(!db.pigeons.some((p) => p.id.startsWith('pig_gift_v75_')), 'er wordt geen duif gemaakt');
  const diag = db.notifications.find((n) => n.id === `ntf:admin:diag-starter1:${admin}`);
  ok(!!diag && diag.body.includes('Geen echte speler gevonden'), 'en de beheerder hoort dat er niemand gevonden is');
}

// ---------------------------------------------------------------------------
console.log('\n4. Een vol hok: de duif wacht bij Kweek');
{
  const { store, db } = prodWorld();
  const bek = addPlayer(store, 'bronstig', 'De Bronstige Bek');
  const loft = db.lofts.find((l) => l.userId === bek)!;
  loft.capacity = db.pigeons.filter((p) => p.ownerId === bek).length; // vol
  advanceRealtime(db, NOW);
  ok(gifts(db, bek).length === 0, 'niet in het volle hok');
  const waiting = (loft.pendingBroods ?? []).filter((b) => b.origin === 'geschenk');
  const y = waiting[0]?.young[0];
  ok(waiting.length === 1 && waiting[0].young.length === 1 && y?.id === `pig_gift_v75_${bek}`, 'maar bij Kweek, herkomst "geschenk", met haar vaste id');
  ok(!!y && inRange(talent(y)), `ook daar ★${y ? talent(y) : '?'}`);
  const bell = db.notifications.find((n) => n.id === `ntf:admin:geschenk1:${bek}`);
  ok(!!bell && bell.body.includes('Kweek'), 'de bel zegt dat ze bij Kweek wacht');
  advanceRealtime(db, NOW + 60000);
  ok((loft.pendingBroods ?? []).filter((b) => b.origin === 'geschenk').length === 1, 'ze komt er maar één keer');
}

// ---------------------------------------------------------------------------
console.log('\n6. Een verzoek dat een vlucht afrondt, geeft niets');
{
  const { store, db } = prodWorld();
  const bek = addPlayer(store, 'bronstig', 'De Bronstige Bek');
  const f = db.flights.find((x) => x.status === 'scheduled' && !x.practice)!;
  f.status = 'live';
  f.startAt = new Date(NOW - 3 * 86400000).toISOString();
  advanceRealtime(db, NOW);
  ok(db.world.dataVersion === 74 && gifts(db, bek).length === 0, 'het afrondende verzoek slaat haar over (dataVersion blijft 74)');
  advanceRealtime(db, NOW + 60000);
  ok((db.world.dataVersion ?? 0) >= 75 && gifts(db, bek).length === 1, 'het volgende verzoek geeft de duif');
}

// ---------------------------------------------------------------------------
console.log('\n7. Door de database');
{
  function fakeD1(): any {
    const sql = new DatabaseSync(':memory:');
    const val = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
    const prepare = (query: string) => {
      const bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) { bound.push(...args.map(val)); return api; },
        async first() { return sql.prepare(query).get(...(bound as any[])) ?? null; },
        async all() { return { results: sql.prepare(query).all(...(bound as any[])) }; },
        async run() { return sql.prepare(query).run(...(bound as any[])); },
      };
      return api;
    };
    return { prepare, async exec(q: string) { sql.exec(q); }, async batch(st: any[]) { for (const s of st) await s.run(); }, _raw: sql };
  }
  const d1 = fakeD1();
  d1._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  d1._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1, 1, 1, 0)').run();
  for (let i = 0; i < 40 && !(await ensureSchema(d1)); i++);
  let s = await D1Store.load(d1);
  seedWorld(s);
  await s.persist();
  s = await D1Store.load(d1);
  advanceRealtime(s.data, NOW - 60000);
  s.data.world.dataVersion = 74;
  const bek = addPlayer(s, 'bronstig', 'De Bronstige Bek');
  await s.persist();
  s = await D1Store.load(d1, bek);
  advanceRealtime(s.data, NOW);
  await s.persist();
  s = await D1Store.load(d1, bek);
  const p = s.data.pigeons.find((x) => x.id === `pig_gift_v75_${bek}`);
  ok((s.data.world.dataVersion ?? 0) >= 75, 'dataVersion ≥ 75 staat in D1');
  ok(!!p && p.ownerId === bek && inRange(talent(p)), `de duif staat in D1, van hem, ★${p ? talent(p) : '?'}`);
  ok(s.data.notifications.some((n) => n.id === `ntf:admin:geschenk1:${bek}`), 'en zijn bel ook');
  const n = s.data.lofts.find((l) => l.userId === bek)!.newcomer;
  ok(s.data.world.dataVersion === 76 && !!n && n.expPoints === NEWCOMER.expPoints && n.attrPoints === NEWCOMER.attrPoints,
    'v76: het verse starterspakket staat ook in D1');
}

// ---------------------------------------------------------------------------
console.log('\n8. v76: het starterspakket opnieuw');
{
  const { store, db } = prodWorld();
  addPlayer(store, 'eigenaar', 'Baas', { admin: true });
  const bek = addPlayer(store, 'bronstig', 'De Bronstige Bek');
  const other = addPlayer(store, 'jan', 'Jan zijn hok');
  const bot = addPlayer(store, 'bek-bot', 'De Bronstige Bek', { bot: true });
  const loftOf = (id: string) => db.lofts.find((l) => l.userId === id)!;
  const loft = loftOf(bek);
  // Zijn pakket zoals het er op prod kan bijstaan: oud, deels uitgegeven, ervaring vastgelegd.
  const birds = db.pigeons.filter((p) => p.ownerId === bek);
  spendAttribute(loft, birds[0], 'speed', 2);
  spendExperience(loft, birds[0], 10);
  loft.newcomer!.endsAt = new Date(NOW + 2 * 86400000).toISOString();
  loft.newcomer!.endNotified = true;
  const otherPack = JSON.stringify(loftOf(other).newcomer);
  for (const p of birds) p.form = 40;
  // Eén duif staat ingeschreven voor een vlucht: die wordt niet bijgetankt.
  const f = db.flights.find((x) => x.status === 'scheduled' && !x.practice && Date.parse(x.startAt) > NOW + 3600000)!;
  f.entries.push({ pigeonId: birds[1].id, ownerId: bek } as never);
  for (const p of db.pigeons.filter((x) => x.ownerId === other)) p.form = 40;

  advanceRealtime(db, NOW);
  ok(db.world.dataVersion === 76, `v75 en v76 liepen (dataVersion ${db.world.dataVersion})`);
  const n = loft.newcomer!;
  ok(n.expPoints === NEWCOMER.expPoints && n.attrPoints === NEWCOMER.attrPoints, `alle punten terug (${n.expPoints} + ${n.attrPoints})`);
  ok(n.expPigeonId === null, 'de ervaringspunten liggen niet meer vast op een duif');
  const days = (Date.parse(n.endsAt) - NOW) / 86400000;
  ok(Math.abs(days - NEWCOMER.days) < 0.01, `het venster loopt opnieuw ${NEWCOMER.days} dagen vanaf nu (${days.toFixed(2)})`);
  ok(n.endNotified === false, 'en de afloopmelding komt straks opnieuw');
  ok(birds.filter((p) => p !== birds[1]).every((p) => p.form === NEWCOMER.startEnergie), 'zijn duiven zijn bijgetankt naar 100');
  ok(birds[1].form === 40, 'behalve de duif die ingeschreven staat voor een vlucht');
  const gift = db.pigeons.find((p) => p.id === `pig_gift_v75_${bek}`);
  ok(!!gift && gift.form === 100, 'de cadeauduif (v75) is er ook');

  ok(JSON.stringify(loftOf(other).newcomer) === otherPack, 'een andere speler: zijn pakket blijft ongemoeid');
  ok(db.pigeons.filter((p) => p.ownerId === other).every((p) => p.form === 40), 'en zijn duiven ook');
  ok(loftOf(bot).newcomer === undefined, 'een bot met de naam "De Bronstige Bek" krijgt niets');

  const bells = db.notifications.filter((x) => x.id.startsWith('ntf:admin:newcomergrant2'));
  ok(bells.length === 1 && bells[0].userId === bek && bells[0].id === `ntf:admin:newcomergrant2:${bek}` &&
    bells[0].body.includes(`${NEWCOMER.expPoints} ervaringspunten`) && bells[0].body.includes('bijgetankt'),
    'één bel voor hem, eigen id, met de punten en het bijtanken');

  const diag = db.notifications.find((x) => x.id.startsWith('ntf:admin:diag-starter1'));
  ok(!!diag && diag.body.includes('3 van 5') && diag.body.includes('20 van 30') && diag.body.includes('vastgelegd op'),
    'het verslag van v75 beschrijft het OUDE pakket (v76 loopt erna)');

  // Hij geeft punten uit; een volgend verzoek mag ze niet opnieuw bijvullen.
  spendAttribute(loft, gift!, 'endurance', 1);
  const endsAt = n.endsAt;
  advanceRealtime(db, NOW + 60000);
  ok(loft.newcomer!.attrPoints === NEWCOMER.attrPoints - 1 && loft.newcomer!.endsAt === endsAt, 'ze vuurt één keer: uitgegeven punten blijven uitgegeven');
  ok(db.notifications.filter((x) => x.id.startsWith('ntf:admin:newcomergrant2')).length === 1, 'en geen tweede bel');
}
{
  // Een verzoek dat een vlucht afrondt: v76 wacht, net als v75.
  const { store, db } = prodWorld();
  const bek = addPlayer(store, 'bronstig', 'De Bronstige Bek');
  advanceRealtime(db, NOW);
  ok(db.world.dataVersion === 76, 'eerst lopen v75 en v76 gewoon');
  db.world.dataVersion = 75;
  const loft = db.lofts.find((l) => l.userId === bek)!;
  loft.newcomer!.attrPoints = 0;
  const f = db.flights.find((x) => x.status === 'scheduled' && !x.practice)!;
  f.status = 'live';
  f.startAt = new Date(NOW - 3 * 86400000).toISOString();
  advanceRealtime(db, NOW + 60000);
  ok(db.world.dataVersion === 75 && loft.newcomer!.attrPoints === 0, 'het afrondende verzoek slaat v76 over');
  advanceRealtime(db, NOW + 120000);
  ok(db.world.dataVersion === 76 && loft.newcomer!.attrPoints === NEWCOMER.attrPoints, 'het volgende verzoek geeft het pakket');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
if (fail) process.exit(1);
