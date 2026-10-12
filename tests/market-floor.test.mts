/**
 * Markt: geen verkoop onder 1/5 van de marktwaarde, en twee weggegeven duiven
 * tellen niet mee voor de waarde van de rest.
 *
 * Gemeld door de eigenaar (productie): Roekoeloos verkocht Zulma uit het Zolderhok
 * en Freddy de Fondkoning aan Graanabolica voor €25 — ver onder hun waarde — en dat
 * trok de marktwaarde van elke vergelijkbare duif omlaag.
 *
 * Gedekt:
 *   1. die twee verkopen tellen niet mee (IGNORED_TRADES), een gelijkaardige
 *      andere verkoop wél — enkel deze twee worden overgeslagen;
 *   2. te koop zetten: vraagprijs en "bieden vanaf" minstens 1/5 van de waarde;
 *   3. kopen: steeg haar waarde intussen, dan geldt 1/5 van de nieuwe waarde;
 *   4. bieden en een bod aanvaarden: idem;
 *   5. de duif-DTO geeft de ondergrens mee (minPrice) voor de schermen.
 *
 * Run: npx tsx tests/market-floor.test.mts
 */
import { MemoryStore } from '../core/store.js';
import { buyPigeon, listForSale } from '../core/game/engine.js';
import { makeOffer, respondOffer } from '../core/game/offers.js';
import { marketValue, minSalePrice } from '../core/game/market.js';
import { pigeonDTO } from '../core/presenters.js';
import { MIN_SALE_SHARE } from '../core/config/gameConfig.js';
import type { Database, Loft, Pigeon, Trade } from '../core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const eur = (n: number) => `€${n.toLocaleString('nl-BE')}`;

const WEEK = 400;
const NOW = Date.now();
const bird = (id: string, owner: string, t = 75): Pigeon => ({
  id, ownerId: owner, name: id, sex: 'doffer', birthWeek: WEEK - 60,
  speed: t, endurance: t, orientation: t, libido: 60, form: 85, health: 92,
  experience: 55, sireId: null, damId: null, forSale: false, price: null, minBid: null,
  createdAtWeek: WEEK - 60, ailment: null, inInfirmary: false, races: 20,
  everAiled: false, coached: false, ration: 'normal', compartment: false,
  hungerDays: 0, restDays: 0, genes: { speed: 95, endurance: 95, orientation: 95 },
  declineRate: 1,
} as unknown as Pigeon);

const loft = (userId: string, name: string): Loft => ({
  userId, name, money: 500000, food: { normal: 50, premium: 0, libido: 0, herstel: 0 },
  feedRation: 'normal', capacity: 20, compartments: 0, seasonPoints: 0, totalWins: 0,
  isBot: false, infirmaryCapacity: 2, medicatedFood: false, doctors: 0, physios: 0, xp: 0, level: 1,
  stats: { entries: 0, wins: 0, gold: 0, silver: 0, bronze: 0, babies: 0, cures: 0, curesSevere: 0, bets: 0, betsWon: 0, broods: 0, trades: 0, races: 0, buys: 0, sells: 0 },
  badges: [], missions: [], missionsDay: '', streak: 0, awards: [],
} as unknown as Loft);

let seq = 0;
const sale = (pigeonName: string, price: number, daysAgo: number, seller = 'Roekoeloos', buyer = 'Graanabolica', t = 75): Trade => ({
  id: `trd_${++seq}`, pigeonId: `p${seq}`, pigeonName,
  sellerId: 'x', sellerName: seller, buyerId: 'y', buyerName: buyer,
  price, at: new Date(NOW - daysAgo * 86400000).toISOString(), talent: t,
});

function world(trades: Trade[] = []) {
  const db = {
    world: { currentWeek: WEEK, dataVersion: 43 },
    users: [
      { id: 'verkoper', username: 'v', isBot: false },
      { id: 'koper', username: 'k', isBot: false },
    ],
    lofts: [loft('verkoper', 'Hok Verkoper'), loft('koper', 'Hok Koper')],
    pigeons: [bird('mijn', 'verkoper'), bird('tweede', 'verkoper')],
    flights: [], breedingPairs: [], trades: [...trades], auctions: [], bets: [],
    offers: [], notifications: [],
  } as unknown as Database;
  return { db, store: new MemoryStore(db) };
}
const P = (db: Database, id: string) => db.pigeons.find((x) => x.id === id)!;
/** A fresh Database per question: the curve is cached per Database object. */
const valueWith = (trades: Trade[]) => { const { db } = world(trades); return marketValue(db, P(db, 'mijn'), WEEK); };

