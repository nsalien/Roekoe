/**
 * Regressietest: een duidelijk BETERE duif wint ook duidelijk vaker.
 *
 * Waarom deze test bestaat. De eigenaar meldde dat "HEEL goeie duiven te vaak
 * (meer wel dan niet) slecht presteren". Nagemeten met de échte engine, op een
 * concreet geval uit zijn eigen hok — een duif die op élke as beter is
 * (snelheid +16, conditie +15, energie +13, ervaring +72) tegen zeven identieke
 * zwakkere duiven op 166 km:
 *
 *     vóór:  wint 33,1%  ·  top-3 64,3%  ·  LAATSTE 4,2%   (1 op 24)
 *
 * De oorzaak zat niet in de eigenschappen maar in `FLIGHT_DYNAMICS`: ±17%
 * dagvorm plus 16% kans op een offday van nog eens −14…−36% overstemde een
 * kwaliteitsverschil van 15%. En omdat die trekking ÉÉN keer per duif per vlucht
 * gebeurt, verliest ze op een slechte dag al haar duels tegelijk — wat als een
 * kapotte simulatie leest in plaats van als pech.
 *
 * Deze test bewaakt beide kanten van die knop:
 *  - kwaliteit moet lonen (anders is trainen en coachen weggegooid geld);
 *  - maar een verrassing moet mogelijk blijven (anders is de uitslag een tabel
 *    en hoef je de vlucht niet te volgen).
 *
 * ⚠️ Draai hem na ELKE wijziging aan `FLIGHT_DYNAMICS`, `SUSTAIN` of
 * `DISTANCE_WEIGHTING`.
 *
 * Draai: npx tsx tests/upset-balance.test.mts
 */
import { startLiveFlight, finalizeFlight, type Entry } from '../core/game/flight.js';
import type { Flight, Pigeon } from '../core/schema.js';

const WEEK = 400;
const RACES = Number(process.env.RACES ?? 4000);

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
};

interface Stats { speed: number; endurance: number; orientation: number; form: number; health: number; experience: number }
const mk = (id: string, o: Stats): Pigeon => ({
  id, ownerId: `o_${id}`, name: id, sex: 'doffer', birthWeek: WEEK - 60,
  speed: o.speed, endurance: o.endurance, orientation: o.orientation,
  libido: 60, form: o.form, health: o.health, experience: o.experience,
  sireId: null, damId: null, forSale: false, price: null,
  createdAtWeek: WEEK - 60, ailment: null, inInfirmary: false, races: 20,
  everAiled: false, coached: false, ration: 'normal', compartment: false,
  hungerDays: 0, restDays: 0,
  genes: { speed: 95, endurance: 95, orientation: 95 }, declineRate: 1,
} as unknown as Pigeon);

const lcg = (seed: number) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

/** Het gemelde geval: de sterke duif van de eigenaar tegen zeven zwakke. */
const STRONG: Stats = { speed: 84, endurance: 83, orientation: 65, form: 91, health: 100, experience: 93 };
const WEAK: Stats = { speed: 68, endurance: 68, orientation: 73, form: 78, health: 100, experience: 21 };

function field(km: number, strong: Stats, weak: Stats, weakCount: number) {
  const rnd = lcg(20260918);
  const hist = new Array(weakCount + 2).fill(0);
  let dnf = 0, last = 0;
  for (let i = 0; i < RACES; i++) {
    const ps = [mk('S', strong), ...Array.from({ length: weakCount }, (_, k) => mk(`w${k}`, weak))];
    const entries: Entry[] = ps.map((p) => ({ pigeon: p, ownerName: p.ownerId }));
    const f = {
      id: `up_${km}_${i}`, name: 'u', type: 'regional',
      fromCity: 'A', toCity: 'B', distanceKm: km,
      startAt: new Date().toISOString(), status: 'scheduled', entries: [], results: [], sim: [],
    } as unknown as Flight;
    f.entries = entries.map((e) => ({ pigeonId: e.pigeon.id, ownerId: e.pigeon.ownerId })) as never;
    startLiveFlight(f, entries, WEEK, { label: 't', factor: 0.78 + rnd() * 0.34 } as never);
    finalizeFlight(f, ps);
    const res = f.results as { pigeonId: string; rank: number; finished: boolean }[];
    const rs = res.find((x) => x.pigeonId === 'S')!;
    if (!rs.finished) { dnf++; continue; }
    hist[rs.rank]++;
    if (res.filter((x) => x.pigeonId !== 'S' && x.finished && x.rank < rs.rank).length === weakCount) last++;
  }
  return {
    win: hist[1] / RACES,
    top3: (hist[1] + hist[2] + hist[3]) / RACES,
    last: last / RACES,
    dnf: dnf / RACES,
  };
}

