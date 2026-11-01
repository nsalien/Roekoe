/**
 * Besmetting per ziekte: een zieke hokgenoot geeft haar EIGEN ziekte door, met
 * een eigen kans per ziekte (`DISEASES[].contagion` × `HEALTH.contagionPerSource`).
 *
 * Vroeger was elke ziekte even besmettelijk, en wie besmet raakte kreeg een
 * willekeurige ziekte (gewogen op haar vorm), niet die van de zieke duif. Deze
 * test bewaakt:
 *  - de volgorde die de eigenaar koos (Paramyxovirose het meest, Salmonellose het
 *    minst), en dat een ziekte met factor 1 exact de oude kans per bron houdt;
 *  - in `runHealthDay`: wie besmet raakt, krijgt de ziekte van de zieke hokgenoot,
 *    aan de verwachte kans; een duif in de ziekenboeg besmet niemand;
 *  - de melding zegt dat ze het opliep bij een zieke hokgenoot.
 *
 * Run (vanuit de repo-root): npx tsx tests/contagion.test.mts
 */
import { DISEASES, HEALTH, ILLNESS, diseaseSeverityWeights } from '../core/config/gameConfig.js';
import { contagionByDisease, diseaseContagion, runHealthDay } from '../core/game/health.js';
import { generatePigeon } from '../core/game/pigeon.js';
import { emptyDatabase } from '../core/schema.js';
import type { Ailment, Database, Pigeon } from '../core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const pct = (x: number) => `${(x * 100).toFixed(2)} %`;

const weeklyToDaily = (p: number) => 1 - Math.pow(1 - p, 1 / 7);
const ailmentOf = (name: string): Ailment => {
  const d = DISEASES.find((x) => x.name === name)!;
  return { kind: 'ziekte', name: d.name, severity: d.severity, description: d.description, sinceWeek: 0 };
};

console.log('\nElke ziekte heeft haar eigen besmettelijkheid (keuze van de eigenaar)');
{
  const order = ['Paramyxovirose', 'Ornithose', 'Het Geel', 'Coccidiose', 'Duivenpokken', 'Salmonellose (paratyfus)'];
  ok(order.length === DISEASES.length && order.every((n) => DISEASES.some((d) => d.name === n)), 'alle zes de ziektes hebben een factor');
  const f = order.map(diseaseContagion);
  ok(f.every((x, i) => i === 0 || x < f[i - 1]), `van meest naar minst besmettelijk: ${order.map((n, i) => `${n} ×${f[i]}`).join(' · ')}`);
  ok(diseaseContagion('Onbekend') === 1, 'een onbekende ziekte (oude data) rekent met ×1');

  const susc = 0.4;
  const chanceOf = (name: string) => contagionByDisease([ailmentOf(name)], susc)[0].chance;
  const old = weeklyToDaily(HEALTH.contagionPerSource) * susc;
  ok(Math.abs(chanceOf('Coccidiose') - old) < 1e-12, `Coccidiose (×1) houdt exact de oude kans per bron (${pct(old)} per dag)`);
  ok(chanceOf('Paramyxovirose') > chanceOf('Salmonellose (paratyfus)') * 2, 'Paramyxovirose slaat ruim dubbel zo vaak over als Salmonellose');

  const two = contagionByDisease([ailmentOf('Ornithose'), ailmentOf('Ornithose')], susc);
  const one = chanceOf('Ornithose');
  ok(two.length === 1 && Math.abs(two[0].chance - (1 - (1 - one) ** 2)) < 1e-12, 'twee hokgenoten met dezelfde ziekte = twee bronnen van die ziekte');
  const mixed = contagionByDisease([ailmentOf('Ornithose'), ailmentOf('Het Geel')], susc);
  ok(mixed.length === 2 && mixed.some((c) => c.disease.name === 'Het Geel'), 'twee verschillende ziektes gaan elk apart rond');
}

// --- Integratie: runHealthDay op een hok van 1 zieke + 7 gezonde duiven ---------

