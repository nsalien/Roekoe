/**
 * Regressietest op "marktprijs + bieden vanaf".
 *
 * Een verkoper zet twee bedragen: een MARKTPRIJS waarvoor de duif meteen van
 * eigenaar wisselt, en optioneel een ondergrens BIEDEN VANAF waarboven anderen
 * een bod mogen doen dat hij zelf aanvaardt of weigert.
 *
 * Het mechanisme is er enkel voor ÉCHTE spelers: een bot verkoopt tegen zijn
 * vraagprijs en onderhandelt niet.
 *
 * Draai: npx tsx market-bidding.test.mts
 */
import { MemoryStore } from './core/store.js';
import { listForSale, unlist, buyPigeon } from './core/game/engine.js';
import { makeOffer, respondOffer } from './core/game/offers.js';
import type { Database, Loft, Pigeon } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
};

const WEEK = 400;
const bird = (id: string, owner: string): Pigeon => ({
  id, ownerId: owner, name: id, sex: 'doffer', birthWeek: WEEK - 60,
  speed: 75, endurance: 75, orientation: 75, libido: 60, form: 85, health: 92,
  experience: 55, sireId: null, damId: null, forSale: false, price: null, minBid: null,
  createdAtWeek: WEEK - 60, ailment: null, inInfirmary: false, races: 20,
  everAiled: false, coached: false, ration: 'normal', compartment: false,
  hungerDays: 0, restDays: 0, genes: { speed: 95, endurance: 95, orientation: 95 },
  declineRate: 1,
} as unknown as Pigeon);

const loft = (userId: string, name: string, isBot = false): Loft => ({
  userId, name, money: 20000, food: { normal: 50, premium: 0, libido: 0, herstel: 0 },
  feedRation: 'normal', capacity: 20, compartments: 0, seasonPoints: 0, totalWins: 0,
  isBot, infirmaryCapacity: 2, medicatedFood: false, doctors: 0, physios: 0, xp: 0, level: 1,
  stats: { entries: 0, wins: 0, gold: 0, silver: 0, bronze: 0, babies: 0, cures: 0, curesSevere: 0, bets: 0, betsWon: 0, broods: 0, trades: 0, races: 0, buys: 0, sells: 0 },
  badges: [], missions: [], missionsDay: '', streak: 0, awards: [],
} as unknown as Loft);

function world() {
  const pigeons = [bird('mijn', 'verkoper'), bird('tweede', 'verkoper'), bird('botduif', 'bot1')];
  const db = {
    world: { currentWeek: WEEK, dataVersion: 43 },
    users: [
      { id: 'verkoper', username: 'v', isBot: false },
      { id: 'koper', username: 'k', isBot: false },
      { id: 'bot1', username: 'b', isBot: true },
    ],
    lofts: [loft('verkoper', 'Hok Verkoper'), loft('koper', 'Hok Koper'), loft('bot1', 'Botje', true)],
    pigeons, flights: [], breedingPairs: [], trades: [], auctions: [], bets: [],
    offers: [], notifications: [],
  } as unknown as Database;
  return { db, store: new MemoryStore(db) };
}
const P = (db: Database, id: string) => db.pigeons.find((x) => x.id === id)!;
const L = (db: Database, id: string) => db.lofts.find((x) => x.userId === id)!;

// --- 1. De verkoper zet twee bedragen ------------------------------------
console.log('\nDe verkoper zet marktprijs + bieden vanaf');
{
  const { db, store } = world();
  ok('marktprijs €4000 met bieden vanaf €3000 wordt aanvaard',
    listForSale(store, 'verkoper', 'mijn', 4000, 3000) === null);
  ok('  beide bedragen staan op de duif', P(db, 'mijn').price === 4000 && P(db, 'mijn').minBid === 3000);

  ok('een ondergrens BOVEN de marktprijs wordt geweigerd',
    listForSale(store, 'verkoper', 'tweede', 4000, 4500) !== null);
  ok('een ondergrens van 0 wordt geweigerd', listForSale(store, 'verkoper', 'tweede', 4000, 0) !== null);
  ok('een ondergrens gelijk aan de marktprijs mag',
    listForSale(store, 'verkoper', 'tweede', 4000, 4000) === null);

  ok('zonder ondergrens is het gewoon koop-nu, zoals vroeger',
    listForSale(store, 'verkoper', 'mijn', 4000, null) === null && P(db, 'mijn').minBid === null);

  // Uit de verkoop halen wist alles.
  listForSale(store, 'verkoper', 'mijn', 4000, 3000);
  unlist(store, 'verkoper', 'mijn');
  ok('uit de verkoop halen wist prijs én ondergrens',
    !P(db, 'mijn').forSale && P(db, 'mijn').price === null && P(db, 'mijn').minBid === null);
}

// --- 2. Enkel voor echte spelers -----------------------------------------
console.log('\nEnkel voor échte spelers');
{
  const { db, store } = world();
  listForSale(store, 'bot1', 'botduif', 2000, 1500);
  ok('een bot krijgt nooit een ondergrens', P(db, 'botduif').minBid === null);
  ok('  maar staat wel gewoon te koop', P(db, 'botduif').forSale && P(db, 'botduif').price === 2000);
  ok('bieden op een botduif blijft geweigerd', makeOffer(db, 'koper', 'botduif', 1800) !== null);
}

