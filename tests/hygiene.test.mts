/**
 * HOKINRICHTING (⚠️ dev, nog niet live): hokhygiëne, vers stro, de hokpoetser
 * en het nieuwe voer. Bewaakt de getallen uit het voorstel:
 *
 *   - meter 0–100; vers stro (€18 per 8 plaatsen) zet hem op 100;
 *   - boven 50 ziektekans ×(1 − 0,2·(h−50)/50), op of onder 50 géén effect;
 *   - −8 per dag in een vol hok (geschaald op bezetting), +50 % met een zieke
 *     duif buiten de ziekenboeg;
 *   - poetser €14/dag, ververst onder 70, besmetting ×0,85;
 *   - alle ziektefactoren samen nooit onder ×0,4;
 *   - niets kopen = het spel van vandaag (hok zonder `equipment` blijft onaangeroerd).
 * En het voer: Herstel enkel volledig de 2 dagen na een vlucht, Sport/Fond
 * goedkoper vliegen, Kweek de tweelingbonus, Senioren trager verouderen.
 *
 * Run: npx tsx tests/hygiene.test.mts   (vanuit de repo-root)
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Database, Pigeon, User } from '../core/schema.js';
import { createLoftForUser, seedWorld } from '../core/game/engine.js';
import { tickDailyCare } from '../core/game/schedule.js';
import { buyStraw, hygieneDecay, illnessChance, setCleaner, tickHygiene } from '../core/game/hygiene.js';
import { dailyRunningCostBreakdown, effectiveRation, inHerstelWindow } from '../core/game/economy.js';
import { expectedFlightEnergyCost, feedFlightEnergyMult } from '../core/game/flight.js';
import { runAgeDecline } from '../core/game/health.js';
import { AGING, FEED_RATIONS, HYGIENE, hygieneIllnessMult, strawCost } from '../core/config/gameConfig.js';

let fail = 0;
const ok = (c: boolean, m: string) => { if (c) console.log(`  ✓ ${m}`); else { fail++; console.log(`  ✗ ${m}`); } };
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

const DAY = 86400000;
const T0 = Date.parse(new Date().toISOString().slice(0, 10) + 'T04:00:00Z');

function world() {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const u: User = { id: newId('usr'), username: 'speler', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString() };
  store.mutate((d) => d.users.push(u));
  createLoftForUser(store, u, 'Hok Proef');
  const db = store.data;
  tickDailyCare(db, T0);
  return { store, db, userId: u.id, loft: db.lofts.find((l) => l.userId === u.id)! };
}

function rollDay(db: Database, now: number): number {
  const next = now + DAY;
  for (let i = 0; i < 40; i++) tickDailyCare(db, next);
  return next;
}

console.log('\n=== 1. De formules ===');
ok(hygieneIllnessMult(50) === 1 && hygieneIllnessMult(20) === 1 && hygieneIllnessMult(0) === 1, 'op of onder 50: ×1 (geen effect)');
ok(near(hygieneIllnessMult(100), 0.8), '100: ×0,8');
ok(near(hygieneIllnessMult(75), 0.9), '75: ×0,9');
ok(strawCost(8) === 18 && strawCost(12) === 36 && strawCost(16) === 36 && strawCost(20) === 54, 'stro: €18 per 8 plaatsen (8→18, 12→36, 20→54)');

console.log('\n=== 2. Het verval ===');
{
  const { db, loft, userId } = world();
  const birds = db.pigeons.filter((p) => p.ownerId === userId);
  loft.capacity = birds.length; // vol hok
  ok(near(hygieneDecay(loft, birds), 8), `vol hok: −8 per dag (kreeg ${hygieneDecay(loft, birds)})`);
  loft.capacity = birds.length * 2; // half vol
  ok(near(hygieneDecay(loft, birds), 4), 'half vol: −4 per dag');
  loft.capacity = birds.length;
  birds[0].ailment = { kind: 'ziekte', name: 'Test', severity: 'licht', description: '', sinceWeek: 1 } as any;
  ok(near(hygieneDecay(loft, birds), 12), 'zieke duif buiten de ziekenboeg: +50 % (12)');
  birds[0].inInfirmary = true;
  ok(near(hygieneDecay(loft, birds), 8), '…in de ziekenboeg telt ze niet mee');
  birds[0].ailment = { kind: 'kwetsuur', name: 'Test', severity: 'licht', description: '', sinceWeek: 1 } as any;
  birds[0].inInfirmary = false;
  ok(near(hygieneDecay(loft, birds), 8), 'een kwetsuur is niet besmettelijk: geen versnelling');
}

console.log('\n=== 3. Niets kopen = het spel van vandaag ===');
{
  const { db, loft, userId } = world();
  const money = loft.money;
  ok(loft.equipment === undefined, 'een nieuw hok heeft geen equipment');
  const bill = tickHygiene(loft, db.pigeons.filter((p) => p.ownerId === userId), T0);
  ok(bill === 0 && loft.equipment === undefined && loft.money === money, 'tickHygiene laat het hok volledig ongemoeid');
  const bot = db.lofts.find((l) => l.isBot)!;
  let now = T0;
  for (let d = 0; d < 3; d++) now = rollDay(db, now);
  ok(bot.equipment === undefined, 'na 3 dagen hebben de bots nog steeds geen equipment');
  ok(dailyRunningCostBreakdown(loft, 6, 0, 0).cleaner === 0, 'geen poetser in de Dagbalans');
}

console.log('\n=== 4. Stro, poetser en de Dagbalans ===');
{
  const { store, db, loft, userId } = world();
  const before = loft.money;
  ok(buyStraw(store, userId, T0) === null, 'stro kopen lukt');
  ok(loft.equipment?.hygiene === 100 && loft.money === before - strawCost(loft.capacity), `meter op 100, €${strawCost(loft.capacity)} betaald`);
  ok(setCleaner(store, userId, true) === null && loft.equipment?.cleaner === true, 'poetser aangenomen');
  const costs = dailyRunningCostBreakdown(loft, db.pigeons.filter((p) => p.ownerId === userId).length, 0, 0);
  ok(costs.cleaner === HYGIENE.cleanerDailyWage && costs.total >= costs.cleaner, 'poetser €14 in de Dagbalans en in het totaal');

  // De poetser ververst zodra de meter onder 70 zakt.
  const birds = db.pigeons.filter((p) => p.ownerId === userId);
  loft.capacity = birds.length;
  loft.equipment!.hygiene = 75;
  const m0 = loft.money;
  const bill = tickHygiene(loft, birds, T0 + DAY);
  ok(bill === strawCost(loft.capacity) && loft.equipment!.hygiene === 100 && loft.money === m0 - bill, '75 − 8 = 67 < 70 → vers stro, meter 100, baal betaald');
  loft.equipment!.hygiene = 90;
  ok(tickHygiene(loft, birds, T0 + 2 * DAY) === 0 && loft.equipment!.hygiene === 82, '90 − 8 = 82: niets te doen');

  // Een volle dag via tickDailyCare rekent loon én verval af.
  setCleaner(store, userId, false);
  loft.equipment!.hygiene = 100;
  const m1 = loft.money;
  const costsOff = dailyRunningCostBreakdown(loft, birds.length, 0, 0).total;
  rollDay(db, T0);
  ok(loft.equipment!.hygiene < 100, `de dagovergang laat de meter zakken (nu ${loft.equipment!.hygiene})`);
  ok(Math.abs((m1 - loft.money) - costsOff) < 60, 'zonder poetser geen loon (rest van de dag: gewone kosten)');
}

console.log('\n=== 5. Ziektekans en de bodem ×0,4 ===');
{
  const spontaneous = 0.01, fromOthers = 0.05;
  const base = Math.min(0.85, 1 - (1 - fromOthers) * (1 - spontaneous));
  const plain = illnessChance({ spontaneous, fromOthers, hygiene: 50, cleaner: false, compartmentMult: 1, traitMult: 1 });
  ok(near(plain, base), 'zonder iets: exact de oude kans');
  const clean = illnessChance({ spontaneous, fromOthers, hygiene: 100, cleaner: false, compartmentMult: 1, traitMult: 1 });
  ok(near(clean, base * 0.8), 'hygiëne 100: ×0,8');
  const cleaner = illnessChance({ spontaneous: 0, fromOthers, hygiene: 50, cleaner: true, compartmentMult: 1, traitMult: 1 });
  ok(near(cleaner, fromOthers * 0.85), 'poetser: besmetting ×0,85');
  const all = illnessChance({ spontaneous, fromOthers, hygiene: 100, cleaner: true, compartmentMult: 0.5, traitMult: 0.7 });
  ok(near(all, base * HYGIENE.illnessFactorFloor), `alles samen: nooit onder ×0,4 (kreeg ×${(all / base).toFixed(3)})`);
}

console.log('\n=== 6. Het voer ===');
{
  const { db, userId } = world();
  const p = db.pigeons.find((x) => x.ownerId === userId)! as Pigeon;
  const now = T0 + 10 * DAY;
  p.lastRaceAt = new Date(now - 20 * 3600000).toISOString();
  ok(inHerstelWindow(p, now) && effectiveRation('herstel', p, now).formRecovery === FEED_RATIONS.herstel.formRecovery, 'Herstel: vol effect daags na een vlucht');
  p.lastRaceAt = new Date(now - 47 * 3600000).toISOString();
  ok(inHerstelWindow(p, now), '…en nog op de tweede dag');
  p.lastRaceAt = new Date(now - 49 * 3600000).toISOString();
  const outside = effectiveRation('herstel', p, now);
  ok(!inHerstelWindow(p, now) && outside.formRecovery === FEED_RATIONS.normal.formRecovery && outside.healthRecovery === FEED_RATIONS.normal.healthRecovery, 'daarna: zoals Normaal');
  ok(outside.foodPerPigeon === FEED_RATIONS.herstel.foodPerPigeon && outside.pricePerKg === FEED_RATIONS.herstel.pricePerKg, '…maar ze eet en kost nog altijd Herstel');
  p.lastRaceAt = undefined as any;
  ok(!inHerstelWindow(p, now), 'nooit gevlogen: geen Herstel-effect');

  ok(feedFlightEnergyMult('sport', 150) === 0.96, 'Sport: −4 % op elke vlucht');
  ok(feedFlightEnergyMult('fond', 499) === 1 && feedFlightEnergyMult('fond', 500) === 0.92, 'Fond: −8 % vanaf 500 km');
  ok(feedFlightEnergyMult('normal', 800) === 1 && feedFlightEnergyMult('herstel', 800) === 1, 'ander voer: ×1');
  p.ration = 'normal';
  const e0 = expectedFlightEnergyCost(p, 600);
  p.ration = 'fond';
  ok(near(expectedFlightEnergyCost(p, 600), e0 * 0.92, 1e-6), 'de verwachte vluchtkost volgt het voer');

  // Senioren: ×0,85 veroudering.
  const a = { ...p, ration: 'normal', birthWeek: db.world.currentWeek - AGING.peakEndWeeks - 520, speed: 70, endurance: 70, orientation: 70, declineRate: 1 } as Pigeon;
  const b = { ...a, id: 'pig_b', ration: 'senior' } as Pigeon;
  const mini = { ...db, pigeons: [a, b] } as Database;
  runAgeDecline(mini, db.world.currentWeek);
  const lossA = 70 - a.speed, lossB = 70 - b.speed;
  ok(lossA > 0 && Math.abs(lossB - lossA * 0.85) <= 0.06, `Senioren verouderen ×0,85 (${lossA.toFixed(2)} → ${lossB.toFixed(2)})`);
}

console.log('\n=== 7. Bots kiezen een zinnig voer ===');
{
  const { db } = world();
  for (const l of db.lofts) if (l.isBot) l.money = 20000;
  let now = T0;
  for (let d = 0; d < 2; d++) now = rollDay(db, now);
  const botBirds = db.pigeons.filter((p) => db.lofts.find((l) => l.userId === p.ownerId)?.isBot);
  const rations = new Set(botBirds.map((p) => p.ration));
  ok(!rations.has('premium'), 'geen Premium (niet in hun keuzelijst)');
  ok(botBirds.every((p) => p.ration !== 'herstel' || inHerstelWindow(p, now)), 'Herstel enkel voor wie net vloog');
  const fed = botBirds.every((p) => {
    const l = db.lofts.find((x) => x.userId === p.ownerId)!;
    return (l.food[p.ration] ?? 0) > 0;
  });
  ok(fed, 'elke botduif heeft voorraad van haar eigen voer');
  ok(rations.has('sport'), `de meeste vliegen op Sport (gekozen: ${[...rations].join(', ')})`);
}

if (fail > 0) { console.log(`\n${fail} mislukt`); process.exitCode = 1; }
else console.log('\nalles groen');
