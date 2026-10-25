/**
 * Seizoen 3, onderdeel 3: de coach kost per duif volgens haar algemene score, en
 * handmatig trainen geeft altijd precies +1. Sinds 25 okt (eigenaar) schaalt het
 * dagloon ook mee met ervaring en leeftijd: de score bepaalt de BASIS.
 *
 * Bewaakt:
 *  - de schijven en hun grenzen (de ondergrens hoort bij de hogere schijf);
 *  - de toeslag: +3 % per 10 ervaring (max 30 %), +10 % per duivenjaar (max 20 %),
 *    afgerond op €10 — en de vraag van de eigenaar: een oude, ervaren ★80 kost
 *    meer dan een pas geboren ★80;
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
import { COACH, coachSalaryFor, coachSalaryParts, nextCoachBand } from '../core/config/gameConfig.js';

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

console.log('\n1b. De toeslag voor ervaring en leeftijd');
{
  const fresh = coachSalaryParts(80, 0, 0);
  const veteran = coachSalaryParts(80, 90, 4 * 52);
  ok(fresh.salary === 220 && fresh.experiencePct === 0 && fresh.agePct === 0, 'een pas geboren ★80 zonder ervaring: de basis, €220');
  ok(veteran.salary === 320 && veteran.experiencePct === 27 && veteran.agePct === 20,
     `een ★80 van 4 jaar met ervaring 90: €${veteran.salary} (+${veteran.experiencePct} % +${veteran.agePct} %) — de vraag van de eigenaar`);
  ok(coachSalaryParts(80, 30, 52).salary === 260 && coachSalaryParts(80, 60, 104).salary === 300, 'de tussenstappen uit wiki en spelregels: €260 en €300');
  ok(coachSalaryParts(80, 100, 52).experiencePct === COACH.experienceSurcharge && coachSalaryParts(80, 0, 10 * 52).agePct === COACH.ageSurchargeMax,
     `de toeslagen stoppen op +${COACH.experienceSurcharge} % en +${COACH.ageSurchargeMax} %`);
  ok(coachSalaryParts(90, 100, 999).salary === 600, 'het duurste dagloon: ★90+, ervaring 100, 2+ jaar → €600');
  let mono = true, round10 = true;
  for (const t of [60, 70, 80, 90]) {
    let prev = 0;
    for (let e = 0; e <= 100; e += 10) for (let w = 0; w <= 260; w += 26) {
      const s = coachSalaryParts(t, e, w).salary;
      if (s % 10 !== 0) round10 = false;
      if (s < coachSalaryFor(t)) mono = false;
    }
    for (let e = 0; e <= 100; e += 5) { const s = coachSalaryParts(t, e, 104).salary; if (s < prev) mono = false; prev = s; }
  }
  ok(mono && round10, 'meer ervaring of leeftijd kost nooit minder dan de basis of dan minder ervaring, en alles op €10');
}

// A bird with an exact score: set the three racing attributes to the same value.
// Fresh and without ervaring, so these checks are about the score band alone.
const withScore = (p: Pigeon, s: number) => {
  p.speed = s; p.endurance = s; p.orientation = s; p.experience = 0; p.birthWeek = store.data.world.currentWeek;
  return p;
};

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
const WEEK = db.world.currentWeek;
const bill = coachBill(loft, [a, b, c], now, WEEK);
const freeRow = bill.perPigeon.find((r) => r.free);
ok(!!freeRow && freeRow.pigeonId === a.id, 'de gratis starterscoach dekt de duurste duif (score 82, €220)');
ok(bill.total === 140 + 80, `met starterspakket: €${bill.total} (€140 + €80)`);

// Without the starter package: everything is paid.
const later = Date.parse(loft.newcomer!.startedAt) + 60 * 86400000;
const full = coachBill(loft, [a, b, c], later, WEEK);
ok(full.total === 220 + 140 + 80, `zonder starterspakket: €${full.total} (€220 + €140 + €80)`);
const costs = dailyRunningCostBreakdown(loft, mine.length, full.total, 0);
ok(costs.coaches === 440, 'de dagbalans toont exact die som als coachkost');

withScore(b, 75);
ok(coachBill(loft, [a, b, c], later, WEEK).total === 220 + 180 + 80, 'duif B stijgt naar 75 → vanaf nu €180 i.p.v. €140');
a.experience = 90; a.birthWeek = WEEK - 4 * 52;
ok(coachBill(loft, [a, b, c], later, WEEK).total === 320 + 180 + 80, 'duif A, nu 4 jaar met ervaring 90 → €320 i.p.v. €220');

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
