/**
 * Regressietest: duiven vliegen als ZWERM, en verdwalen pas als ze alleen komen.
 *
 * Waarom deze test bestaat: duiven worden samen gelost en navigeren in groep —
 * de duiven die de weg kennen slepen de rest mee. Toch raakten er duiven van
 * koers in de eerste minuten, terwijl het hele konvooi dan nog als één wolk boven
 * de losplaats hangt. `FLOCK` onderdrukt een verdwaal-episode zolang het veld nog
 * bijeen zit, hoe zwak haar oriëntatie ook is.
 *
 * En: op een sprint is een omweg een kleinere hap van de route dan op de fond.
 * 10% van 120 km beslist de wedstrijd; 10% van 1000 km kost plaatsen.
 *
 * Draai: npx tsx flock.test.mts
 */
import { startLiveFlight } from './core/game/flight.js';
import { FLOCK, LOST } from './core/config/gameConfig.js';
import type { Flight, Pigeon, SimEntry } from './core/schema.js';

const WEEK = 400;
let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
};

const bird = (i: number, orientation: number): Pigeon => ({
  id: `p${i}`, ownerId: `o${i % 10}`, name: `p${i}`, sex: 'doffer', birthWeek: WEEK - 60,
  // Een REALISTISCH veld: de duiven verschillen, anders blijft de zwerm eeuwig samen.
  speed: 68 + (i % 11), endurance: 68 + (i % 9), orientation,
  libido: 60, form: 85, health: 92, experience: 50, sireId: null, damId: null,
  forSale: false, price: null, createdAtWeek: WEEK - 60, ailment: null, inInfirmary: false,
  races: 20, everAiled: false, coached: false, ration: 'normal', compartment: false,
  hungerDays: 0, restDays: 0, genes: { speed: 95, endurance: 95, orientation: 95 }, declineRate: 1,
} as unknown as Pigeon);

/** Alle verdwaal-episodes van een reeks vluchten, met hun plek op de route. */
function strays(distanceKm: number, orientation: number, birds: number, runs: number) {
  const eps: { u: number; detourKm: number }[] = [];
  let simmed = 0;
  for (let r = 0; r < runs; r++) {
    const entries = Array.from({ length: birds }, (_, i) => ({ pigeon: bird(i, orientation), ownerName: `hok${i % 10}` }));
    const f = {
      id: `flock_${distanceKm}_${orientation}_${birds}_${r}`, name: 't', type: 'national',
      fromCity: 'A', toCity: 'B', distanceKm, startAt: new Date().toISOString(),
      status: 'scheduled', entries: [], results: [], sim: [],
    } as unknown as Flight;
    startLiveFlight(f, entries as never, WEEK, { label: 't', factor: 1 } as never);
    for (const s of f.sim as SimEntry[]) {
      simmed++;
      for (const ep of s.strays ?? []) eps.push({ u: (ep.startKm ?? 0) / distanceKm, detourKm: ep.detourKm });
    }
  }
  return { eps, simmed };
}

const shareBefore = (eps: { u: number }[], u: number) => eps.filter((e) => e.u < u).length / Math.max(1, eps.length);

console.log('\nBij de lossing vliegt iedereen nog samen');
{
  // Een vol veld op een sprint: daar houdt de zwerm het langst bijeen.
  const short = strays(150, 65, 40, 30);
  ok('er wordt wel degelijk verdwaald (anders meet deze test niets)', short.eps.length > 40,
    `${short.eps.length} episodes over ${short.simmed} duiven`);
  ok('bijna niets in het eerste tiende van de route', shareBefore(short.eps, 0.1) < 0.06,
    `${(shareBefore(short.eps, 0.1) * 100).toFixed(1)}% (gelijk verdeeld zou ~10% zijn)`);
  ok('en weinig in het eerste vijfde', shareBefore(short.eps, 0.2) < 0.13,
    `${(shareBefore(short.eps, 0.2) * 100).toFixed(1)}% (gelijk verdeeld zou ~20% zijn)`);

  // Op de fond breekt het veld sneller open — dat hoort ook zo, maar de lossing
  // zelf moet ook daar rustig blijven.
  const fond = strays(900, 65, 40, 30);
  ok('ook op de fond is de lossing zelf rustig', shareBefore(fond.eps, 0.1) < 0.12,
    `${(shareBefore(fond.eps, 0.1) * 100).toFixed(1)}%`);
  ok('maar de fond breekt sneller open dan de sprint',
    shareBefore(fond.eps, 0.3) > shareBefore(short.eps, 0.3),
    `fond ${(shareBefore(fond.eps, 0.3) * 100).toFixed(0)}% vs sprint ${(shareBefore(short.eps, 0.3) * 100).toFixed(0)}%`);
}

