/**
 * SCHULD: wat er gebeurt wanneer de kassa onder nul zakt (§4.5 spelregels, DEBT
 * in gameConfig, core/game/debt.ts).
 *
 * Waarom deze test bestaat: dit is een regel die zichzelf pas maanden later laat
 * zien, en dan met echte gevolgen — er verdwijnt een duif uit het hok van een
 * speler. Drie dingen mogen daarbij nooit stilletjes verschuiven:
 *
 *   1. de POORT — in het rood kan je niets kopen, maar verkopen moet blijven
 *      werken, want dat is de enige uitweg;
 *   2. de BODEM — je laatste duif wordt nooit geveild, en een duif die vliegt of
 *      koppelt evenmin;
 *   3. de AFSLAG — bots bieden niet op veilingen, dus een gedwongen veiling kan
 *      zonder bod sluiten. Gebeurt dat, dan MOET de volgende ronde lager openen,
 *      anders hangt een schuld eeuwig.
 *
 * Plus de gewone huisregel van dit project: alles wat binnen `advanceRealtime`
 * gebeurt draagt een stabiele id, zodat een dubbel verwerkt verzoek geen tweede
 * veiling en geen tweede melding oplevert.
 *
 * Run: npx tsx tests/debt.test.mts   (vanuit de repo-root)
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import {
  seedWorld, createLoftForUser, buyFood, sellFood, trainPigeon, setCoach,
  startRestCure, upgradeCapacity, buyPigeon, listForSale,
} from '../core/game/engine.js';
import { tickDailyCare } from '../core/game/schedule.js';
import { ensureAuctions, placeBid, auctionKind } from '../core/game/auction.js';
import { debtBlock } from '../core/game/economy.js';
import { worstAuctionable } from '../core/game/debt.js';
import { marketValue } from '../core/game/market.js';
import { DEBT } from '../core/config/gameConfig.js';
import type { Database, User } from '../core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const DAY = 86400000;
/**
 * ⚠️ HET ANKER LOOPT MEE MET DE ECHTE KLOK, en dat is geen slordigheid.
 *
 * Twee redenen. Ten eerste de tijdbom die dit project al kent van `age-cup`: een
 * vaste datum in de test veroudert en valt op een dag stil om.
 *
 * Ten tweede, en dwingender: `placeBid` leest intern `Date.now()` voor zijn
 * slotfase en anti-snipe. Ligt de gesimuleerde klok vóór de echte, dan telt élk
 * bod als "in de laatste 5 minuten" en schuift `endAt` naar de echte tijd + 5
 * min — waarna de veiling in de simulatie nooit meer afloopt. Door hier vanaf
 * vandaag te vertrekken loopt de gesimuleerde klok juist vóór op de echte, en
 * gedraagt de veiling zich zoals in productie.
 */
const T0 = Date.parse(new Date().toISOString().slice(0, 10) + 'T04:00:00Z');

function buildWorld(players = 2) {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const ids: string[] = [];
  for (let i = 0; i < players; i++) {
    const u: User = {
      id: newId('usr'), username: `speler${i}`, passwordHash: 'x',
      isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString(),
    };
    store.mutate((d) => d.users.push(u));
    createLoftForUser(store, u, `Hok ${i}`);
    ids.push(u.id);
  }
  const db = store.data;
  // De dagtick verankeren op vandaag, zodat dag 1 hieronder ook echt dag 1 is.
  tickDailyCare(db, T0);
  return { store, db, ids };
}

const loftOf = (db: Database, userId: string) => db.lofts.find((l) => l.userId === userId)!;

/**
 * Rol N dagen door. ⚠️ `tickDailyCare` doet hoogstens één dag per aanroep én
 * maar DAILY_CARE_LOFTS_PER_RUN hokken daarvan, dus één aanroep per dag is niet
 * genoeg — pollen tot de dag echt afgesloten is.
 */
function rollDays(db: Database, from: number, days: number): number {
  let now = from;
  for (let d = 0; d < days; d++) {
    now += DAY;
    // ⚠️ `ensureAuctions` hoort erbij: dát is wat een afgelopen veiling sluit
    // (advanceRealtime roept beide aan). Zonder deze regel loopt geen enkele
    // gedwongen veiling ooit af en meet de test niets.
    for (let poll = 0; poll < 40; poll++) { tickDailyCare(db, now); ensureAuctions(db, now); }
  }
  return now;
}