/** Seeded Math.random, so the measured rates are reproducible. */
function seed(s: number) {
  let a = s >>> 0;
  Math.random = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VORM = 60; // energie = gezondheid = 60 → conditie-score 60
const HEALTHY = 7;
const template: Pigeon[] = [];
for (let i = 0; i <= HEALTHY; i++) template.push(generatePigeon({ ownerId: 'u1', currentWeek: 100, trait: null }));

function day(sourceDisease: string | null, sourceInBoeg: boolean): { db: Database; healthy: Pigeon[] } {
  const db = emptyDatabase();
  db.lofts.push({ userId: 'u1', isBot: false, name: 'Testhok' } as any);
  const birds = template.map((p) => ({ ...p, ailment: null, inInfirmary: false, compartment: 0, form: VORM, health: VORM }) as Pigeon);
  if (sourceDisease) {
    birds[0].ailment = ailmentOf(sourceDisease);
    birds[0].inInfirmary = sourceInBoeg;
  }
  db.pigeons = birds;
  runHealthDay(db, 100);
  return { db, healthy: birds.slice(1) };
}

// What the formula promises for one healthy bird at VORM, with one source of `name`.
const frailty = Math.pow((100 - VORM) / 100, ILLNESS.curve);
const spont = weeklyToDaily(ILLNESS.floor + ILLNESS.max * frailty);
const susc = ILLNESS.contagionFloor + (1 - ILLNESS.contagionFloor) * frailty;
const w = diseaseSeverityWeights(VORM);
const spontShare = (name: string) => {
  const d = DISEASES.find((x) => x.name === name)!;
  return w[d.severity] / (w.licht + w.matig + w.ernstig) / DISEASES.filter((x) => x.severity === d.severity).length;
};
/** Share of the new cases with the source's disease, and that per bird per day. */
function expected(name: string): { share: number; rate: number } {
  const c = contagionByDisease([ailmentOf(name)], susc)[0].chance;
  const ill = 1 - (1 - c) * (1 - spont);
  const share = c / (c + spont) + (spont / (c + spont)) * spontShare(name);
  return { share, rate: ill * share };
}

const DAYS = 25000;
function measure(name: string, inBoeg: boolean) {
  seed(name.length * 7919 + (inBoeg ? 1 : 0));
  let cases = 0, same = 0, notedFromMate = 0, notedSame = 0;
  for (let i = 0; i < DAYS; i++) {
    const { db, healthy } = day(name, inBoeg);
    for (const p of healthy) {
      if (!p.ailment) continue;
      cases++;
      if (p.ailment.name === name) same++;
    }
    for (const n of db.notifications) {
      if (!n.title.includes('ziek geworden')) continue;
      if (n.body.includes('bij een zieke hokgenoot')) {
        notedFromMate++;
        if (n.body.includes(`Diagnose: ${name} `)) notedSame++;
      }
    }
  }
  return { cases, same, notedFromMate, notedSame, rate: same / (DAYS * HEALTHY) };
}

console.log(`\nIn het hok: wie besmet raakt, krijgt de ziekte van de zieke hokgenoot (${DAYS} dagen × ${HEALTHY} duiven, vorm ${VORM})`);
for (const name of ['Paramyxovirose', 'Salmonellose (paratyfus)', 'Het Geel']) {
  const m = measure(name, false);
  const exp = expected(name);
  ok(Math.abs(m.rate - exp.rate) / exp.rate < 0.08, `${name}: ${pct(m.rate)} per duif per dag krijgt het (verwacht ${pct(exp.rate)})`);
  const share = m.same / m.cases;
  ok(Math.abs(share - exp.share) < 0.04 && share > spontShare(name) + 0.2,
    `${name}: ${Math.round(share * 100)} % van de nieuwe zieken heeft de ziekte van de bron (verwacht ${Math.round(exp.share * 100)} %, zonder bron ${Math.round(spontShare(name) * 100)} %)`);
  ok(m.notedFromMate > 0 && m.notedFromMate === m.notedSame, `${name}: elke melding "bij een zieke hokgenoot" noemt die ziekte (${m.notedFromMate}×)`);
}
{
  const pmv = measure('Paramyxovirose', false).rate;
  const salm = measure('Salmonellose (paratyfus)', false).rate;
  ok(pmv > salm * 1.8, `Paramyxovirose gaat duidelijk vaker rond dan Salmonellose (${pct(pmv)} vs ${pct(salm)})`);
}

console.log('\nDe ziekenboeg breekt de ketting');
{
  const m = measure('Paramyxovirose', true);
  const onlySpont = spont * spontShare('Paramyxovirose');
  ok(m.notedFromMate === 0, 'een zieke duif in de ziekenboeg besmet niemand (geen enkele melding "hokgenoot")');
  ok(Math.abs(m.rate - onlySpont) / onlySpont < 0.25, `Paramyxovirose enkel nog spontaan: ${pct(m.rate)} (verwacht ${pct(onlySpont)})`);
}

console.log('\nZonder zieke hokgenoot verandert er niets');
{
  seed(42);
  let fromMate = 0, cases = 0;
  for (let i = 0; i < 5000; i++) {
    const { db, healthy } = day(null, false);
    cases += healthy.filter((p) => p.ailment).length;
    fromMate += db.notifications.filter((n) => n.body.includes('hokgenoot')).length;
  }
  const rate = cases / (5000 * HEALTHY);
  ok(fromMate === 0, 'geen melding over een hokgenoot');
  ok(Math.abs(rate - spont) / spont < 0.1, `spontane kans ongewijzigd: ${pct(rate)} per duif per dag (verwacht ${pct(spont)})`);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt`);
if (fail > 0) process.exit(1);
