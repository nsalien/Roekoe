/**
 * KOPPELS & WEDUWSCHAP (⚠️ dev, nog niet live — core/game/koppels.ts).
 *
 * De afspraken van de eigenaar:
 *   - je koppelt zelf; ze hebben een willekeurige wentijd nodig vóór ze elkaar
 *     aanvaarden, en ze kunnen weigeren;
 *   - enkel als ze fysiek samen zitten (allebei in het hoofdhok), of samen in een
 *     partnerhok;
 *   - duiven trekken soms zelf naar elkaar toe; bevestigt de speler dat, dan zijn
 *     ze meteen een koppel (geen wentijd) en kan weduwschap meteen;
 *   - weduwschap: partner thuis = basis, partner + hun jongen thuis = extra;
 *   - ontkoppelen: −50 % libido; geforceerd broeden met een andere duif breekt
 *     het koppel, ook −50 % libido.
 *
 * Run: npx tsx tests/koppels.test.mts   (vanuit de repo-root)
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Database, Flight, Pigeon, User } from '../core/schema.js';
import { createLoftForUser, seedWorld, startBreeding } from '../core/game/engine.js';
import { ensureFlightsScheduled, tickDailyCare } from '../core/game/schedule.js';
import {
  brusselsDayNumber, buyPartnerhok, confirmAttraction, coupleOf, dismissAttraction, partnerOf, refuseChance,
  startWennen, tickCouples, unpair,
} from '../core/game/koppels.js';
import { entryMods, setWidow, settleWidowhood, widowLevel } from '../core/game/inrichting.js';
import { startLiveFlight } from '../core/game/flight.js';
import { loftDTO } from '../core/presenters.js';
import { COUPLES, WIDOW } from '../core/config/gameConfig.js';
import { randomWeather } from '../core/game/weather.js';

let fail = 0;
const ok = (c: boolean, m: string) => { if (c) console.log(`  ✓ ${m}`); else { fail++; console.log(`  ✗ ${m}`); } };
const DAY = 86400000;
const NOW = Date.now();
const TODAY = brusselsDayNumber(NOW);
/** An rng that returns the given values in turn. */
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

function world() {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const u: User = { id: newId('usr'), username: 'speler', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(NOW).toISOString() };
  store.mutate((d) => d.users.push(u));
  createLoftForUser(store, u, 'Hok Proef');
  const db = store.data;
  const loft = db.lofts.find((l) => l.userId === u.id)!;
  loft.money = 50000;
  const birds = db.pigeons.filter((p) => p.ownerId === u.id);
  birds.forEach((p, i) => {
    p.sex = i % 2 === 0 ? 'doffer' : 'duivin';
    p.birthWeek = db.world.currentWeek - 60;
    p.form = 80; p.health = 90; p.libido = 50;
    p.ailment = null; p.inInfirmary = false; p.compartment = false; p.trait = null;
  });
  const [d1, h1, d2, h2, d3, h3] = birds;
  return { store, db, userId: u.id, loft, d1, h1, d2, h2, d3, h3 };
}
const owned = (db: Database, userId: string) => db.pigeons.filter((p) => p.ownerId === userId);

console.log('\n=== 1. Samen zitten, of een partnerhok ===');
{
  const { store, userId, d1, h1, d2, h2 } = world();
  ok(startWennen(store, userId, h1.id, d1.id) !== null, 'een koppel is een doffer en een duivin');
  d1.compartment = true;
  ok((startWennen(store, userId, d1.id, h1.id) ?? '').includes('hoofdhok'), 'zit hij in een apart hok: niet samen → geweigerd');
  ok((startWennen(store, userId, d1.id, h1.id, { partnerhok: true }) ?? '').includes('partnerhok'), 'geen vrij partnerhok → geweigerd');
  ok(buyPartnerhok(store, userId) === null, 'partnerhok gekocht');
  ok(startWennen(store, userId, d1.id, h1.id, { partnerhok: true }, NOW, seq(0, 0.99)) === null, 'samen in het partnerhok: ze wennen');
  ok((startWennen(store, userId, d2.id, h2.id, { partnerhok: true }) ?? '').includes('partnerhok'), 'het enige partnerhok is bezet');
  ok(startWennen(store, userId, d2.id, h2.id) === null, 'een tweede duo in het hoofdhok mag wel');
  ok((startWennen(store, userId, d1.id, h2.id) ?? '').includes('wennen'), 'wie al wennen is, kan niet nog eens');
}

