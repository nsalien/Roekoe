/**
 * Regressietest: bots kopen én bieden op duiven van échte spelers, binnen een
 * band rond de marktwaarde.
 *
 * Kopen deden ze al (tot BOT.marketMaxOverpay × de waarde). Nieuw is dat een bot
 * die de vraagprijs te steil vindt, gaat onderhandelen wanneer de verkoper een
 * "bieden vanaf" heeft gezet — met een bod tussen BOT.bidMinFactor en
 * BOT.bidMaxFactor van wat de duif volgens de markt wáárd is.
 *
 * Draai: npx tsx bot-bidding.test.mts
 */
import { botDailyActions } from './core/game/bots.js';
import { valuePigeon } from './core/game/market.js';
import { BOT } from './core/config/gameConfig.js';
import type { Database, Loft, Pigeon } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
};

const WEEK = 400;
const NOW = Date.now();
const OUD = new Date(NOW - (BOT.marketMinListedHours + 2) * 3600000).toISOString();

const bird = (id: string, owner: string, q: number): Pigeon => ({
  id, ownerId: owner, name: id, sex: 'doffer', birthWeek: WEEK - 80,
  speed: q, endurance: q, orientation: q, libido: 60, form: 85, health: 92,
  experience: 55, sireId: null, damId: null, forSale: false, price: null, minBid: null,
  listedAt: null, createdAtWeek: WEEK - 80, ailment: null, inInfirmary: false, races: 20,
  everAiled: false, coached: false, ration: 'normal', compartment: false,
  hungerDays: 0, restDays: 0, genes: { speed: 95, endurance: 95, orientation: 95 },
  declineRate: 1,
} as unknown as Pigeon);

const loft = (userId: string, name: string, isBot: boolean, money: number): Loft => ({
  userId, name, money, food: { normal: 200, premium: 0, libido: 0, herstel: 200 },
  feedRation: 'normal', capacity: 20, compartments: 0, seasonPoints: 0, totalWins: 0,
  isBot, infirmaryCapacity: 2, medicatedFood: false, doctors: 0, physios: 0, xp: 0, level: 1,
  stats: { entries: 0, wins: 0, gold: 0, silver: 0, bronze: 0, babies: 0, cures: 0, curesSevere: 0, bets: 0, betsWon: 0, broods: 0, trades: 0, races: 0, buys: 0, sells: 0 },
  badges: [], missions: [], missionsDay: '', streak: 0, awards: [],
} as unknown as Loft);

/** Wereld met één bot (veel geld, zwakke duiven) en één speler-verkoper. */
function world(opts: { price: number; minBid: number | null; botMoney?: number }) {
  const pigeons: Pigeon[] = [
    ...Array.from({ length: 4 }, (_, i) => bird(`bot${i}`, 'bot1', 55 + i)),
    bird('koopje', 'speler', 85),
  ];
  const te = pigeons.find((p) => p.id === 'koopje')!;
  te.forSale = true; te.price = opts.price; te.minBid = opts.minBid; te.listedAt = OUD;
  const db = {
    world: { currentWeek: WEEK, dataVersion: 43 },
    users: [{ id: 'bot1', username: 'b', isBot: true }, { id: 'speler', username: 's', isBot: false }],
    lofts: [loft('bot1', 'Botje', true, opts.botMoney ?? 60000), loft('speler', 'Hok Speler', false, 10000)],
    pigeons, flights: [], breedingPairs: [], trades: [], auctions: [], bets: [],
    offers: [], notifications: [],
  } as unknown as Database;
  return { db, te };
}
const runBot = (db: Database) =>
  botDailyActions(db, db.lofts.find((l) => l.userId === 'bot1')!, db.pigeons.filter((p) => p.ownerId === 'bot1'), NOW);

// De waarde die de bot hanteert, uit dezelfde bron als de engine.
const waarde = (db: Database, id: string) =>
  valuePigeon(db, db.pigeons.find((p) => p.id === id)!, WEEK).value;

// --- 1. Redelijke vraagprijs → gewoon kopen ------------------------------
console.log('\nEen redelijke vraagprijs koopt de bot gewoon');
{
  const probe = world({ price: 1, minBid: null });
  const v = waarde(probe.db, 'koopje');
  console.log(`  (marktwaarde van de testduif: €${Math.round(v)})`);

  const { db } = world({ price: Math.round(v), minBid: null });
  runBot(db);
  ok('de duif is van de bot', db.pigeons.find((p) => p.id === 'koopje')!.ownerId === 'bot1');
  ok('  en er is geen bod uitgebracht', db.offers.length === 0);
}

// --- 2. Te dure vraagprijs zonder ondergrens → niets ---------------------
console.log('\nTe duur en geen "bieden vanaf": de bot laat het liggen');
{
  const probe = world({ price: 1, minBid: null });
  const v = waarde(probe.db, 'koopje');
  const { db } = world({ price: Math.round(v * 3), minBid: null });
  runBot(db);
  ok('de duif blijft van de speler', db.pigeons.find((p) => p.id === 'koopje')!.ownerId === 'speler');
  ok('  en er is geen bod uitgebracht', db.offers.length === 0);
}