console.log('\n=== 1. De poort: in het rood kan je niets kopen, verkopen blijft open ===');
{
  const { store, db, ids } = buildWorld();
  const loft = loftOf(db, ids[0]);
  loft.money = -500;
  const mine = db.pigeons.filter((p) => p.ownerId === ids[0]);

  ok(debtBlock(loft) !== null, 'debtBlock geeft een melding bij een negatieve kassa');
  ok(debtBlock(loftOf(db, ids[1])) === null, '…en niets bij een gezonde kassa');

  ok(!!buyFood(store, ids[0], 'normal', 10), 'voer kopen wordt geweigerd');
  ok(!!trainPigeon(store, ids[0], mine[0].id, 'speed'), 'trainen wordt geweigerd');
  ok(!!setCoach(store, ids[0], mine[0].id, true), 'een coach inhuren wordt geweigerd');
  ok(!!startRestCure(store, ids[0], mine[0].id), 'een rustkuur wordt geweigerd');
  ok(!!upgradeCapacity(store, ids[0]), 'het hok uitbreiden wordt geweigerd');

  // ⚠️ Een coach kost NIETS op het moment van klikken (COACH.hireCost is 0), dus
  // zonder een expliciete poort glipt hij langs elke `money < kost`-controle.
  ok(!mine[0].coached, 'de duif heeft ook echt geen coach gekregen');

  // De uitwegen moeten openblijven, anders is de schuld een doodlopende straat.
  loft.food.normal = 20;
  ok(sellFood(store, ids[0], 'normal', 5) === null, 'voer terugverkopen mag wél');
  ok(listForSale(store, ids[0], mine[0].id, 2000, null) === null, 'een duif te koop zetten mag wél');

  // Kopen van een ander is ook een aankoop.
  const other = db.pigeons.find((p) => p.ownerId === ids[1])!;
  other.forSale = true; other.price = 100;
  ok(!!buyPigeon(store, ids[0], other.id), 'een duif kopen wordt geweigerd');
}

console.log('\n=== 2. Dag 1 in het rood: coaches eruit + één melding ===');
{
  const { db, ids } = buildWorld();
  const loft = loftOf(db, ids[0]);
  const mine = db.pigeons.filter((p) => p.ownerId === ids[0]);
  mine[0].coached = true; mine[1].coached = true;
  loft.money = -200;

  rollDays(db, T0, 1);
  ok(loft.debtDays === 1, 'de teller staat op dag 1');
  ok(db.pigeons.filter((p) => p.ownerId === ids[0] && p.coached).length === 0, 'beide coaches zijn ontslagen');
  const notes = db.notifications.filter((n) => n.userId === ids[0] && n.id.startsWith('ntf:debt:start'));
  ok(notes.length === 1, 'precies één melding dat de kassa negatief staat');
  ok(/coach/i.test(notes[0]?.body ?? ''), '…en die melding zegt dat de coaches eruit zijn');

  // Een tweede pas over dezelfde dag mag er geen tweede van maken.
  for (let i = 0; i < 5; i++) tickDailyCare(db, T0 + DAY);
  ok(db.notifications.filter((n) => n.id.startsWith('ntf:debt:start')).length === 1,
    'herhaald pollen levert geen tweede melding op (stabiele id)');
}

