/**
 * Seizoen 3, onderdeel 3: de coach kost per duif volgens haar algemene score, en
 * handmatig trainen geeft altijd precies +1.
 *
 * Bewaakt:
 *  - de schijven en hun grenzen (de ondergrens hoort bij de hogere schijf);
 *  - de dagafrekening telt per duif, ook met een mix van schijven;
 *  - de gratis starterscoach dekt de DUURSTE gecoachte duif;
 *  - een duif die over een grens stijgt, betaalt vanaf dan het hogere tarief;
 *  - trainen = exact +1, en nooit voorbij min(80, gen-cap).
 *
 * Run: npx tsx tests/coach-salary.test.mts
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Pigeon, User } from '../core/schema.js';
import { seedWorld, createLoftForUser, trainPigeon } from '../core/game/engine.js';
import { coachBill } from '../core/game/newcomer.js';
import { dailyRunningCostBreakdown } from '../core/game/economy.js';
import { talent } from '../core/game/pigeon.js';
import { coachSalaryFor, nextCoachBand } from '../core/config/gameConfig.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

console.log('\n1. De schijven');
const cases: [number, number][] = [
  [40, 80], [64.9, 80], [65, 100], [69.9, 100], [70, 140], [74.9, 140], [75, 180],
  [79.9, 180], [80, 220], [84.9, 220], [85, 300], [89.9, 300], [90, 400], [95, 400],
];
for (const [t, s] of cases) ok(coachSalaryFor(t) === s, `score ${t} → €${s}`);
ok(nextCoachBand(82)?.minTalent === 85 && nextCoachBand(82)?.salary === 300, 'score 82: volgende schijf vanaf 85 aan €300');
ok(nextCoachBand(92) === null, 'score 92: geen hogere schijf');

// A bird with an exact score: set the three racing attributes to the same value.
const withScore = (p: Pigeon, s: number) => { p.speed = s; p.endurance = s; p.orientation = s; return p; };

console.log('\n2. De dagafrekening, per duif');
const store = new MemoryStore(emptyDatabase());
seedWorld(store);
const u: User = { id: newId('usr'), username: 'coachtest', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
store.mutate((d) => d.users.push(u));
const loft = createLoftForUser(store, u, 'Coachhok');
const db = store.data;
const mine = db.pigeons.filter((p) => p.ownerId === u.id);
const [a, b, c] = [withScore(mine[0], 82), withScore(mine[1], 73), withScore(mine[2], 61)];
for (const p of [a, b, c]) p.coached = true;
ok(talent(a) === 82 && talent(b) === 73 && talent(c) === 61, 'drie duiven met score 82 / 73 / 61');

// The starter package runs for a newcomer: the free coach covers the dearest.
const now = Date.now();
const bill = coachBill(loft, [a, b, c], now);
const freeRow = bill.perPigeon.find((r) => r.free);
ok(!!freeRow && freeRow.pigeonId === a.id, 'de gratis starterscoach dekt de duurste duif (score 82, €220)');
ok(bill.total === 140 + 80, `met starterspakket: €${bill.total} (€140 + €80)`);

// Without the starter package: everything is paid.
const later = Date.parse(loft.newcomer!.startedAt) + 60 * 86400000;
const full = coachBill(loft, [a, b, c], later);
ok(full.total === 220 + 140 + 80, `zonder starterspakket: €${full.total} (€220 + €140 + €80)`);
const costs = dailyRunningCostBreakdown(loft, mine.length, full.total, 0);
ok(costs.coaches === 440, 'de dagbalans toont exact die som als coachkost');

withScore(b, 75);
ok(coachBill(loft, [a, b, c], later).total === 220 + 180 + 80, 'duif B stijgt naar 75 → vanaf nu €180 i.p.v. €140');

console.log('\n3. Trainen geeft altijd precies +1');
const t = mine[3];
t.speed = 60; t.form = 100; t.ailment = null; t.inInfirmary = false; t.trainedAt = {};
loft.money = 100000;
for (let i = 0; i < 1; i++) {
  const err = trainPigeon(store, u.id, t.id, 'speed');
  ok(err === null, 'de training lukt');
}
ok(t.speed === 61, `60 → ${t.speed}`);
const cap = mine[4];
cap.speed = 79.5; cap.form = 100; cap.ailment = null; cap.inInfirmary = false; cap.trainedAt = {};
cap.genes = { ...(cap.genes ?? { speed: 90, endurance: 90, orientation: 90 }), speed: 90 };
trainPigeon(store, u.id, cap.id, 'speed');
ok(cap.speed === 80, `79,5 → ${cap.speed} (afgekapt op 80)`);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
