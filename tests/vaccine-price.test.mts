/**
 * Regressietest: wat een vaccin of kuur een duif oplevert, tegenover haar vaste
 * prijs ("een vaccin is een vaccin, de prijs is de prijs"; de prijzen kiest de
 * eigenaar). De meetlat (VACCINE_PRICING): (gevallen die het middel voorkomt) ×
 * (wat één geval kost), op vluchtvorm refVorm. Een betere duif haalt meer uit
 * dezelfde prijs.
 *
 * Wat deze test bewaakt:
 *  1. diseaseCaseCost is AFGELEID uit de echte zorgcode en mag een geval nooit
 *     duurder voorstellen dan het is: het ziekteverloop wordt nagespeeld met
 *     tickHealing + applyDayOfCare (per kwartier / per middernacht), met en zonder dokter.
 *  2. Het risico is dat van runHealthDay (zelfde helper, nageteld).
 *  3. Elke prijs is een heel bedrag; een vaccin loont voor een goede wedstrijdduif
 *     (★80, ~€23.600). Per middel staat erbij vanaf welke duif het loont.
 *  4. Vaccineren rekent precies die prijs aan, ook voor het hele hok.
 *
 * Dat het middel ook in een échte wedstrijdcontext meer opbrengt dan het kost
 * (opbrengst per start uit de racemotor) staat in tests/vaccine-economics.mts.
 *
 * Draai: npx tsx tests/vaccine-price.test.mts
 */
import { applyAilment, runHealthDay, tickHealing } from '../core/game/health.js';
import { applyDayOfCare } from '../core/game/economy.js';
import { diseaseCaseCost, vaccineAvoidedDamage, vaccinate, vaccinateLoft } from '../core/game/inrichting.js';
import { spontaneousIllnessPerDay, diseaseShare } from '../core/game/hygiene.js';
import { MemoryStore } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import { createLoftForUser, seedWorld } from '../core/game/engine.js';
import { DISEASES, HEALTH, INFIRMARY, VACCINE_PRICING, VACCINES, type Severity, type VaccineKey } from '../core/config/gameConfig.js';
import type { Ailment, Database, Loft, Pigeon, User } from '../core/schema.js';

const WEEK = 400;
const DAY = 86400000;
let pass = 0, fail = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); }
};
const euro = (v: number) => `€${Math.round(v).toLocaleString('nl-BE')}`;

function bird(id: string, o: Partial<Pigeon> = {}): Pigeon {
  return {
    id, ownerId: 'u', name: id, sex: 'doffer', birthWeek: WEEK - 100,
    speed: 75, endurance: 75, orientation: 75, libido: 60, form: 80, health: 95, experience: 50,
    sireId: null, damId: null, forSale: false, price: null, createdAtWeek: WEEK - 100,
    ailment: null, inInfirmary: false, races: 20, everAiled: false, coached: false,
    ration: 'herstel', compartment: false, hungerDays: 0, restDays: 0,
    genes: { speed: 90, endurance: 90, orientation: 90 }, declineRate: 1, trait: null,
    ...o,
  } as unknown as Pigeon;
}

/**
 * One case followed with the real ticks: the same pieces diseaseCaseCost adds up
 * (care, missed energie as starts, death in the ziekenboeg), minus the ernstig
 * "trager nadien" constant, which needs the race engine (see vaccine-economics).
 */