console.log('\n=== 3. Na 10 dagen: de slechtste duif gaat onder de hamer ===');
{
  const { db, ids } = buildWorld();
  const loft = loftOf(db, ids[0]);
  loft.money = -300;
  loft.food.normal = 999; // niet laten verhongeren — dit gaat over schuld, niet over honger
  const mine = db.pigeons.filter((p) => p.ownerId === ids[0]);
  // Eén duidelijk slechtste duif maken.
  const worst = mine[3];
  worst.speed = 30; worst.endurance = 30; worst.orientation = 30;

  ok(worstAuctionable(db, loft)?.id === worst.id, 'de kandidaat is de duif met het laagste talent');

  let now = rollDays(db, T0, DEBT.graceDays - 1);
  ok(db.auctions.filter((a) => auctionKind(a) === 'forced').length === 0,
    `op dag ${DEBT.graceDays - 1} is er nog geen gedwongen veiling`);

  now = rollDays(db, now, 1);
  const forced = db.auctions.filter((a) => auctionKind(a) === 'forced');
  ok(forced.length === 1, `op dag ${DEBT.graceDays} staat er precies één gedwongen veiling open`);
  ok(forced[0]?.pigeonId === worst.id, '…met de slechtste duif erin');
  // ⚠️ De marktwaarde van NU, niet die van tien dagen geleden: de duif is
  // intussen ouder geworden en de markt leert van elke verkoop die er ondertussen
  // gebeurde. Met de oude waarde meet je die drift in plaats van de openingsprijs.
  const opening = Math.max(
    DEBT.minOpeningBid,
    Math.round(marketValue(db, worst, db.world.currentWeek) / 10) * 10,
  );
  ok(forced[0]?.minBid === opening, `…die opent op haar marktwaarde (€${opening})`);
  ok(db.pigeons.some((p) => p.id === worst.id && p.ownerId === ids[0]),
    'de duif is nog altijd van de speler zolang de veiling loopt');

  // Idempotent: nog eens pollen op dezelfde dag opent geen tweede veiling.
  for (let i = 0; i < 5; i++) tickDailyCare(db, now);
  ok(db.auctions.filter((a) => auctionKind(a) === 'forced').length === 1,
    'herhaald pollen opent geen tweede veiling (stabiele id)');

  // Je eigen duif terugkopen mag niet.
  ok(!!placeBid(db, ids[0], forced[0].id, opening), 'de eigenaar kan niet op zijn eigen veiling bieden');
}

console.log('\n=== 4. Geen bod: de duif blijft, de volgende ronde opent lager ===');
{
  const { db, ids } = buildWorld();
  const loft = loftOf(db, ids[0]);
  loft.money = -300;
  loft.food.normal = 999;
  const mine = db.pigeons.filter((p) => p.ownerId === ids[0]);
  const worst = mine[3];
  worst.speed = 30; worst.endurance = 30; worst.orientation = 30;
  const value = marketValue(db, worst, db.world.currentWeek);

  let now = rollDays(db, T0, DEBT.graceDays);
  const first = db.auctions.find((a) => auctionKind(a) === 'forced')!;
  const firstOpening = first.minBid;

  // Niemand biedt; de veiling loopt af.
  now = rollDays(db, now, DEBT.graceDays);
  ok(db.pigeons.some((p) => p.id === worst.id && p.ownerId === ids[0]),
    '⚠️ zonder bod wordt de duif NIET verwijderd — ze blijft van haar eigenaar');
  ok((loft.debtMisses ?? 0) >= 1, 'de gemiste veiling is geteld');
  const rounds = db.auctions.filter((a) => auctionKind(a) === 'forced');
  ok(rounds.length === 2, 'er is een tweede ronde geopend');
  const second = rounds[rounds.length - 1];
  ok(second.minBid < firstOpening, `de tweede ronde opent lager (€${second.minBid} < €${firstOpening})`);
  // ⚠️ Reken met de marktwaarde van NU, niet die van twintig dagen geleden: de
  // duif is intussen ouder en de markt beweegt mee, dus de oude waarde als basis
  // nemen zou een verschil meten dat niets met de afslag te maken heeft.
  const valueNow = marketValue(db, worst, db.world.currentWeek);
  const expected = Math.max(
    DEBT.minOpeningBid,
    Math.round((valueNow * (1 - DEBT.markdownPerRound)) / 10) * 10,
  );
  ok(second.minBid === expected, `…met exact ${Math.round(DEBT.markdownPerRound * 100)}% afslag (€${expected})`);
  ok(value > 0, `(referentie: haar waarde bij de eerste ronde was €${value})`);
}