console.log(`Een duidelijk betere duif tegen 7 zwakkere, 166 km, ${RACES} races.\n`);
const m = field(166, STRONG, WEAK, 7);
console.log(`  wint ${(m.win * 100).toFixed(1)}%  ·  top-3 ${(m.top3 * 100).toFixed(1)}%  ·  laatste ${(m.last * 100).toFixed(2)}%  ·  DNF ${(m.dnf * 100).toFixed(1)}%`);
console.log('  (vóór de herijking: wint 33,1% · top-3 64,3% · laatste 4,16%)\n');

// --- Kwaliteit moet lonen --------------------------------------------------
ok('de betere duif wint vaker dan niet van elk van de zeven afzonderlijk',
  m.win > 0.45, `${(m.win * 100).toFixed(1)}% zeges`);
ok('ze staat zelden buiten het podium', m.top3 > 0.75, `top-3 ${(m.top3 * 100).toFixed(1)}%`);
// ⚠️ Dit is het cijfer waar de klacht over ging. Op 4,2% overkwam het de eigenaar
// om de 24 vluchten, wat leest als een defecte simulatie in plaats van als pech.
ok('ze wordt zelden laatste van het hele veld (< 1,5%)',
  m.last < 0.015, `${(m.last * 100).toFixed(2)}%`);

// --- Maar een verrassing blijft mogelijk -----------------------------------
/*
 * ⚠️ NET ZO BELANGRIJK als de drie hierboven. Zonder ondergrens is de verleiding
 * groot om `dayNoise` en de offday-staart gewoon naar nul te draaien zodra er
 * weer een klacht over pech komt — en dan is de uitslag een sorteertabel, hoef je
 * geen enkele vlucht meer te volgen en is het live-bord zinloos. De beste duif
 * hoort het WAARSCHIJNLIJKST te winnen, niet zeker.
 */
ok('een zwakkere duif kan de topper nog steeds kloppen (geen sorteertabel)',
  m.win < 0.80, `${(m.win * 100).toFixed(1)}% zeges`);
ok('de topper valt geregeld nog buiten het podium', m.top3 < 0.95,
  `top-3 ${(m.top3 * 100).toFixed(1)}%`);

// --- Een klein verschil hoort klein te blijven -----------------------------
/*
 * De keerzijde van minder toeval: als je de spreiding te ver dichtdraait, wint de
 * duif met één punt meer óók bijna altijd, en dan is elke vlucht beslist voor ze
 * begint. Twee bijna gelijke duiven moeten dicht bij een muntworp blijven.
 */
console.log('');
const NEAR_A: Stats = { speed: 75, endurance: 75, orientation: 75, form: 85, health: 95, experience: 55 };
const NEAR_B: Stats = { ...NEAR_A, speed: 78, endurance: 78 };
const n = field(166, NEAR_B, NEAR_A, 7);
console.log(`  drie punten beter tegen 7 gelijken: wint ${(n.win * 100).toFixed(1)}% (een gelijk veld geeft 12,5%)`);
ok('een klein verschil geeft een klein voordeel, geen zekerheid',
  n.win > 0.13 && n.win < 0.40, `${(n.win * 100).toFixed(1)}%`);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