function simulatedCase(severity: Severity, value: number, doctor: boolean, trials = 300): number {
  const tmpl = DISEASES.find((d) => d.severity === severity)!;
  const P = VACCINE_PRICING;
  let total = 0;
  for (let k = 0; k < trials; k++) {
    const t0 = Date.parse('2026-10-01T00:00:00Z');
    const p = bird('x', { form: 80 });
    const loft = {
      userId: 'u', isBot: true, stats: { cures: 0, curesSevere: 0 }, badges: [], doctors: doctor ? 1 : 0, physios: 0,
      medicatedFood: true, food: { normal: 0, premium: 0, libido: 0, herstel: 999 }, feedRation: 'herstel',
    } as unknown as Loft;
    const db = { lofts: [loft], pigeons: [p], notifications: [], breedingPairs: [], flights: [], world: { currentWeek: WEEK } } as unknown as Database;
    applyAilment(p, { kind: 'ziekte', name: tmpl.name, severity, description: '', sinceWeek: WEEK } as Ailment);
    p.inInfirmary = true;
    tickHealing(db, t0);
    // Production cadence: she falls ill at a midnight, heals per quarter hour
    // (tickHealing), and every later midnight she is still ill brings the day's
    // care bill, her feed and a death roll (runHealthDay).
    let hours = 0, survive = 1, nights = 0;
    while (p.ailment && hours < 60 * 24) {
      hours += 0.25;
      tickHealing(db, t0 + hours * 3600000);
      if (hours % 24 === 0 && p.ailment) {
        nights += 1;
        survive *= Math.pow(1 - HEALTH.ailmentMortalityInfirmary[severity], 1 / 7);
        applyDayOfCare(loft, [p], new Set(), new Set(doctor ? [p.id] : []));
      }
    }
    const care = nights * (INFIRMARY.medicatedFoodPerBird + (doctor ? INFIRMARY.doctorSalary : 0));
    // A healthy twin takes in energyPerDay on each of those nights; she took in
    // what her tank shows above where she started (80), after the onset hit.
    const energyMissed = nights * P.energyPerDay - (p.form - 80);
    total += care + value * ((1 - survive) + (energyMissed / P.energyPerStart) * P.startValueShare);
  }
  return total / trials;
}

console.log('\n=== 1. De kost van één geval klopt met het echte ziekteverloop ===');
{
  for (const severity of ['licht', 'matig', 'ernstig'] as Severity[]) {
    for (const value of [3000, 12000, 35000]) {
      const model = diseaseCaseCost(severity, value) - value * VACCINE_PRICING.slowStarts[severity] * VACCINE_PRICING.startValueShare;
      const sim = Math.min(simulatedCase(severity, value, true), simulatedCase(severity, value, false));
      ok(model <= sim * 1.01 && model >= sim * 0.8,
        `${severity}, duif van ${euro(value)}: model ${euro(model)} · nagespeeld ${euro(sim)} (nooit duurder, hooguit 20 % voorzichtiger)`);
    }
  }
  ok(diseaseCaseCost('ernstig', 20000) > diseaseCaseCost('matig', 20000) && diseaseCaseCost('matig', 20000) > diseaseCaseCost('licht', 20000),
    'ernstig > matig > licht');
  ok(diseaseCaseCost('matig', 30000) > diseaseCaseCost('matig', 5000), 'een duurdere duif: een duurder geval');
}

