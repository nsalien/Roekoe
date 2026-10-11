/**
 * Regressietest: een vaccin of kuur is ALTIJD iets voordeliger dan een duif die
 * effectief ziek wordt (wens van de eigenaar — "een investering in de duif").
 *
 * De prijs is per duif (VACCINE_PRICING, inrichting.vaccinePrice):
 *   prijs = share × kans dat ze die ziekte krijgt (op refVorm, met haar eigen
 *           bescherming) × protect × wat één geval kost (diseaseCaseCost).
 *
 * Wat deze test bewaakt:
 *  1. diseaseCaseCost is AFGELEID uit de echte zorgcode en mag een geval nooit
 *     duurder voorstellen dan het is: het ziekteverloop wordt dag per dag nagespeeld
 *     met tickHealing + applyDayOfCare + runHealthDay, met en zonder dokter.
 *  2. Het risico in de prijs is dat van runHealthDay (zelfde helper, nageteld).
 *  3. De prijs ligt onder de vermeden schade, schuift mee met de waarde van de duif,
 *     en zakt waar haar risico al lager is (apart hok, IJzeren gestel, hygiëne,
 *     dakventilatie bij ornithose).
 *  4. Vaccineren rekent exact de prijs aan die de duifpagina toont (GET /pigeons/:id →
 *     vaccinePrices), en "Hele hok" exact de offerte van GET /loft/vaccines.
 *  5. /state (gepolld door elke open tab) rekent géén prijzen uit.
 *
 * Dat het middel ook in een échte wedstrijdcontext meer opbrengt dan het kost
 * (opbrengst per start uit de racemotor) staat in tests/vaccine-economics.mts.
 *
 * Draai: npx tsx tests/vaccine-price.test.mts
 */
import { applyAilment, runHealthDay, tickHealing } from '../core/game/health.js';
import { applyDayOfCare } from '../core/game/economy.js';
import { diseaseCaseCost, vaccineAvoidedDamage, vaccinate, vaccinateLoft, vaccineLoftQuote, vaccineLoftQuotes, vaccinePrice, vaccinePrices } from '../core/game/inrichting.js';
import { spontaneousIllnessPerDay, diseaseShare } from '../core/game/hygiene.js';
import { MemoryStore } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import { createLoftForUser, seedWorld } from '../core/game/engine.js';
import { pigeonDTO } from '../core/presenters.js';
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

console.log('\n=== 3. De prijs: onder de vermeden schade, en per duif ===');
{
  const loft = { userId: 'u', isBot: false } as unknown as Loft;
  const db = { lofts: [loft], pigeons: [], trades: [], world: { currentWeek: WEEK } } as unknown as Database;
  const keys = Object.keys(VACCINES) as VaccineKey[];
  const cheap = bird('cheap', { speed: 62, endurance: 62, orientation: 62 });
  const star = bird('star', { speed: 84, endurance: 84, orientation: 84 });
  for (const k of keys) {
    const price = vaccinePrice(db, loft, star, k);
    const avoided = vaccineAvoidedDamage(db, loft, star, k);
    ok(price > 0 && price < avoided && price >= avoided * VACCINE_PRICING.share * 0.95,
      `${VACCINES[k].label}: €${price} voor een topduif, bespaart haar gemiddeld €${avoided.toFixed(2)}`);
  }
  ok(keys.every((k) => vaccinePrice(db, loft, star, k) > vaccinePrice(db, loft, cheap, k)), 'een topduif betaalt meer dan een gewone duif — voor elk middel');
  const apart = bird('apart', { speed: 84, endurance: 84, orientation: 84, compartment: true });
  ok(vaccinePrice(db, loft, apart, 'pmv') < vaccinePrice(db, loft, star, 'pmv') * 0.6, 'in een apart hok is ze al minder vatbaar: goedkoper');
  const sturdy = bird('sturdy', { speed: 84, endurance: 84, orientation: 84, trait: 'sturdy' } as Partial<Pigeon>);
  ok(vaccinePrice(db, loft, sturdy, 'pmv') < vaccinePrice(db, loft, star, 'pmv'), 'IJzeren gestel: goedkoper');
  const clean = { userId: 'u', isBot: false, equipment: { hygiene: 100 } } as unknown as Loft;
  ok(vaccinePrice(db, clean, star, 'pmv') < vaccinePrice(db, loft, star, 'pmv'), 'een proper hok (hygiëne 100): goedkoper');
  const vent = { userId: 'u', isBot: false, equipment: { ventilation: true } } as unknown as Loft;
  ok(vaccinePrice(db, vent, star, 'adem') < vaccinePrice(db, loft, star, 'adem') && vaccinePrice(db, vent, star, 'pmv') === vaccinePrice(db, loft, star, 'pmv'),
    'dakventilatie weert ornithose al af: de ademhalingskuur wordt goedkoper, PMV niet');
  ok(vaccinePrice(db, loft, star, 'pmv') >= 10 && Number.isInteger(vaccinePrice(db, loft, star, 'pmv')), 'vanaf €10 hele euro’s');
  ok(vaccinePrice(db, loft, cheap, 'adem') < 10 && Math.round(vaccinePrice(db, loft, cheap, 'adem') * 100) === vaccinePrice(db, loft, cheap, 'adem') * 100, 'daaronder in centen');
}

