/**
 * HOKINRICHTING (⚠️ dev, nog niet live): hokhygiëne, vers stro en de hokpoetser. Bewaakt de getallen uit het voorstel:
 *
 *   - meter 0–100; vers stro (€18 per 8 plaatsen) zet hem op 100;
 *   - boven 50 ziektekans ×(1 − 0,2·(h−50)/50), op of onder 50 géén effect;
 *   - −8 per dag in een vol hok (geschaald op bezetting), +50 % met een zieke
 *     duif buiten de ziekenboeg;
 *   - poetser €14/dag, ververst onder 70, besmetting ×0,85;
 *   - alle ziektefactoren samen nooit onder ×0,4;
 *   - niets kopen = het spel van vandaag (hok zonder `equipment` blijft onaangeroerd).
 *
 * Run: npx tsx tests/hygiene.test.mts   (vanuit de repo-root)
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Database, Pigeon, User } from '../core/schema.js';
import { createLoftForUser, seedWorld } from '../core/game/engine.js';
import { tickDailyCare } from '../core/game/schedule.js';
import { buyStraw, hygieneDecay, illnessChance, setCleaner, tickHygiene } from '../core/game/hygiene.js';
import { dailyRunningCostBreakdown } from '../core/game/economy.js';
import { HYGIENE, cleanerWage, hygieneIllnessMult, strawCost } from '../core/config/gameConfig.js';

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
  ok(dailyRunningCostBreakdown(loft, 6, 0, 0).equipment.length === 0, 'geen inrichting in de Dagbalans');
}

console.log('\n=== 4. Stro, poetser en de Dagbalans ===');
{
  const { store, db, loft, userId } = world();
  const before = loft.money;
  ok(buyStraw(store, userId, T0) === null, 'stro kopen lukt');
  ok(loft.equipment?.hygiene === 100 && loft.money === before - strawCost(loft.capacity), `meter op 100, €${strawCost(loft.capacity)} betaald`);
  ok(setCleaner(store, userId, true) === null && loft.equipment?.cleaner === true, 'poetser aangenomen');
  const count = db.pigeons.filter((p) => p.ownerId === userId).length;
  const costs = dailyRunningCostBreakdown(loft, count, 0, 0);
  const line = costs.equipment.find((l) => l.key === 'cleaner');
  ok(line?.amount === cleanerWage(count) && costs.total >= line.amount, `poetser €${cleanerWage(count)} (${count} duiven) in de Dagbalans en in het totaal`);
  ok(cleanerWage(10) === 14 && cleanerWage(20) === 24 && cleanerWage(8) === 12, 'hoe meer duiven, hoe duurder: 8 → €12, 10 → €14, 20 → €24');
  const big = dailyRunningCostBreakdown(loft, 20, 0, 0).equipment.find((l) => l.key === 'cleaner');
  ok(big?.amount === 24, 'een hok van 20 betaalt de poetser €24 per dag');

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

if (fail > 0) { console.log(`\n${fail} mislukt`); process.exitCode = 1; }
else console.log('\nalles groen');
