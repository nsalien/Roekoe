/**
 * Het starterspakket voor nieuwe spelers (NEWCOMER in gameConfig).
 *
 * Een wereld die al een maand draait is zonder ingreep dicht voor een nieuwkomer:
 * gemeten tegen de echte engine won een vers hok 0 van 20.000 races. Het pakket
 * moet dat rechttrekken zonder een achterpoortje te openen, en het moet **stoppen**
 * wanneer het hoort te stoppen — een gratis coach die stilletjes weer €80/dag kost
 * is precies het soort verrassing dat we niet willen.
 *
 * Bewaakt:
 *  1. wat een nieuw hok krijgt (100 energie, punten, sponsoraanbod, geen bots);
 *  2. de puntenportemonnee: gen-cap blijft gelden, ervaring gaat naar ÉÉN duif,
 *     je kan nooit meer uitgeven dan je hebt;
 *  3. de tijdgebonden helft: gratis coach + dubbele winst tijdens, en **niet** erna;
 *  4. de afloopmelding valt exact één keer;
 *  5. bestaande spelers (zonder pakket) veranderen niet;
 *  6. migratie v39 kent het pakket toe aan twee met naam genoemde spelers.
 *
 * Run: npx tsx newcomer.test.mts
 */
import { MemoryStore, newId } from './core/store.js';
import { emptyDatabase } from './core/schema.js';
import { seedWorld, createLoftForUser } from './core/game/engine.js';
import { advanceRealtime } from './core/game/schedule.js';
import {
  billableCoachedCount,
  newcomerActive,
  newcomerDaysLeft,
  spendAttribute,
  spendExperience,
  tickNewcomerExpiry,
  winningsMultiplier,
} from './core/game/newcomer.js';
import { geneCap } from './core/game/pigeon.js';
import { NEWCOMER, SPONSORS } from './core/config/gameConfig.js';
import type { Database, Loft, User } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const T0 = Date.parse('2026-08-27T09:00:00Z');
const DAY = 86400000;

function freshWorld(): { db: Database; store: MemoryStore; loft: Loft } {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const u: User = { id: newId('usr'), username: 'nieuweling', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString() };
  store.mutate((d) => d.users.push(u));
  const loft = createLoftForUser(store, u, 'Het Nieuwe Hok');
  return { db: store.data, store, loft };
}

// --- 1. Wat krijgt een nieuw hok? ---------------------------------------
console.log('\nStartpakket bij registratie');
const w = freshWorld();
const mine = w.db.pigeons.filter((p) => p.ownerId === w.loft.userId);
ok(mine.length === 6, `het hok heeft ${mine.length} startduiven`);
ok(mine.every((p) => p.form === NEWCOMER.startEnergie), 'elke startduif begint op 100 energie');
ok(w.loft.newcomer?.expPoints === NEWCOMER.expPoints, `${NEWCOMER.expPoints} ervaringspunten in de portemonnee`);
ok(w.loft.newcomer?.attrPoints === NEWCOMER.attrPoints, `${NEWCOMER.attrPoints} eigenschapspunten in de portemonnee`);
ok(w.loft.money === 5000, 'startgeld blijft €5000 (ongewijzigd)');
const offers = w.loft.sponsorship.offers;
ok(offers.length === 1, 'er ligt meteen precies één sponsoraanbod');
ok(
  SPONSORS.find((d) => d.id === offers[0]?.id)?.tier === NEWCOMER.sponsorTier,
  'dat aanbod is een tier-1 sponsor',
);
ok(
  w.db.notifications.some((n) => n.userId === w.loft.userId && n.title.includes('Sponsoraanbod')),
  'de speler krijgt daar een melding van',
);

// Bots mogen niets van dit alles krijgen.
const botLoft = w.db.lofts.find((l) => l.isBot)!;
ok(!botLoft.newcomer, 'een bothok krijgt GEEN starterspakket');
ok(botLoft.sponsorship.offers.length === 0, 'een bothok krijgt geen sponsoraanbod');

