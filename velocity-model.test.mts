/**
 * Wie bepaalt de snelheid van een duif?
 *
 * Het antwoord hoort te zijn: **snelheid** bepaalt hoe hard ze vliegt, **conditie
 * en energie** bepalen hoe lang ze dat tempo volhoudt. Ervaring hoorde daar niet
 * in thuis maar zat er wél in, als een vlakke bonus van tot +33%. Gemeten leverde
 * ze daardoor méér spreiding op dan snelheid zelf, en kon een duif met ervaring 0
 * simpelweg niet meedoen — hoe snel ze ook was.
 *
 * Die term is geschrapt. Wat overblijft is ervaring als **efficiëntie**: minder
 * energie per vlucht, sneller herstel, en een lage tank beter kunnen indelen. Dat
 * laatste raakt de snelheid nog wel, maar alleen bij een duif die al leeg staat —
 * een frisse duif heeft er niets aan.
 *
 * Deze test bewaakt precies dat onderscheid, want het is het soort ding dat bij een
 * volgende balansronde ongemerkt terugsluipt.
 *
 * Run: npx tsx velocity-model.test.mts
 */
import { generatePigeon } from './core/game/pigeon.js';
import { pigeonVelocity, velocityBreakdown } from './core/game/flight.js';
import type { Pigeon } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const WEEK = 100;
function bird(over: Partial<Pigeon> = {}): Pigeon {
  const p = generatePigeon({ ownerId: 'u', currentWeek: WEEK, quality: 0.5 });
  p.speed = 85; p.endurance = 85; p.orientation = 85;
  p.health = 90; p.form = 70; p.experience = 50;
  p.birthWeek = WEEK - 60; // volwassen, in haar piek
  return Object.assign(p, over);
}
const kmh = (p: Pigeon, d: number) => pigeonVelocity(p, d, WEEK, 1, 1) * 0.06;

// --- 1. Een frisse duif haalt NIETS uit ervaring -------------------------
console.log('\nErvaring raakt de snelheid van een frisse duif niet');
for (const dist of [150, 500, 1000]) {
  const groen = kmh(bird({ form: 100, experience: 0 }), dist);
  const oud = kmh(bird({ form: 100, experience: 100 }), dist);
  ok(Math.abs(oud - groen) < 0.05, `${dist} km, volle tank: ervaring 0 en 100 vliegen even hard (${groen.toFixed(1)} vs ${oud.toFixed(1)} km/u)`);
}

// --- 2. Op een lage tank helpt ze wel, en meer naarmate ze leger staat ----
console.log('\nOp een lage tank helpt ervaring wel (rantsoeneren)');
const gains = [100, 70, 40, 20].map((form) =>
  kmh(bird({ form, experience: 100 }), 500) - kmh(bird({ form, experience: 0 }), 500));
ok(gains[0] < 0.05, 'volle tank: geen winst');
ok(gains[1] > 1, `energie 70: winst (${gains[1].toFixed(1)} km/u)`);
ok(gains[3] > gains[2] && gains[2] > gains[1], 'hoe leger de tank, hoe groter de winst uit ervaring');
ok(gains[3] < 25, `en ze blijft begrensd (${gains[3].toFixed(1)} km/u op energie 20)`);

// --- 3. Snelheid en conditie wegen zwaarder dan ervaring -----------------
console.log('\nSnelheid en conditie zijn nu de scherpste onderscheiders');
for (const dist of [150, 500, 1000]) {
  const dSpeed = kmh(bird({ speed: 95 }), dist) - kmh(bird({ speed: 70 }), dist);
  const dEnd = kmh(bird({ endurance: 95 }), dist) - kmh(bird({ endurance: 70 }), dist);
  const dExp = kmh(bird({ experience: 100 }), dist) - kmh(bird({ experience: 0 }), dist);
  ok(
    Math.max(dSpeed, dEnd) > dExp,
    `${dist} km: snelheid ${dSpeed.toFixed(1)} / conditie ${dEnd.toFixed(1)} > ervaring ${dExp.toFixed(1)} km/u`,
  );
}
// Op een sprint hoort snelheid te domineren, op de fond conditie.
ok(
  kmh(bird({ speed: 95 }), 150) - kmh(bird({ speed: 70 }), 150) >
    kmh(bird({ endurance: 95 }), 150) - kmh(bird({ endurance: 70 }), 150),
  'op 150 km weegt snelheid zwaarder dan conditie',
);
ok(
  kmh(bird({ endurance: 95 }), 1000) - kmh(bird({ endurance: 70 }), 1000) >
    kmh(bird({ speed: 95 }), 1000) - kmh(bird({ speed: 70 }), 1000),
  'op 1000 km weegt conditie zwaarder dan snelheid',
);

// --- 4. Een snelle groentje verslaat een trage veteraan ------------------
console.log('\nDe snelste duif wint, niet de meest ervaren');
{
  const snelGroentje = bird({ speed: 92, endurance: 88, experience: 0, form: 90 });
  const trageVeteraan = bird({ speed: 74, endurance: 74, experience: 100, form: 90 });
  for (const dist of [150, 500, 1000]) {
    ok(kmh(snelGroentje, dist) > kmh(trageVeteraan, dist),
      `${dist} km: een snelle duif zonder ervaring klopt een trage routinier`);
  }
}

// --- 5. De admin-ontleding spiegelt de echte formule ---------------------
console.log('\nDe admin-vluchtanalyse blijft kloppen');
{
  const p = bird({ form: 55, experience: 80 });
  const b = velocityBreakdown(p, 500, WEEK, 1);
  const echt = pigeonVelocity(p, 500, WEEK, 1, 1);
  ok(Math.abs(b.velocityNoLuck - echt) < 0.5, `ontleding == echte snelheid (${b.velocityNoLuck} vs ${echt})`);
  ok(!('experienceFactor' in b), 'er is geen ervaringsfactor meer in de ontleding');
  ok(b.effectiveForm > p.form, `ervaring toont zich nog wel in de effectieve energie (${p.form} → ${b.effectiveForm})`);
  const kaal = velocityBreakdown(bird({ form: 55, experience: 0 }), 500, WEEK, 1);
  ok(kaal.effectiveForm === 55, 'zonder ervaring is de effectieve energie gewoon de tank');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