console.log('\n=== 2. Wentijd en weigeren ===');
{
  const { store, db, userId, loft, d1, h1, d2, h2 } = world();
  ok(Math.abs(refuseChance({ libido: 50 } as Pigeon, { libido: 50 } as Pigeon, false) - 0.2) < 1e-9, 'weigerkans bij libido 50: 20 %');
  ok(Math.abs(refuseChance({ libido: 75 } as Pigeon, { libido: 75 } as Pigeon, false) - 0.1) < 1e-9, 'bij libido 75: 10 %');
  ok(Math.abs(refuseChance({ libido: 25 } as Pigeon, { libido: 25 } as Pigeon, false) - 0.3) < 1e-9, 'bij libido 25: 30 %');
  ok(Math.abs(refuseChance({ libido: 50 } as Pigeon, { libido: 50 } as Pigeon, true) - 0.1) < 1e-9, 'in een partnerhok gehalveerd');

  startWennen(store, userId, d1.id, h1.id, {}, NOW, seq(0.5, 0.99)); // 4 dagen, geen weigering
  const c = coupleOf(loft, d1.id)!;
  ok(c.status === 'wennen' && c.resolveDay === TODAY + 4, 'wentijd geloot bij de start (hier 4 dagen)');
  const dto = loftDTO(db, loft).equipment.couples[0] as Record<string, unknown>;
  ok(!('resolveDay' in dto) && !('refuses' in dto), 'de client krijgt de einddag en het oordeel niet te zien');
  tickCouples(db, loft, owned(db, userId), TODAY + 3, NOW + 3 * DAY);
  ok(coupleOf(loft, d1.id)?.status === 'wennen' && !partnerOf(db, d1), 'dag 3: nog aan het wennen, nog geen partner');
  tickCouples(db, loft, owned(db, userId), TODAY + 4, NOW + 4 * DAY);
  ok(coupleOf(loft, d1.id)?.status === 'koppel' && partnerOf(db, d1)?.id === h1.id, 'dag 4: ze aanvaarden elkaar — een koppel');
  ok(db.notifications.some((n) => n.title.includes('nieuw koppel')), 'melding: een nieuw koppel');

  startWennen(store, userId, d2.id, h2.id, {}, NOW, seq(0, 0.0)); // 1 dag, weigering
  tickCouples(db, loft, owned(db, userId), TODAY + 1, NOW + DAY);
  ok(!coupleOf(loft, d2.id) && db.notifications.some((n) => n.title.includes('willen elkaar niet')), 'ze kunnen weigeren (melding)');

  const { store: s3, db: db3, userId: u3, loft: l3, d3, h3 } = world();
  startWennen(s3, u3, d3.id, h3.id, {}, NOW, seq(0, 0.99));
  d3.compartment = true; // apart gezet tijdens het wennen
  tickCouples(db3, l3, owned(db3, u3), TODAY + 1, NOW + DAY);
  ok(!coupleOf(l3, d3.id) && db3.notifications.some((n) => n.title.includes('Geen koppel')), 'niet meer samen bij de beslissing → mislukt');

  const days = new Set<number>(); let refused = 0;
  for (let i = 0; i < 400; i++) {
    const w = world();
    startWennen(w.store, w.userId, w.d1.id, w.h1.id);
    const cc = coupleOf(w.loft, w.d1.id)!;
    days.add(cc.resolveDay! - TODAY);
    if (cc.refuses) refused += 1;
  }
  ok(Math.min(...days) === 1 && Math.max(...days) === COUPLES.wennenMaxDays, `wentijd in het hoofdhok: 1 tot ${COUPLES.wennenMaxDays} dagen`);
  ok(refused > 40 && refused < 125, `libido 50: ~20 % weigert (${refused} op 400)`);
}