console.log('\n=== 4. Vaccineren rekent de prijs aan die getoond wordt ===');
{
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const user: User = { id: 'usr_vp', username: 'vp', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
  store.mutate((db) => db.users.push(user));
  createLoftForUser(store, user, 'Hok VP');
  const db = store.data;
  const loft = db.lofts.find((l) => l.userId === user.id)!;
  loft.money = 50000;
  const p = db.pigeons.find((x) => x.ownerId === user.id)!;
  const shown = vaccinePrices(db, loft, p).pokken; // wat GET /pigeons/:id meestuurt
  const before = loft.money;
  ok(vaccinate(store, user.id, p.id, 'pokken') === null && Math.abs(before - loft.money - shown) < 0.005,
    `de duifpagina toont €${shown}, er gaat precies dat af`);
  ok(Object.keys(vaccinePrices(db, loft, p)).length === Object.keys(VACCINES).length, 'een prijs voor elk middel');
  const quote = vaccineLoftQuote(db, loft, 'pmv');
  const listed = vaccineLoftQuotes(db, loft).pmv;
  const mid = loft.money;
  const res = vaccinateLoft(store, user.id, 'pmv');
  ok(res.error === null && res.count === quote.birds.length && Math.abs(mid - loft.money - quote.cost) < 0.005,
    `hele hok: de offerte (${quote.birds.length} duiven, €${quote.cost}) is precies wat er afgaat`);
  ok(listed.count === quote.birds.length && listed.cost === quote.cost, 'de Inrichting-pagina (GET /loft/vaccines) toont diezelfde offerte');
  ok(vaccineLoftQuote(db, loft, 'pmv').birds.length === 0, 'daarna staat er voor PMV niemand meer op de offerte');
}

console.log('\n=== 5. /state rekent geen prijzen uit ===');
{
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const user: User = { id: 'usr_st', username: 'st', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
  store.mutate((db) => db.users.push(user));
  createLoftForUser(store, user, 'Hok ST');
  const db = store.data;
  const p = db.pigeons.find((x) => x.ownerId === user.id)!;
  const care = pigeonDTO(db, p, user.id).care as Record<string, unknown> | null;
  ok(!!care && !('prices' in care), 'de eigen duif op /state draagt geen prijzen — die kosten CPU op de drukste route');
}

console.log(`\n${fail === 0 ? 'alles groen' : `${fail} ROOD`} (${pass} van ${pass + fail})`);
if (fail > 0) process.exit(1);
