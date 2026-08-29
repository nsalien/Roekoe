/**
 * Bots op de spelersmarkt, en hoe ze trainen.
 *
 * Gemeten over acht weken: bots coachten al aan hun plafond en trainden, maar hun
 * kas liep op tot €19.000–46.000 en bleef daar liggen. Een speler met dat geld
 * koopt een betere duif; nu doen zij dat ook.
 *
 * Wat hier bewaakt wordt, in volgorde van hoe erg het is als het stukgaat:
 *  1. **De prijsgrens.** Een speler bepaalt zélf zijn vraagprijs. Zonder plafond
 *     zet iemand zijn slechtste duif op €40.000 en leegt daarmee elke bot in de
 *     club — een geldpers, geen markt. Dit is de belangrijkste test in dit bestand.
 *  2. bots kopen enkel van échte spelers, nooit van elkaar;
 *  3. ze kopen een échte verbetering, en maken plaats door hun slechtste los te
 *     laten als het hok vol zit;
 *  4. ze gaan nooit onder hun kasvloer;
 *  5. de verkoper wordt betaald, ziet het in zijn verkoopgeschiedenis en krijgt
 *     er een melding van;
 *  6. trainen volgt dezelfde weeklimiet per eigenschap als bij een speler.
 *
 * Run: npx tsx bot-market.test.mts
 */
import { MemoryStore, newId } from './core/store.js';
import { emptyDatabase } from './core/schema.js';
import { seedWorld, createLoftForUser, listForSale } from './core/game/engine.js';
import { botDailyActions } from './core/game/bots.js';
import { talent, trainCeil } from './core/game/pigeon.js';
import { valuePigeon } from './core/game/market.js';
import { BOT, TRAINING } from './core/config/gameConfig.js';
import type { Database, Loft, Pigeon, User } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const NOW = Date.parse('2026-09-10T00:00:00Z');

function world() {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const db = store.data;
  const u: User = { id: newId('usr'), username: 'speler', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(NOW).toISOString() };
  store.mutate((d) => d.users.push(u));
  const player = createLoftForUser(store, u, 'Het Hok van de Speler');
  const bot = db.lofts.find((l) => l.isBot)!;
  const owned = (l: Loft) => db.pigeons.filter((p) => p.ownerId === l.userId);
  return { store, db, player, bot, owned };
}

/** Zet één duif van de speler te koop, met een prijs relatief aan haar waarde. */
function list(w: ReturnType<typeof world>, pick: Pigeon, factor = 1): number {
  const price = Math.round(valuePigeon(w.db, pick, w.db.world.currentWeek).value * factor);
  const err = listForSale(w.store, w.player.userId, pick.id, price);
  if (err) throw new Error(`te koop zetten mislukte: ${err}`);
  return price;
}

/** Maak de bot rijk genoeg om te winkelen, en run één dag botgedrag. */
function botDay(w: ReturnType<typeof world>, money = 40000) {
  w.bot.money = money;
  botDailyActions(w.db, w.bot, w.owned(w.bot), NOW);
}

// ---------------------------------------------------------------------------
console.log('\n1. De prijsgrens — de belangrijkste regel van allemaal');
{
  const w = world();
  const best = w.owned(w.player).sort((a, b) => talent(b) - talent(a))[0];
  // Een absurde vraagprijs: precies de exploit die dit moet tegenhouden.
  const asked = list(w, best, 25);
  const before = w.bot.money;
  botDay(w, 200000); // geld zat — enkel de grens mag hem tegenhouden
  ok(best.ownerId === w.player.userId, `de bot laat een duif van €${asked} liggen (waarde ×25)`);
  ok(w.bot.money >= before - 5000, 'en heeft er dus geen fortuin aan uitgegeven');

  // Diezelfde duif aan een eerlijke prijs wordt wél gekocht.
  best.forSale = false; best.price = null;
  const fair = list(w, best, 1);
  botDay(w, 200000);
  ok(best.ownerId === w.bot.userId, `aan een eerlijke prijs (€${fair}) koopt hij haar wel`);
}

