/**
 * De live kaart moet de ECHTE geografie tonen.
 *
 * Een kaart die er plausibel uitziet maar een duif 40 km verkeerd zet, valt
 * niemand op — daarom rekent deze test de posities na tegen Haversine, met de
 * échte client-geodesie (client/src/components/geo.ts) en de échte engine
 * (offCourseKm in core/game/flight.ts).
 *
 * Draai: npx tsx flight-map.test.mts
 */
import { birdPoint, interpolate, destination, bearing } from './client/src/components/geo.js';
import { offCourseKm, strayPeakKm } from './core/game/flight.js';
import { haversineKm } from './core/game/util.js';
import { CITY_COORDS } from './core/config/gameConfig.js';
import type { SimEntry } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const BRUGGE = CITY_COORDS['Brugge']!;
const BARCELONA = CITY_COORDS['Barcelona']!;
const REIMS = CITY_COORDS['Reims'] ?? CITY_COORDS['Parijs'] ?? CITY_COORDS['Lille']!;

console.log('\nDe route klopt met de echte afstanden');
{
  const D = haversineKm(BARCELONA, BRUGGE);
  ok('Barcelona → Brugge is een echte fondafstand', D > 900 && D < 1200, `${Math.round(D)} km`);
  // Elke fractie langs de lijn moet exact die fractie van de afstand liggen.
  let worst = 0;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const p = interpolate(BARCELONA, BRUGGE, t);
    const flown = haversineKm(BARCELONA, p);
    worst = Math.max(worst, Math.abs(flown - t * D));
  }
  ok('een duif op x% van de route staat op x% van de afstand', worst < 1, `grootste afwijking ${worst.toFixed(2)} km`);

  const half = interpolate(BARCELONA, BRUGGE, 0.5);
  const a = haversineKm(BARCELONA, half);
  const b = haversineKm(half, BRUGGE);
  ok('het middelpunt ligt even ver van start als van aankomst', near(a, b, 0.5), `${a.toFixed(1)} vs ${b.toFixed(1)} km`);
  ok('halverwege ligt boven Frankrijk, niet in zee', half.lat > 43 && half.lat < 49 && half.lon > -1 && half.lon < 6,
    `${half.lat.toFixed(2)}, ${half.lon.toFixed(2)}`);
}

console.log('\nVerdwalen zet de duif ECHT naast de koers');
{
  const p0 = birdPoint(BARCELONA, BRUGGE, 0.5, 0);
  const onLine = interpolate(BARCELONA, BRUGGE, 0.5);
  ok('zonder omweg staat ze exact op de lijn', haversineKm(p0, onLine) < 0.01);

  for (const off of [12, 40, -25]) {
    const p = birdPoint(BARCELONA, BRUGGE, 0.5, off);
    const d = haversineKm(p, onLine);
    ok(`${off} km naast de lijn is ook echt ${Math.abs(off)} km`, near(d, Math.abs(off), 0.5), `${d.toFixed(2)} km`);
  }
  // Links en rechts moeten aan weerszijden liggen, niet toevallig dezelfde kant.
  const left = birdPoint(BARCELONA, BRUGGE, 0.5, 30);
  const right = birdPoint(BARCELONA, BRUGGE, 0.5, -30);
  ok('een positieve en negatieve afwijking liggen aan weerszijden',
    near(haversineKm(left, right), 60, 1));
  // Loodrecht: de afwijking mag de afgelegde afstand langs de route niet veranderen.
  const along = haversineKm(BARCELONA, onLine);
  const alongOff = haversineKm(BARCELONA, left);
  ok('de omweg staat loodrecht op de koers (Pythagoras klopt)',
    near(Math.hypot(along, 30), alongOff, 1.5), `${alongOff.toFixed(1)} vs ${Math.hypot(along, 30).toFixed(1)}`);

  const b1 = bearing(BARCELONA, BRUGGE);
  const back = destination(BARCELONA, b1, 100);
  ok('destination + bearing zijn elkaars omgekeerde', near(haversineKm(BARCELONA, back), 100, 0.1));
}