// --- 3. Te duur MET ondergrens → bieden ---------------------------------
console.log('\nTe duur, maar met een "bieden vanaf": de bot biedt');
{
  const probe = world({ price: 1, minBid: null });
  const v = waarde(probe.db, 'koopje');
  const prijs = Math.round(v * 3);
  const grens = Math.round(v * 0.7);
  const { db } = world({ price: prijs, minBid: grens });
  runBot(db);

  ok('de duif is nog niet verkocht', db.pigeons.find((p) => p.id === 'koopje')!.ownerId === 'speler');
  const bod = db.offers.find((o) => o.pigeonId === 'koopje');
  ok('er staat een bod van de bot', !!bod && bod.fromUserId === 'bot1');
  if (bod) {
    ok(`  het bod (€${bod.amount}) ligt op of boven de ondergrens €${grens}`, bod.amount >= grens);
    ok(`  en binnen de band rond de waarde (€${Math.round(v * BOT.bidMinFactor)}–€${Math.round(v * BOT.bidMaxFactor)})`,
      bod.amount >= Math.round(v * BOT.bidMinFactor) - 1 && bod.amount <= Math.round(v * BOT.bidMaxFactor) + 1);
    ok('  en onder de vraagprijs', bod.amount < prijs);
  }
  ok('de verkoper krijgt er een melding van',
    db.notifications.some((n) => n.userId === 'speler' && n.title.includes('Bod')));
}

// --- 4. Een hebzuchtige ondergrens weigert de bot ------------------------
console.log('\nEen ondergrens boven wat de duif waard is, negeert de bot');
{
  const probe = world({ price: 1, minBid: null });
  const v = waarde(probe.db, 'koopje');
  const { db } = world({ price: Math.round(v * 5), minBid: Math.round(v * 2) });
  runBot(db);
  ok('geen bod: de gevraagde ondergrens ligt boven de marktwaarde', db.offers.length === 0);
}

// --- 5. Geen geld → geen bod --------------------------------------------
console.log('\nZonder geld biedt de bot niet');
{
  const probe = world({ price: 1, minBid: null });
  const v = waarde(probe.db, 'koopje');
  const { db } = world({ price: Math.round(v * 3), minBid: Math.round(v * 0.7), botMoney: BOT.marketReserve });
  runBot(db);
  ok('geen bod met een lege kas', db.offers.length === 0);
}

// --- 6. Niet op elkaars duiven, en niet op een verse listing -------------
console.log('\nGrenzen');
{
  const probe = world({ price: 1, minBid: null });
  const v = waarde(probe.db, 'koopje');

  // Verse listing: spelers krijgen eerste keus.
  const vers = world({ price: Math.round(v * 3), minBid: Math.round(v * 0.7) });
  vers.db.pigeons.find((p) => p.id === 'koopje')!.listedAt = new Date(NOW - 3600000).toISOString();
  runBot(vers.db);
  ok('op een verse listing biedt de bot nog niet', vers.db.offers.length === 0);

  // Duif van een andere bot.
  const botvan = world({ price: Math.round(v * 3), minBid: Math.round(v * 0.7) });
  const p = botvan.db.pigeons.find((x) => x.id === 'koopje')!;
  p.ownerId = 'bot2';
  botvan.db.users.push({ id: 'bot2', username: 'b2', isBot: true } as never);
  botvan.db.lofts.push(loft('bot2', 'Botje 2', true, 10000));
  runBot(botvan.db);
  ok('op de duif van een andere bot biedt hij niet', botvan.db.offers.length === 0);
}

// --- 7. Niet twee keer op dezelfde duif, en niet eindeloos --------------
console.log('\nDe bot overspoelt geen verkoper');
{
  const probe = world({ price: 1, minBid: null });
  const v = waarde(probe.db, 'koopje');
  const { db } = world({ price: Math.round(v * 3), minBid: Math.round(v * 0.7) });
  runBot(db);
  const na1 = db.offers.length;
  runBot(db);
  ok('een tweede ronde legt er geen tweede bod bovenop', db.offers.length === na1, `${na1} → ${db.offers.length}`);
  ok(`  en er staan er nooit meer dan ${BOT.maxOpenBids} open`,
    db.offers.filter((o) => o.fromUserId === 'bot1').length <= BOT.maxOpenBids);
}

// --- 8. De band zelf ----------------------------------------------------
console.log('\nDe knoppen zelf');
{
  ok('bidMinFactor < bidMaxFactor', BOT.bidMinFactor < BOT.bidMaxFactor);
  ok('de biedband ligt onder de koopgrens (haggelen is goedkoper dan kopen)',
    BOT.bidMaxFactor < BOT.marketMaxOverpay, `${BOT.bidMaxFactor} vs ${BOT.marketMaxOverpay}`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