// ---------------------------------------------------------------------------
console.log('\n2. Enkel van echte spelers');
{
  const w = world();
  const otherBot = w.db.lofts.filter((l) => l.isBot)[1];
  const theirs = w.db.pigeons.filter((p) => p.ownerId === otherBot.userId)[0];
  theirs.forSale = true;
  theirs.price = 100; // spotgoedkoop, dus enkel de bot-check kan het tegenhouden
  botDay(w);
  ok(theirs.ownerId === otherBot.userId, 'een bot koopt niets van een andere bot');
}

// ---------------------------------------------------------------------------
console.log('\n3. Kopen met plaats over, en plaats maken als het hok vol zit');
{
  const w = world();
  const best = w.owned(w.player).sort((a, b) => talent(b) - talent(a))[0];
  best.speed = 90; best.endurance = 88; best.orientation = 86; // duidelijk beter dan wat dan ook
  list(w, best);
  // Een geseed bothok zit al vol (8/8), dus maak expliciet één plaats vrij.
  w.bot.capacity = w.owned(w.bot).length + 1;
  const roomBefore = w.bot.capacity - w.owned(w.bot).length;
  ok(roomBefore > 0, `de bot heeft ${roomBefore} plaats(en) vrij`);
  botDay(w);
  ok(best.ownerId === w.bot.userId, 'met plaats over koopt hij de betere duif');
  ok(w.owned(w.bot).some((p) => p.id === best.id), 'en ze staat in zijn hok');
}
{
  const w = world();
  // Vul het hok exact tot de rand.
  while (w.owned(w.bot).length < w.bot.capacity) {
    const clone = { ...w.owned(w.bot)[0], id: newId('pig'), name: `Vulduif ${w.db.pigeons.length}` };
    w.db.pigeons.push(clone as Pigeon);
  }
  const mine = w.owned(w.bot);
  const worst = mine.sort((a, b) => talent(a) - talent(b))[0];
  worst.speed = 20; worst.endurance = 20; worst.orientation = 20; // onmiskenbaar de slechtste
  const best = w.owned(w.player).sort((a, b) => talent(b) - talent(a))[0];
  best.speed = 90; best.endurance = 88; best.orientation = 86;
  list(w, best);
  // Op het platformplafond, zodat hij géén extra plaats kán bijkopen — anders
  // lost hij "vol hok" gewoon op door uit te breiden (wat op zich juist is).
  w.bot.capacity = BOT.maxCapacity;
  while (w.owned(w.bot).length < w.bot.capacity) {
    const clone = { ...w.owned(w.bot)[0], id: newId('pig'), name: `Vulduif ${w.db.pigeons.length}` };
    w.db.pigeons.push(clone as Pigeon);
  }
  const countBefore = w.owned(w.bot).length;
  ok(countBefore === w.bot.capacity, `het hok zit vol (${countBefore}/${w.bot.capacity})`);
  botDay(w);
  ok(best.ownerId === w.bot.userId, 'hij koopt de betere duif toch');
  ok(!w.db.pigeons.some((p) => p.id === worst.id), 'en liet zijn slechtste duif vrij om plaats te maken');
  ok(w.owned(w.bot).length <= w.bot.capacity, 'het hok blijft binnen zijn capaciteit');
}
{
  // Een duif die NIET beter is dan de slechtste, wordt niet gekocht.
  const w = world();
  for (const p of w.owned(w.bot)) { p.speed = 80; p.endurance = 80; p.orientation = 80; }
  // Mét plaats over: een duif die slechter is dan alles wat hij heeft, is nog
  // steeds geen aankoop — een lege stok is geen reden om rommel te kopen.
  w.bot.capacity = w.owned(w.bot).length + 2;
  const meh = w.owned(w.player)[0];
  meh.speed = 40; meh.endurance = 40; meh.orientation = 40;
  list(w, meh);
  botDay(w);
  ok(meh.ownerId === w.player.userId, 'zelfs met plaats over laat hij een zwakkere duif staan');
}