// --- 3. Bieden op een listing --------------------------------------------
console.log('\nBieden op een duif die te koop staat');
{
  const { db, store } = world();
  listForSale(store, 'verkoper', 'mijn', 4000, 3000);

  ok('een bod ONDER de ondergrens wordt geweigerd', makeOffer(db, 'koper', 'mijn', 2500) !== null);
  ok('  met een melding die de ondergrens noemt',
    (makeOffer(db, 'koper', 'mijn', 2500) ?? '').includes('3000'));
  ok('een bod OP de marktprijs wordt geweigerd (koop haar dan gewoon)',
    makeOffer(db, 'koper', 'mijn', 4000) !== null);
  ok('een bod BOVEN de marktprijs eveneens', makeOffer(db, 'koper', 'mijn', 5000) !== null);

  const notesBefore = db.notifications.length;
  ok('een bod van €3500 wordt aanvaard', makeOffer(db, 'koper', 'mijn', 3500) === null);
  ok('  het bod staat open bij de verkoper',
    db.offers.some((o) => o.pigeonId === 'mijn' && o.toUserId === 'verkoper' && o.amount === 3500 && o.status === 'pending'));
  ok('  en de verkoper krijgt er een melding van', db.notifications.length === notesBefore + 1);
  ok('  de melding noemt bedrag en duif',
    db.notifications.slice(-1)[0].title.includes('3500') && db.notifications.slice(-1)[0].body.includes('mijn'));

  // Verhogen pingt opnieuw, verlagen niet.
  const n1 = db.notifications.length;
  makeOffer(db, 'koper', 'mijn', 3800);
  ok('een HOGER bod meldt opnieuw', db.notifications.length === n1 + 1);
  const n2 = db.notifications.length;
  makeOffer(db, 'koper', 'mijn', 3200);
  ok('een LAGER bod meldt niet opnieuw', db.notifications.length === n2);
  ok('  maar past het bedrag wel aan',
    db.offers.find((o) => o.pigeonId === 'mijn')!.amount === 3200);
}

// --- 4. Zonder ondergrens kan je niet bieden -----------------------------
console.log('\nZonder ondergrens is het koop-nu, punt');
{
  const { db, store } = world();
  listForSale(store, 'verkoper', 'mijn', 4000, null);
  const err = makeOffer(db, 'koper', 'mijn', 3500);
  ok('bieden op een vaste-prijs-listing wordt geweigerd', err !== null);
  ok('  met een melding die dat uitlegt', (err ?? '').toLowerCase().includes('vaste prijs'));
}

// --- 5. De verkoper beslist ----------------------------------------------
console.log('\nDe verkoper aanvaardt of weigert');
{
  const { db, store } = world();
  listForSale(store, 'verkoper', 'mijn', 4000, 3000);
  makeOffer(db, 'koper', 'mijn', 3500);
  const offerId = db.offers.find((o) => o.pigeonId === 'mijn')!.id;
  const geldVerkoper = L(db, 'verkoper').money, geldKoper = L(db, 'koper').money;

  ok('weigeren laat de duif te koop staan',
    respondOffer(db, 'verkoper', offerId, false) === null && P(db, 'mijn').forSale && P(db, 'mijn').minBid === 3000);
  ok('  en verplaatst geen geld', L(db, 'verkoper').money === geldVerkoper && L(db, 'koper').money === geldKoper);

  makeOffer(db, 'koper', 'mijn', 3600);
  const tweede = db.offers.find((o) => o.pigeonId === 'mijn' && o.status === 'pending')!.id;
  ok('aanvaarden verkoopt de duif', respondOffer(db, 'verkoper', tweede, true) === null);
  ok('  de duif is van de koper', P(db, 'mijn').ownerId === 'koper');
  ok('  ze staat niet meer te koop en de ondergrens is weg',
    !P(db, 'mijn').forSale && P(db, 'mijn').price === null && P(db, 'mijn').minBid === null);
  ok('  het geld is verhuisd voor het GEBODEN bedrag, niet de vraagprijs',
    L(db, 'verkoper').money === geldVerkoper + 3600 && L(db, 'koper').money === geldKoper - 3600);
  ok('  de verkoop staat in de handelsgeschiedenis voor €3600',
    db.trades.some((t) => t.pigeonId === 'mijn' && t.price === 3600));
}

// --- 6. Koop-nu blijft werken --------------------------------------------
console.log('\nKoop-nu naast het bieden');
{
  const { db, store } = world();
  listForSale(store, 'verkoper', 'mijn', 4000, 3000);
  makeOffer(db, 'koper', 'mijn', 3500); // open bod dat blijft hangen
  const geldVerkoper = L(db, 'verkoper').money;
  ok('wie de marktprijs betaalt koopt haar meteen', buyPigeon(store, 'koper', 'mijn') === null);
  ok('  voor de volle vraagprijs', L(db, 'verkoper').money === geldVerkoper + 4000);
  ok('  de duif is van de koper en de ondergrens is gewist',
    P(db, 'mijn').ownerId === 'koper' && P(db, 'mijn').minBid === null && !P(db, 'mijn').forSale);
  ok('  het openstaande bod is vervallen',
    !db.offers.some((o) => o.pigeonId === 'mijn' && o.status === 'pending'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