console.log('\n=== 3. Duiven die zelf naar elkaar toe trekken ===');
{
  const { store, db, userId, loft } = world();
  let day = TODAY;
  for (let i = 0; i < 80 && (loft.equipment?.attractions ?? []).length === 0; i++) {
    day += 1;
    tickCouples(db, loft, owned(db, userId), day, NOW + (day - TODAY) * DAY);
  }
  const att = loft.equipment?.attractions?.[0];
  ok(!!att, `na een tijdje trekken twee duiven naar elkaar toe (dag ${day - TODAY})`);
  ok(db.notifications.some((n) => n.title.includes('trekken naar elkaar toe')), 'met een melding');
  const atMs = NOW + (day - TODAY) * DAY;
  ok(confirmAttraction(store, userId, att!.dofferId, att!.duivinId, atMs) === null, 'bevestigen lukt');
  const c = coupleOf(loft, att!.dofferId)!;
  ok(c.status === 'koppel', 'meteen een koppel, zonder wentijd');
  const doffer = db.pigeons.find((p) => p.id === att!.dofferId)!;
  doffer.compartment = true;
  ok(setWidow(store, userId, doffer.id, true) === null, 'en weduwschap kan meteen');
  ok(confirmAttraction(store, userId, att!.dofferId, att!.duivinId, atMs) !== null, 'een tweede keer bevestigen kan niet');

  const w2 = world();
  w2.loft.equipment = { hygiene: 50, lastStrawAt: null, cleaner: false, attractions: [{ dofferId: w2.d1.id, duivinId: w2.h1.id, day: TODAY, expiresDay: TODAY + 3 }] };
  ok(confirmAttraction(w2.store, w2.userId, w2.d1.id, w2.h1.id, NOW + 5 * DAY) !== null, 'een verlopen aantrekking kan je niet meer bevestigen');
  ok(dismissAttraction(w2.store, w2.userId, w2.d1.id, w2.h1.id) === null && (w2.loft.equipment.attractions ?? []).length === 0, 'negeren haalt ze weg');
  const bot = w2.db.lofts.find((l) => l.isBot)!;
  for (let dd = 1; dd <= 60; dd++) tickCouples(w2.db, bot, owned(w2.db, bot.userId), TODAY + dd, NOW + dd * DAY);
  ok(!(bot.equipment?.attractions ?? []).length && !(bot.equipment?.couples ?? []).length, 'bots koppelen nooit');
}

console.log('\n=== 4. Ontkoppelen kost libido ===');
{
  const { store, userId, loft, d1, h1, d2, h2 } = world();
  loft.equipment = { hygiene: 50, lastStrawAt: null, cleaner: false, couples: [{ dofferId: d1.id, duivinId: h1.id, status: 'koppel', startedAt: '', since: '' }] };
  d1.libido = 60; h1.libido = 40;
  ok(unpair(store, userId, h1.id) === null && !coupleOf(loft, d1.id), 'ontkoppeld');
  ok(d1.libido === 30 && h1.libido === 20, 'beide −50 % libido (60 → 30, 40 → 20)');
  startWennen(store, userId, d2.id, h2.id, {}, NOW, seq(0.5, 0.99));
  const before = [d2.libido, h2.libido];
  unpair(store, userId, d2.id);
  ok(!coupleOf(loft, d2.id) && d2.libido === before[0] && h2.libido === before[1], 'wennen stoppen kost niets (ze waren nog geen koppel)');
}

console.log('\n=== 5. Geforceerd broeden breekt het koppel ===');
{
  const { store, db, userId, loft, d1, h1, d2, h2 } = world();
  loft.equipment = { hygiene: 50, lastStrawAt: null, cleaner: false, couples: [
    { dofferId: d1.id, duivinId: h1.id, status: 'koppel', startedAt: '', since: '' },
    { dofferId: d2.id, duivinId: h2.id, status: 'koppel', startedAt: '', since: '' },
  ] };
  ok(startBreeding(store, userId, d2.id, h2.id) === null, 'een koppel laten broeden: gewoon');
  ok(coupleOf(loft, d2.id)?.status === 'koppel' && d2.libido === 50, '…het koppel blijft, geen libidoverlies');
  db.breedingPairs = [];
  d1.libido = 60; h1.libido = 60;
  // d1 met een vrije duivin uit een derde duo:
  const h3 = db.pigeons.filter((p) => p.ownerId === userId && p.sex === 'duivin')[2];
  h3.libido = 50;
  ok(startBreeding(store, userId, d1.id, h3.id) === null, 'geforceerd: d1 met een andere duivin');
  ok(!coupleOf(loft, d1.id) && !coupleOf(loft, h1.id), 'het koppel d1 & h1 valt uiteen');
  ok(d1.libido === 30 && h1.libido === 30, 'beide partners −50 % libido');
  ok(h3.libido === 50, 'de vrije duivin verliest niets');
  ok(db.notifications.some((n) => n.title.includes('Koppel uit elkaar')), 'met een melding');
}