console.log('\n=== 1. De twee verkopen van €25 tellen niet mee ===');
{
  const fair = [sale('Een Eerlijke Duif', 9000, 10, 'Hok A', 'Hok B')];
  const zulma = sale('Zulma uit het Zolderhok', 25, 2);
  const freddy = sale('Freddy de Fondkoning', 25, 4);
  const v0 = valueWith(fair);
  const v1 = valueWith([...fair, zulma, freddy]);
  ok(v1 === v0, `met Zulma en Freddy (€25) erbij: ${eur(v1)} — zelfde als zonder (${eur(v0)})`);
  const other = sale('Een Andere Duif', 25, 3);
  const v2 = valueWith([...fair, zulma, freddy, other]);
  ok(v2 < v0, `een andere duif voor €25 telt wél mee: ${eur(v2)} (enkel deze twee worden overgeslagen)`);
  const again = sale('Zulma uit het Zolderhok', 25, 1, 'Graanabolica', 'Hok C');
  ok(valueWith([...fair, zulma, freddy, again]) < v0,
    'Zulma later nog eens voor €25 verkocht, door een ander hok: dat telt wél (naam, prijs én beide hokken moeten kloppen)');
  const { db } = world([...fair, zulma, freddy]);
  ok(db.trades.length === 3, 'ze blijven in de verkoopgeschiedenis staan');
}

console.log('\n=== 2. Te koop zetten: minstens 1/5 van de waarde ===');
{
  const { db, store } = world();
  const p = P(db, 'mijn');
  const min = minSalePrice(db, p);
  const value = marketValue(db, p, WEEK);
  ok(min === Math.ceil(value * MIN_SALE_SHARE), `waarde ${eur(value)} → ondergrens ${eur(min)} (1/5)`);
  ok((listForSale(store, 'verkoper', 'mijn', min - 1) ?? '').includes('1/5'), `vraagprijs ${eur(min - 1)}: geweigerd`);
  ok(listForSale(store, 'verkoper', 'mijn', min) === null, `vraagprijs ${eur(min)}: mag`);
  ok((listForSale(store, 'verkoper', 'tweede', value, min - 1) ?? '').includes('1/5'), `"bieden vanaf" ${eur(min - 1)}: geweigerd`);
  ok(listForSale(store, 'verkoper', 'tweede', value, min) === null, `"bieden vanaf" ${eur(min)}: mag`);
}

console.log('\n=== 3. Kopen nadat haar waarde steeg ===');
{
  const { db, store } = world();
  const p = P(db, 'mijn');
  const min0 = minSalePrice(db, p);
  listForSale(store, 'verkoper', 'mijn', min0);
  db.trades.push(sale('Een Topverkoop', 60000, 0, 'Hok A', 'Hok B'));
  const min1 = minSalePrice(db, p);
  ok(min1 > min0, `een topverkoop tilt haar ondergrens van ${eur(min0)} naar ${eur(min1)}`);
  ok((buyPigeon(store, 'koper', 'mijn') ?? '').includes('1/5'), `kopen aan de oude vraagprijs ${eur(min0)}: geweigerd`);
  ok(p.ownerId === 'verkoper', 'en ze blijft van de verkoper');
  listForSale(store, 'verkoper', 'mijn', min1);
  ok(buyPigeon(store, 'koper', 'mijn') === null && p.ownerId === 'koper', `opnieuw te koop aan ${eur(min1)}: verkocht`);
}

console.log('\n=== 4. Bieden en een bod aanvaarden ===');
{
  const { db } = world();
  const p = P(db, 'mijn');
  const min = minSalePrice(db, p);
  ok((makeOffer(db, 'koper', 'mijn', min - 1) ?? '').includes('1/5'), `bod ${eur(min - 1)}: geweigerd`);
  ok(makeOffer(db, 'koper', 'mijn', min) === null, `bod ${eur(min)}: mag`);
  db.trades.push(sale('Een Topverkoop', 60000, 0, 'Hok A', 'Hok B'));
  const offer = db.offers[0];
  ok((respondOffer(db, 'verkoper', offer.id, true) ?? '').includes('1/5'), 'haar waarde steeg: het bod aanvaarden kan niet meer');
  ok(p.ownerId === 'verkoper' && db.offers.length === 1, 'ze blijft van de verkoper, het bod staat nog open');
  ok(respondOffer(db, 'verkoper', offer.id, false) === null && db.offers.length === 0, 'weigeren kan wel');
}

console.log('\n=== 5. De schermen kennen de ondergrens ===');
{
  const { db } = world();
  const p = P(db, 'mijn');
  const dto = pigeonDTO(db, p, 'koper') as unknown as { value: number; minPrice: number };
  ok(dto.minPrice === minSalePrice(db, p) && dto.minPrice === Math.ceil(dto.value * MIN_SALE_SHARE), `minPrice ${eur(dto.minPrice)} bij een waarde van ${eur(dto.value)}`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald\n`);
process.exit(fail === 0 ? 0 : 1);