console.log('\n=== 2. Het risico in de prijs is dat van runHealthDay ===');
{
  const vorm = VACCINE_PRICING.refVorm;
  const birds: Pigeon[] = [];
  const lofts: Loft[] = [];
  for (let l = 0; l < 100; l++) {
    lofts.push({ userId: `u${l}`, isBot: true, stats: {}, doctors: 0, physios: 0 } as unknown as Loft);
    for (let i = 0; i < 30; i++) birds.push(bird(`p${l}_${i}`, { ownerId: `u${l}`, form: vorm, health: vorm }));
  }
  const db = { lofts, pigeons: birds, notifications: [], breedingPairs: [], flights: [], world: { currentWeek: WEEK } } as unknown as Database;
  const counts: Record<string, number> = {};
  const days = 60;
  for (let d = 0; d < days; d++) {
    for (const p of birds) { p.ailment = null; p.form = vorm; p.health = vorm; }
    runHealthDay(db, WEEK, Date.now() + d * DAY);
    for (const p of birds) if (p.ailment) counts[p.ailment.name] = (counts[p.ailment.name] ?? 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) / (birds.length * days);
  const formula = spontaneousIllnessPerDay(vorm);
  ok(Math.abs(total / formula - 1) < 0.12, `ziek per duif per dag op vorm ${vorm}: geteld ${(total * 1000).toFixed(2)}‰, formule ${(formula * 1000).toFixed(2)}‰`);
  const geel = (counts['Het Geel'] ?? 0) / (birds.length * days);
  ok(Math.abs(geel / (formula * diseaseShare('Het Geel', vorm)) - 1) < 0.15, 'het aandeel per ziekte klopt ook (Het Geel)');
  ok(Math.abs(DISEASES.reduce((s, d) => s + diseaseShare(d.name, vorm), 0) - 1) < 1e-9, 'de aandelen tellen op tot 1');
}

console.log('\n=== 3. Eén vaste prijs per middel, in hele euro\'s ===');
{
  for (const k of Object.keys(VACCINES) as VaccineKey[]) {
    const v = VACCINES[k];
    const common = vaccineAvoidedDamage(k, 5000);
    const good = vaccineAvoidedDamage(k, 23600);
    const top = vaccineAvoidedDamage(k, 37000);
    // From which bird value it pays off (break-even).
    let lo = 0, hi = 2000000;
    for (let i = 0; i < 70; i++) { const mid = (lo + hi) / 2; if (vaccineAvoidedDamage(k, mid) >= v.price) hi = mid; else lo = mid; }
    const from = hi >= 1999999 ? 'nooit' : euro(hi);
    ok(Number.isInteger(v.price) && v.price > 0,
      `${v.label} €${v.price}: haalt ×${(common / v.price).toFixed(2)} (★70) · ×${(good / v.price).toFixed(2)} (★80) · ×${(top / v.price).toFixed(2)} (topduif) — loont vanaf ${from}`);
    if (v.kind === 'vaccin') ok(good >= v.price, `${v.label}: loont voor een goede wedstrijdduif (★80)`);
  }
  const weak = (Object.keys(VACCINES) as VaccineKey[]).map((k) => (vaccineAvoidedDamage(k, 2000) / VACCINES[k].price).toFixed(2));
  console.log(`  (ter info: een zwakke duif van €2.000 haalt er ×${weak.join(' / ×')} uit — voor haar loont het niet altijd)`);
  ok(vaccineAvoidedDamage('pmv', 20000) > vaccineAvoidedDamage('pmv', 5000), 'hoe meer je duif waard is, hoe meer hetzelfde middel oplevert');
}

console.log('\n=== 4. Vaccineren rekent de vaste prijs aan — voor elke duif dezelfde ===');
{
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const user: User = { id: 'usr_vp', username: 'vp', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
  store.mutate((db) => db.users.push(user));
  createLoftForUser(store, user, 'Hok VP');
  const db = store.data;
  const loft = db.lofts.find((l) => l.userId === user.id)!;
  loft.money = 50000;
  const [a, b] = db.pigeons.filter((x) => x.ownerId === user.id);
  b.speed = b.endurance = b.orientation = 88; // a much better bird: same price
  let before = loft.money;
  vaccinate(store, user.id, a.id, 'pokken');
  const paidA = before - loft.money;
  before = loft.money;
  vaccinate(store, user.id, b.id, 'pokken');
  const paidB = before - loft.money;
  ok(paidA === VACCINES.pokken.price && paidB === VACCINES.pokken.price, `pokken: €${paidA} en €${paidB} — de prijs is de prijs`);
  const home = db.pigeons.filter((x) => x.ownerId === user.id).length;
  before = loft.money;
  const res = vaccinateLoft(store, user.id, 'geel');
  ok(res.error === null && res.count === home && Math.abs(before - loft.money - home * VACCINES.geel.price) < 0.005,
    `hele hok: ${home} × €${VACCINES.geel.price}`);
}

console.log(`\n${fail === 0 ? 'alles groen' : `${fail} ROOD`} (${pass} van ${pass + fail})`);
if (fail > 0) process.exit(1);