console.log('\n=== 6. Weduwschap: partner thuis, of partner + jongen ===');
{
  const { store, db, userId, loft, d1, h1, d2 } = world();
  d1.compartment = true;
  ok((setWidow(store, userId, d1.id, true) ?? '').includes('partner'), 'zonder partner geen weduwschap');
  loft.equipment = { hygiene: 50, lastStrawAt: null, cleaner: false, couples: [{ dofferId: d1.id, duivinId: h1.id, status: 'koppel', startedAt: '', since: '' }] };
  d1.compartment = false;
  ok((setWidow(store, userId, d1.id, true) ?? '').includes('apart hok'), 'zonder apart hok (woonhok) niet');
  d1.compartment = true;
  ok(setWidow(store, userId, d1.id, true) === null, 'met partner en woonhok: aan');
  ensureFlightsScheduled(db, NOW);
  const f = db.flights.find((x) => x.status === 'scheduled' && !x.relay && !x.practice)!;
  const startMs = Date.parse(f.startAt);
  ok(widowLevel(db, d1, f, startMs) === 1, 'partner thuis: basis (niveau 1)');
  const child: Pigeon = { ...d2, id: newId('pig'), name: 'Jong Test', sireId: d1.id, damId: h1.id, ownerId: userId };
  db.pigeons.push(child);
  ok(widowLevel(db, d1, f, startMs) === 2, 'partner + hun jong thuis: extra (niveau 2)');
  f.entries.push({ pigeonId: child.id, ownerId: userId } as any);
  ok(widowLevel(db, d1, f, startMs) === 1, 'vliegt het jong die dag zelf: terug naar basis');
  f.entries.push({ pigeonId: h1.id, ownerId: userId } as any);
  ok(widowLevel(db, d1, f, startMs) === 0, 'vliegt de partner die dag zelf: geen effect');
  f.entries = [];
  db.breedingPairs.push({ id: 'brd_x', ownerId: userId, sireId: d1.id, damId: h1.id, hatchAt: new Date().toISOString(), createdAtWeek: 1 } as any);
  ok(widowLevel(db, d1, f, startMs) === 0, 'zitten ze op een nest: geen effect');
  db.breedingPairs = [];
  const mods = entryMods(db, d1, f, startMs);
  const flight = { ...f, id: 'flt_wed', entries: [] } as Flight;
  startLiveFlight(flight, [{ pigeon: d1, ownerName: 'x', mods }], db.world.currentWeek, randomWeather());
  ok(flight.sim[0].widow === 2, 'de sim onthoudt het niveau');
  const m = loft.money; const e = h1.form;
  settleWidowhood(db, flight);
  ok(loft.money === m - WIDOW.feePerFlight && Math.abs(h1.form - Math.max(0, e - WIDOW.duivinEnergyLoss)) < 0.01, '€10 per vlucht, de partner −3 energie');

  // Verkocht de partner: het koppel en het weduwschap verdwijnen bij de dagovergang.
  h1.ownerId = 'iemand_anders';
  tickCouples(db, loft, owned(db, userId), TODAY + 1, NOW + DAY);
  ok(!coupleOf(loft, d1.id) && !d1.care?.widow, 'partner verkocht: koppel en weduwschap weg');
}

console.log('\n=== 7. De dagovergang beslist het wennen ===');
{
  const { store, db, userId, loft, d1, h1 } = world();
  tickDailyCare(db, NOW);
  startWennen(store, userId, d1.id, h1.id, {}, NOW, seq(0, 0.99)); // morgen beslist
  let now = NOW;
  for (let dd = 0; dd < 2; dd++) { now += DAY; for (let i = 0; i < 40; i++) tickDailyCare(db, now); }
  ok(coupleOf(loft, d1.id)?.status === 'koppel', 'na de dagovergang zijn ze een koppel');
}

if (fail > 0) { console.log(`\n${fail} mislukt`); process.exitCode = 1; }
else console.log('\nalles groen');