console.log('\n=== 5. Verkocht: het geld gaat naar de schuldenaar ===');
{
  const { db, ids } = buildWorld();
  const debtor = loftOf(db, ids[0]);
  const buyerLoft = loftOf(db, ids[1]);
  debtor.money = -300;
  debtor.food.normal = 999;
  buyerLoft.money = 50000;
  buyerLoft.capacity = 30;
  const mine = db.pigeons.filter((p) => p.ownerId === ids[0]);
  const worst = mine[3];
  worst.speed = 30; worst.endurance = 30; worst.orientation = 30;

  let now = rollDays(db, T0, DEBT.graceDays);
  const auction = db.auctions.find((a) => auctionKind(a) === 'forced')!;
  const bid = auction.minBid;
  ok(placeBid(db, ids[1], auction.id, bid) === null, 'een andere speler kan gewoon bieden');

  const before = debtor.money;
  // ⚠️ Bewust ALLEEN ensureAuctions en niet de dagtick: die zou er twee dagen
  // vaste onkosten afhalen, en dan meet "de opbrengst staat op de kassa" iets
  // anders dan wat het beweert.
  ensureAuctions(db, now + 2 * DAY);
  ok(auction.status === 'closed', 'de veiling is gesloten');
  ok(db.pigeons.find((p) => p.id === worst.id)?.ownerId === ids[1], 'de duif is van eigenaar gewisseld');
  ok(debtor.money === before + bid, `de volledige opbrengst (€${bid}) staat op de kassa van de schuldenaar`);
  ok((debtor.debtMisses ?? 0) === 0, 'de afslag is teruggezet — de volgende ronde start weer op marktwaarde');
  ok(db.notifications.some((n) => n.userId === ids[0] && n.id === `ntf:debt:sold:${auction.id}`),
    'de schuldenaar krijgt bericht van de verkoop');
  ok(db.trades.some((t) => t.pigeonId === worst.id && t.sellerId === ids[0] && t.price === bid),
    'de verkoop staat als echte transactie in de geschiedenis (met de speler als verkoper)');
}

console.log('\n=== 6. De bodem: de laatste duif wordt nooit geveild ===');
{
  const { db, ids } = buildWorld();
  const loft = loftOf(db, ids[0]);
  loft.money = -300;
  loft.food.normal = 999;
  const mine = db.pigeons.filter((p) => p.ownerId === ids[0]);
  // Alles weg op één duif na.
  db.pigeons = db.pigeons.filter((p) => p.ownerId !== ids[0] || p.id === mine[0].id);

  ok(worstAuctionable(db, loft) === null, `met ${DEBT.keepPigeons} duif is er geen kandidaat`);
  rollDays(db, T0, DEBT.graceDays);
  ok(db.auctions.filter((a) => auctionKind(a) === 'forced').length === 0,
    'er wordt geen enkele gedwongen veiling geopend');
  ok(db.notifications.some((n) => n.userId === ids[0] && n.id.startsWith('ntf:debt:nobird')),
    '…en de speler krijgt te horen waarom');
  ok(db.pigeons.some((p) => p.id === mine[0].id), 'de laatste duif staat er nog');
}

console.log('\n=== 7. Weer uit het rood: alles gaat terug op nul ===');
{
  const { db, ids } = buildWorld();
  const loft = loftOf(db, ids[0]);
  loft.money = -300;
  loft.food.normal = 999;
  let now = rollDays(db, T0, 3);
  ok((loft.debtDays ?? 0) === 3, 'de teller liep op tot 3');

  loft.money = 5000;
  now = rollDays(db, now, 1);
  ok((loft.debtDays ?? 0) === 0, 'de teller staat weer op 0');
  ok((loft.debtMisses ?? 0) === 0, 'de afslag staat weer op 0');
  ok(db.notifications.some((n) => n.userId === ids[0] && n.id.startsWith('ntf:debt:clear')),
    'de speler krijgt bericht dat de kassa weer op groen staat');

  // En daarna telt hij netjes opnieuw vanaf 1 — geen resten van de vorige ronde.
  loft.money = -100;
  now = rollDays(db, now, 1);
  ok((loft.debtDays ?? 0) === 1, 'een nieuwe schuld begint weer op dag 1');
}

console.log('\n=== 8. Bots blijven buiten schot ===');
{
  const { db } = buildWorld();
  const bot = db.lofts.find((l) => l.isBot)!;
  bot.money = -5000;
  rollDays(db, T0, DEBT.graceDays + 1);
  ok(db.auctions.filter((a) => auctionKind(a) === 'forced' && a.templateKey.includes(bot.userId)).length === 0,
    'een bot in het rood krijgt geen gedwongen veiling');
  ok(!db.notifications.some((n) => n.userId === bot.userId && n.id.startsWith('ntf:debt')),
    '…en ook geen meldingen (die leest hij toch niet)');
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} geslaagd, ${fail} gefaald\n`);
process.exit(fail === 0 ? 0 : 1);