// --- 2. De puntenportemonnee --------------------------------------------
console.log('\nPunten uitgeven');
{
  const w2 = freshWorld();
  const [a, b] = w2.db.pigeons.filter((p) => p.ownerId === w2.loft.userId);
  a.experience = 0;

  ok(spendExperience(w2.loft, a, 10) === '', '10 ervaring toekennen lukt');
  ok(a.experience === 10, `de duif staat op ervaring ${a.experience}`);
  ok(w2.loft.newcomer!.expPoints === 20, 'er blijven 20 ervaringspunten over');
  ok(spendExperience(w2.loft, b, 5) !== '', 'ervaring naar een TWEEDE duif wordt geweigerd');
  ok(spendExperience(w2.loft, a, 999) !== '', 'meer uitgeven dan je hebt wordt geweigerd');
  ok(spendExperience(w2.loft, a, 20) === '' && w2.loft.newcomer!.expPoints === 0, 'de rest gaat naar dezelfde duif');

  // Ervaring is een voorschot, geen gevlogen ervaring: de leerfactor (§3.7) mag
  // er NIET op drukken, anders is 30 punten in de praktijk maar een handvol.
  ok(a.experience === 30, `30 punten = 30 ervaring, niet minder (staat op ${a.experience})`);
}
{
  const w3 = freshWorld();
  const p = w3.db.pigeons.find((x) => x.ownerId === w3.loft.userId)!;
  const cap = geneCap(p, 'speed');
  p.speed = cap - 2; // twee onder haar plafond
  ok(spendAttribute(w3.loft, p, 'speed', 5) === '', '5 snelheidspunten toekennen lukt');
  ok(p.speed === cap, `de gen-cap blijft gelden (${p.speed} = cap ${cap})`);
  ok(w3.loft.newcomer!.attrPoints === 3, 'alleen de punten die landden worden aangerekend (2 van 5)');
  ok(
    p.attrLog?.some((e) => e.reason === 'starterspakket'),
    'de wijziging staat in het logboek van de duif (admin-inspecteerbaar)',
  );
  p.speed = cap; // al op het plafond
  ok(spendAttribute(w3.loft, p, 'speed', 1) !== '', 'toekennen op een volle eigenschap wordt geweigerd');
}
{
  const w4 = freshWorld();
  const [a, b] = w4.db.pigeons.filter((p) => p.ownerId === w4.loft.userId);
  a.speed = 40; b.endurance = 40;
  ok(spendAttribute(w4.loft, a, 'speed', 3) === '', 'punten spreiden: +3 snelheid op duif A');
  ok(spendAttribute(w4.loft, b, 'endurance', 2) === '', '…en +2 conditie op duif B');
  ok(w4.loft.newcomer!.attrPoints === 0, 'samen precies de 5 punten op');
  ok(spendAttribute(w4.loft, a, 'speed', 1) !== '', 'een zesde punt bestaat niet');
}

// --- 3. De tijdgebonden helft -------------------------------------------
console.log('\nTijdgebonden voordelen (28 dagen)');
{
  const w5 = freshWorld();
  const loft = w5.loft;
  // Het pakket wordt gestempeld met de echte registratietijd, dus reken daarvan.
  const born = Date.parse(loft.newcomer!.startedAt);
  const during = born + 10 * DAY;
  const after = born + (NEWCOMER.days + 1) * DAY;

  ok(newcomerActive(loft, during), 'tijdens: het pakket is actief');
  ok(!newcomerActive(loft, after), 'erna: het pakket is niet meer actief');
  ok(newcomerDaysLeft(loft, during) === NEWCOMER.days - 10, `tijdens: nog ${newcomerDaysLeft(loft, during)} dagen`);
  ok(newcomerDaysLeft(loft, after) === 0, 'erna: 0 dagen');

  ok(billableCoachedCount(loft, 1, during) === 0, 'tijdens: één gecoachte duif is gratis');
  ok(billableCoachedCount(loft, 3, during) === 2, 'tijdens: coach 2 en 3 betaal je wel');
  ok(billableCoachedCount(loft, 1, after) === 1, 'erna: je betaalt weer voor elke coach');
  ok(billableCoachedCount(loft, 0, during) === 0, 'geen coach = geen negatieve kost');

  ok(winningsMultiplier(loft, during) === 2, 'tijdens: dubbele winst');
  ok(winningsMultiplier(loft, after) === 1, 'erna: gewone winst');
}

// --- 4. De afloopmelding ------------------------------------------------
console.log('\nAfloopmelding');
{
  const w6 = freshWorld();
  const born6 = Date.parse(w6.loft.newcomer!.startedAt);
  const after = born6 + (NEWCOMER.days + 1) * DAY;
  const seen: string[] = [];
  const notify = (_d: Database, userId: string, title: string, body: string, id: string) => {
    seen.push(id);
    w6.db.notifications.push({ id, userId, kind: 'info', title, body, flightId: null, createdAt: new Date(after).toISOString(), read: false });
  };

  tickNewcomerExpiry(w6.db, born6 + 5 * DAY, notify);
  ok(seen.length === 0, 'tijdens het pakket komt er GEEN afloopmelding');

  tickNewcomerExpiry(w6.db, after, notify);
  ok(seen.length === 1, 'na afloop komt er precies één melding');
  const msg = w6.db.notifications.find((n) => n.id === seen[0])!;
  ok(/gewone|dezelfde voet/i.test(msg.body), 'de melding zegt dat je nu normaal speelt');
  ok(/coach/i.test(msg.body), 'en noemt expliciet dat de coach weer geld kost');
  ok(/ervaringspunt|eigenschapspunt/i.test(msg.body), 'en herinnert aan de resterende punten');

  tickNewcomerExpiry(w6.db, after + DAY, notify);
  ok(seen.length === 1, 'een tweede tick stuurt niets meer (idempotent)');
}
{
  // Alles uitgegeven → geen zin om over restpunten te beginnen.
  const w7 = freshWorld();
  w7.loft.newcomer!.expPoints = 0;
  w7.loft.newcomer!.attrPoints = 0;
  const bodies: string[] = [];
  tickNewcomerExpiry(w7.db, Date.parse(w7.loft.newcomer!.startedAt) + (NEWCOMER.days + 1) * DAY, (_d, _u, _t, body) => { bodies.push(body); });
  ok(bodies.length === 1 && !/liggen/.test(bodies[0]), 'zonder restpunten zwijgt de melding daarover');
}