console.log('\nHoe groter de groep, hoe beter de dekking');
{
  const solo = strays(500, 65, 1, 40);
  const paar = strays(500, 65, 4, 30);
  const veld = strays(500, 65, 40, 20);
  const soloEarly = shareBefore(solo.eps, 0.2);
  const paarEarly = shareBefore(paar.eps, 0.2);
  const veldEarly = shareBefore(veld.eps, 0.2);
  ok('een duif die alleen vliegt heeft geen dekking', soloEarly > 0.15,
    `${(soloEarly * 100).toFixed(0)}% in het eerste vijfde`);
  ok('een handvol duiven is nog geen zwerm', paarEarly > veldEarly,
    `4 duiven ${(paarEarly * 100).toFixed(0)}% vs 40 duiven ${(veldEarly * 100).toFixed(0)}%`);
  ok('een vol veld beschermt het meest', veldEarly < soloEarly,
    `${(veldEarly * 100).toFixed(0)}% vs solo ${(soloEarly * 100).toFixed(0)}%`);
  ok('FLOCK.fullBirds ligt boven minBirds, anders is de ramp zinloos', FLOCK.fullBirds > FLOCK.minBirds);
}

console.log('\nDe omweg schaalt met de afstand');
{
  const sprint = strays(120, 65, 40, 40);
  const fond = strays(1000, 65, 40, 20);
  const avg = (eps: { detourKm: number }[]) => eps.reduce((s, e) => s + e.detourKm, 0) / Math.max(1, eps.length);
  const frac = (eps: { detourKm: number }[], km: number) => avg(eps) / km;
  const worst = (eps: { detourKm: number }[]) => Math.max(0, ...eps.map((e) => e.detourKm));

  ok('een omweg op 120 km blijft klein in absolute km', avg(sprint.eps) < 8,
    `gemiddeld ${avg(sprint.eps).toFixed(1)} km`);
  ok('en ook als aandeel van de route kleiner dan op de fond',
    frac(sprint.eps, 120) < frac(fond.eps, 1000),
    `${(frac(sprint.eps, 120) * 100).toFixed(1)}% vs ${(frac(fond.eps, 1000) * 100).toFixed(1)}%`);
  ok('geen enkele sprint-omweg gaat over het korte plafond',
    worst(sprint.eps) <= 120 * LOST.maxDetourFractionShort + 1,
    `ergste ${worst(sprint.eps).toFixed(0)} km vs plafond ${(120 * LOST.maxDetourFractionShort).toFixed(0)} km`);
  ok('op de fond mag het wél oplopen', worst(fond.eps) > 40,
    `ergste ${worst(fond.eps).toFixed(0)} km`);
  ok('het korte plafond is strenger dan het lange', LOST.maxDetourFractionShort < LOST.maxDetourFractionLong);
  ok('de korte omweg-fractie is kleiner dan de lange', LOST.detourFractionShort < LOST.detourFractionLong);
}

console.log('\nOriëntatie blijft doen waarvoor ze dient');
{
  const goed = strays(700, 90, 40, 25);
  const zwak = strays(700, 60, 40, 25);
  const per = (r: { eps: unknown[]; simmed: number }) => r.eps.length / r.simmed;
  ok('een slechte navigator raakt veel vaker van koers dan een goede',
    per(zwak) > per(goed) * 2.5,
    `${per(zwak).toFixed(2)} vs ${per(goed).toFixed(2)} episodes per duif`);
  ok('maar een goede navigator is niet immuun', per(goed) > 0.05, `${per(goed).toFixed(2)} per duif`);
}

console.log(`\n${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