// ---------------------------------------------------------------------------
console.log('\n4. Nooit onder de kasvloer');
{
  const w = world();
  const best = w.owned(w.player).sort((a, b) => talent(b) - talent(a))[0];
  best.speed = 92; best.endurance = 90; best.orientation = 90;
  const price = list(w, best);
  botDay(w, BOT.marketReserve + Math.round(price / 2)); // net te weinig vrij
  ok(best.ownerId === w.player.userId, `met te weinig vrije kas koopt hij niet (vraagprijs €${price})`);
  ok(w.bot.money >= 0, 'en zijn kas blijft positief');
}

// ---------------------------------------------------------------------------
console.log('\n5. De verkoper merkt het');
{
  const w = world();
  const best = w.owned(w.player).sort((a, b) => talent(b) - talent(a))[0];
  best.speed = 90; best.endurance = 88; best.orientation = 86;
  const price = list(w, best);
  const cashBefore = w.player.money;
  const name = best.name;
  botDay(w);
  ok(best.ownerId === w.bot.userId, 'de bot koopt');
  ok(Math.round(w.player.money) === Math.round(cashBefore + price), `de speler kreeg €${price} uitbetaald`);
  ok(w.db.trades.some((t) => t.pigeonId === best.id && t.buyerId === w.bot.userId && t.price === price),
     'de verkoop staat in de verkoopgeschiedenis');
  ok(w.db.trades.find((t) => t.pigeonId === best.id)!.talent! > 0,
     'mét het talent erbij, zodat de marktwaardering ervan leert');
  ok(w.db.notifications.some((n) => n.userId === w.player.userId && n.body.includes(name)),
     'en de speler krijgt een melding dat zijn duif verkocht is');
  ok(w.player.stats.sells >= 1, 'zijn verkoopteller loopt op');
}

// ---------------------------------------------------------------------------
console.log('\n6. Trainen volgt dezelfde regels als bij een speler');
{
  const w = world();
  for (const p of w.owned(w.bot)) { p.form = 100; p.health = 100; p.speed = 50; p.endurance = 50; p.orientation = 50; }
  w.bot.money = 60000;
  const before = w.owned(w.bot).reduce((s, p) => s + p.speed + p.endurance + p.orientation, 0);
  botDailyActions(w.db, w.bot, w.owned(w.bot), NOW);
  const after = w.owned(w.bot).reduce((s, p) => s + p.speed + p.endurance + p.orientation, 0);
  ok(after > before, `er is effectief getraind (+${Math.round((after - before) * 10) / 10} punten op één dag)`);
  const trained = w.owned(w.bot).filter((p) => p.trainedAt && Object.keys(p.trainedAt).length > 0);
  ok(trained.length > 0 && trained.length <= BOT.trainPerDay, `${trained.length} duiven getraind (max ${BOT.trainPerDay}/dag)`);
  ok(trained.every((p) => Object.values(p.trainedAt!).every((t) => t)), 'elke training zet de weekteller — net als bij een speler');

  // Zelfde dag opnieuw: de weeklimiet per eigenschap moet bijten.
  const mid = w.owned(w.bot).reduce((s, p) => s + p.speed + p.endurance + p.orientation, 0);
  for (let i = 0; i < 20; i++) botDailyActions(w.db, w.bot, w.owned(w.bot), NOW);
  const capped = w.owned(w.bot).every((p) =>
    (['speed', 'endurance', 'orientation'] as const).every((a) => p[a] <= trainCeil(p, a)));
  ok(capped, 'geen enkele eigenschap gaat boven haar trainingsplafond');
  const grew = w.owned(w.bot).reduce((s, p) => s + p.speed + p.endurance + p.orientation, 0) - mid;
  ok(grew < w.owned(w.bot).length * 3 * TRAINING.attributeGain,
     `twintig extra beurten op dezelfde dag leveren niet elk een punt op (+${Math.round(grew * 10) / 10})`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