// --- 5. Bestaande spelers blijven ongemoeid -----------------------------
console.log('\nBestaande spelers');
{
  const w8 = freshWorld();
  const veteran: Loft = { ...w8.loft, userId: 'oud', newcomer: undefined };
  ok(!newcomerActive(veteran, T0), 'een hok zonder pakket is nooit "actief"');
  ok(winningsMultiplier(veteran, T0) === 1, 'en verdient gewoon enkelvoudig');
  ok(billableCoachedCount(veteran, 2, T0) === 2, 'en betaalt voor elke coach');
  ok(spendExperience(veteran, w8.db.pigeons[0], 5) !== '', 'en kan geen punten uitgeven');
  const seen: string[] = [];
  tickNewcomerExpiry({ ...w8.db, lofts: [veteran] } as Database, T0 + 999 * DAY, (_d, _u, _t, _b, id) => seen.push(id));
  ok(seen.length === 0, 'en krijgt nooit een afloopmelding');
}

// --- 6. Migratie v39: het pakket met terugwerkende kracht -----------------
console.log('\nMigratie v39 (twee bestaande spelers)');
{
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  // Drie bestaande spelers: twee doelwitten (een op hoknaam, een op gebruikers-
  // naam) en een derde die volledig ongemoeid moet blijven.
  const mk = (username: string, loftName: string) => {
    const u: User = { id: newId('usr'), username, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString() };
    store.mutate((d) => d.users.push(u));
    const l = createLoftForUser(store, u, loftName);
    l.newcomer = undefined; // registreerde vóór het pakket bestond
    l.sponsorship.offers = [];
    return l;
  };
  const a = mk('nicolai', 'Vleugels Inc.');    // match op HOKNAAM
  const b = mk('Roekoeloos', 'Het Derde Hok'); // match op GEBRUIKERSNAAM
  const c = mk('iemand', 'Onaangeroerd');      // moet ongemoeid blijven
  // Een bot die toevallig zo heet mag niets krijgen.
  const bot = store.data.lofts.find((l) => l.isBot)!;
  bot.name = 'Roekoeloos';
  // Halflege tanks, zodat het bijtanken zichtbaar is.
  for (const p of store.data.pigeons) p.form = 40;
  store.data.world.dataVersion = 38;

  advanceRealtime(store.data, Date.now());

  ok(store.data.world.dataVersion >= 39, 'de migratie is gedraaid (dataVersion 39)');
  ok(!!a.newcomer, 'Vleugels Inc. (hoknaam) krijgt het pakket');
  ok(!!b.newcomer, 'Roekoeloos (gebruikersnaam) krijgt het pakket');
  ok(!c.newcomer, 'een andere speler krijgt NIETS');
  ok(!bot.newcomer, 'een bot met dezelfde naam krijgt niets');
  ok(
    a.newcomer?.expPoints === NEWCOMER.expPoints && a.newcomer?.attrPoints === NEWCOMER.attrPoints,
    'met de volle punten',
  );
  ok(newcomerActive(a, Date.now()), 'en het venster van 28 dagen loopt vanaf nu');

  const tanked = (l: Loft) => store.data.pigeons.filter((p) => p.ownerId === l.userId).every((p) => p.form === 100);
  ok(tanked(a) && tanked(b), 'hun duiven zijn bijgetankt naar 100 energie');
  ok(
    store.data.pigeons.filter((p) => p.ownerId === c.userId).every((p) => p.form === 40),
    'de duiven van de andere speler blijven op 40',
  );

  const grants = () => store.data.notifications.filter((n) => n.id.startsWith('ntf:admin:newcomergrant:'));
  ok(grants().length === 2, `precies twee meldingen (${grants().length})`);
  ok(a.sponsorship.offers.length === 1, 'en er ligt een sponsoraanbod klaar');

  // Nog een ronde: de migratie mag niets verdubbelen.
  const moneyBefore = store.data.lofts.map((l) => l.money).join(',');
  advanceRealtime(store.data, Date.now() + 1000);
  ok(grants().length === 2, 'een tweede run stuurt geen extra melding (idempotent)');
  ok(a.newcomer?.expPoints === NEWCOMER.expPoints, 'en kent de punten niet nog eens toe');
  ok(store.data.lofts.map((l) => l.money).join(',') === moneyBefore, 'en verplaatst geen geld');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