console.log('\nDe afwijking komt uit het bevroren sim, en klopt met de omweg');
{
  const sim = (strays: NonNullable<SimEntry['strays']>) =>
    ({ pigeonId: 'pig_test', strays } as unknown as SimEntry);

  // Zoals de engine ze bevriest: de piek is opgelost bij de lossing.
  const s = sim([{ atSeconds: 0, detourKm: 40, startKm: 300, spanKm: 100, peakKm: strayPeakKm(100, 40) }]);
  ok('vóór de stray-zone staat ze op de lijn', offCourseKm(s, 299) === 0);
  ok('ná de stray-zone staat ze weer op de lijn', offCourseKm(s, 401) === 0);
  ok('precies op de grens nog op de lijn', offCourseKm(s, 300) === 0 && offCourseKm(s, 400) === 0);
  const mid = offCourseKm(s, 350);
  ok('middenin wijkt ze af', Math.abs(mid) > 1, `${mid} km`);


  // Numeriek narekenen op de bol: loop de boog af en tel de echte km.
  const from = BARCELONA, to = BRUGGE;
  const D = haversineKm(from, to);
  const s2 = sim([{ atSeconds: 0, detourKm: 40, startKm: 0.3 * D, spanKm: 0.1 * D, peakKm: strayPeakKm(0.1 * D, 40) }]);
  let arc = 0;
  let prev = birdPoint(from, to, 0.3, offCourseKm(s2, 0.3 * D));
  for (let i = 1; i <= 400; i++) {
    const t = 0.3 + (0.1 * i) / 400;
    const p = birdPoint(from, to, t, offCourseKm(s2, t * D));
    arc += haversineKm(prev, p);
    prev = p;
  }
  const straight = 0.1 * D;
  ok('op de bol nagemeten klopt de extra afstand met de omweg uit het sim', near(arc - straight, 40, 2),
    `${(arc - straight).toFixed(1)} km extra tegenover 40 uit het sim`);

  // Determinisme: dezelfde duif wijkt altijd naar dezelfde kant af.
  const runs = new Set([offCourseKm(s, 350), offCourseKm(s, 350), offCourseKm(s, 350)]);
  ok('dezelfde duif wijkt altijd naar dezelfde kant af', runs.size === 1);
  const other = offCourseKm({ pigeonId: 'pig_ander', strays: s.strays } as unknown as SimEntry, 350);
  ok('een andere duif kan de andere kant op', Math.sign(other) !== 0);

  // Twee episodes op één vlucht.
  const two = sim([
    { atSeconds: 0, detourKm: 20, startKm: 100, spanKm: 60, peakKm: strayPeakKm(60, 20) },
    { atSeconds: 0, detourKm: 30, startKm: 400, spanKm: 80, peakKm: strayPeakKm(80, 30) },
  ]);
  ok('tussen twee episodes vliegt ze weer netjes op de lijn', two.strays && offCourseKm(two, 300) === 0);
  ok('in de eerste episode wijkt ze af', Math.abs(offCourseKm(two, 130)) > 1);
  ok('in de tweede episode ook', Math.abs(offCourseKm(two, 440)) > 1);

  // Legacy: een vlucht die bevroren werd vóór de kaart bestond.
  const legacy = sim([{ atSeconds: 1200, detourKm: 35 }]);
  ok('een oude vlucht zonder geometrie tekent GEEN verzonnen omweg', offCourseKm(legacy, 350) === 0);
  ok('een duif zonder strays staat gewoon op de lijn',
    offCourseKm({ pigeonId: 'p', strays: [] } as unknown as SimEntry, 350) === 0 &&
    offCourseKm({ pigeonId: 'p' } as unknown as SimEntry, 350) === 0);

  // De piek mag nooit ontsporen op een korte zone met een grote omweg.
  const spike = sim([{ atSeconds: 0, detourKm: 200, startKm: 10, spanKm: 20, peakKm: strayPeakKm(20, 200) }]);
  ok('een enorme omweg op een korte zone wordt afgetopt op de halve zone',
    Math.abs(offCourseKm(spike, 20)) <= 10 + 0.05, `${offCourseKm(spike, 20)} km`);
}

console.log('\nDe opgeloste piek klopt over het hele bereik');
{
  const arcOf = (span: number, h: number) => {
    let len = 0, prevX = 0, prevY = 0;
    for (let i = 1; i <= 2000; i++) {
      const x = (span * i) / 2000;
      const y = h * Math.sin((Math.PI * x) / span);
      len += Math.hypot(x - prevX, y - prevY);
      prevX = x; prevY = y;
    }
    return len;
  };
  let worst = 0;
  for (const span of [20, 45, 60, 110, 200]) {
    for (const detour of [3, 10, 25, 40]) {
      const h = strayPeakKm(span, detour);
      if (h >= span / 2 - 0.05) continue; // afgetopt, dan is korter dan gevraagd correct
      worst = Math.max(worst, Math.abs(arcOf(span, h) - span - detour));
    }
  }
  ok('elke combinatie van zone en omweg tekent de juiste extra afstand', worst < 0.5,
    `grootste afwijking ${worst.toFixed(2)} km`);
  ok('een omweg die niet in de zone past wordt afgetopt, niet opgeblazen',
    strayPeakKm(20, 500) === 10);
  ok('geen zone of geen omweg = geen bult', strayPeakKm(0, 40) === 0 && strayPeakKm(100, 0) === 0);
}

console.log(`\n${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
