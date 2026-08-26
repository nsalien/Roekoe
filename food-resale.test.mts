/**
 * Feed can be sold back, but never at a profit.
 *
 * The resale rate is what keeps overbuying a real mistake and stops food being
 * used as a money store: a buy → sell round trip must always end with LESS money
 * than it started with, for every ration type and every quantity.
 *
 * Run: npx tsx food-resale.test.mts
 */
import { emptyDatabase } from './core/schema.js';
import { MemoryStore } from './core/store.js';
import { buyFood, createLoftForUser, foodResaleValue, sellFood } from './core/game/engine.js';
import { FEED_RATIONS, FOOD_RESALE_RATE, type FeedRationKey } from './core/config/gameConfig.js';
import type { User } from './core/schema.js';

let failures = 0;
const ok = (c: boolean, m: string) => { if (!c) failures++; console.log(`${c ? '  ✓' : '  ✗'} ${m}`); };

const USER: User = { id: 'usr_1', username: 'melker', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
const store = new MemoryStore(emptyDatabase());
store.mutate((d) => d.users.push(USER));
createLoftForUser(store, USER, 'Test');
const loft = () => store.data.lofts.find((l) => l.userId === USER.id)!;
loft().money = 100000;

const types = Object.keys(FEED_RATIONS) as FeedRationKey[];

console.log('\nEen rondje kopen → verkopen kost altijd geld');
for (const t of types) {
  for (const kg of [1, 7, 50, 250]) {
    const before = loft().money;
    ok(buyFood(store, USER.id, t, kg) === null, `${kg} kg ${FEED_RATIONS[t].label} gekocht`);
    ok(sellFood(store, USER.id, t, kg) === null, `  en weer verkocht`);
    const after = loft().money;
    ok(after < before, `  netto verlies van €${Math.round(before - after)} (nooit winst)`);
  }
}

console.log('\nDe prijs klopt met het tarief');
for (const t of types) {
  const expected = Math.round(100 * FEED_RATIONS[t].pricePerKg * FOOD_RESALE_RATE);
  ok(foodResaleValue(t, 100) === expected, `100 kg ${FEED_RATIONS[t].label} brengt €${expected} op`);
  ok(
    foodResaleValue(t, 100) < Math.round(100 * FEED_RATIONS[t].pricePerKg),
    `  en dat is minder dan de €${Math.round(100 * FEED_RATIONS[t].pricePerKg)} die het kostte`,
  );
}

console.log('\nJe kan niet verkopen wat je niet hebt');
store.mutate((d) => { d.lofts.find((l) => l.userId === USER.id)!.food = { normal: 5, premium: 0, libido: 0, herstel: 0 }; });
const moneyBefore = loft().money;
ok(sellFood(store, USER.id, 'normal', 5.1) !== null, 'meer dan de voorraad wordt geweigerd');
ok(sellFood(store, USER.id, 'premium', 1) !== null, 'een leeg voertype wordt geweigerd');
ok(sellFood(store, USER.id, 'normal', 0) !== null, '0 kg wordt geweigerd');
ok(sellFood(store, USER.id, 'normal', -10) !== null, 'een negatieve hoeveelheid wordt geweigerd');
ok(sellFood(store, USER.id, 'kaviaar', 1) !== null, 'een onbekend voertype wordt geweigerd');
ok(loft().money === moneyBefore, 'geen enkele geweigerde verkoop raakte de kassa');
ok(loft().food.normal === 5, 'en geen enkele raakte de voorraad');

console.log('\nAlles verkopen laat de voorraad op nul');
ok(sellFood(store, USER.id, 'normal', 5) === null, 'de hele voorraad verkopen mag');
ok(loft().food.normal === 0, 'voorraad staat op nul');
ok(loft().money === moneyBefore + foodResaleValue('normal', 5), 'de opbrengst klopt');

// round1: stock is kept at one decimal, so "sell everything" of a float stock
// must not trip over floating-point noise.
console.log('\nEen voorraad met decimalen');
store.mutate((d) => { d.lofts.find((l) => l.userId === USER.id)!.food.normal = 3.4; });
ok(sellFood(store, USER.id, 'normal', 3.4) === null, '3,4 kg volledig verkopen mag');
ok(loft().food.normal === 0, 'en laat niets achter');

console.log(failures === 0 ? '\n✅ Alles in orde\n' : `\n❌ ${failures} test(s) gefaald\n`);
process.exit(failures === 0 ? 0 : 1);
