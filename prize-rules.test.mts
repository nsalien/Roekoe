/**
 * Regressietest op de twee uitbetalingsregels.
 *
 *  1. ELKE finisher verdient iets. De oude tabellen stopten na 8 of 10 plaatsen,
 *     dus in een veld van 20 vloog de achterhoede voor niets en verloor een zwak
 *     hok week na week zijn inschrijfgeld. De tabellen hebben nu banden en een
 *     bodem: wie thuis raakt, brengt altijd geld mee.
 *  2. Per hok worden hoogstens REWARD_BIRDS_PER_LOFT duiven beloond — geld ÉN
 *     seizoenspunten. Een vierde duif vliegt, staat in de uitslag en verbetert
 *     gewoon, maar krijgt niets. Dat geld schuift NIET door: de uitslag op het
 *     bord is de uitslag die gevlogen is.
 *
 * Draai: npx tsx prize-rules.test.mts
 */
import { startLiveFlight, finalizeFlight, computeFinishPayouts, flightPrizes, type Entry } from './core/game/flight.js';
import { PRIZE_MONEY, AGE_CUP, TITAN, REWARD_BIRDS_PER_LOFT, prizeForRank } from './core/config/gameConfig.js';
import type { Flight, Pigeon, SimEntry, FlightResult } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
};

const WEEK = 400;

// --- 1. De tabellen zelf --------------------------------------------------
console.log('\nDe prijzentabellen');
{
  const R = PRIZE_MONEY.regional, N = PRIZE_MONEY.national, I = PRIZE_MONEY.international;
  ok('regionaal 1e = €800 en 8e = €90', prizeForRank(R, 1) === 800 && prizeForRank(R, 8) === 90);
  ok('regionaal band 9–11 = €70', [9, 10, 11].every((r) => prizeForRank(R, r) === 70));
  ok('regionaal band 12–15 = €60', [12, 13, 14, 15].every((r) => prizeForRank(R, r) === 60));
  ok('regionaal 16 en verder = €40', [16, 25, 100].every((r) => prizeForRank(R, r) === 40));
  ok('nationaal band 11–13 = €80 en 14–17 = €70', [11, 12, 13].every((r) => prizeForRank(N, r) === 80) && [14, 15, 16, 17].every((r) => prizeForRank(N, r) === 70));
  ok('nationaal 18 en verder = €50', prizeForRank(N, 18) === 50 && prizeForRank(N, 60) === 50);
  ok('internationaal 9–11 = €140, 12–15 = €100, 16+ = €75',
    prizeForRank(I, 9) === 140 && prizeForRank(I, 12) === 100 && prizeForRank(I, 16) === 75);
  ok('criterium sprint 1e €1000, bodem €60', prizeForRank(AGE_CUP.sprint.prizes, 1) === 1000 && prizeForRank(AGE_CUP.sprint.prizes, 40) === 60);
  ok('criterium fond 1e €1600, bodem €90', prizeForRank(AGE_CUP.fond.prizes, 1) === 1600 && prizeForRank(AGE_CUP.fond.prizes, 40) === 90);

  // De kern van de wijziging: geen enkele plaats levert nog niets op.
  for (const [naam, t] of [['regionaal', R], ['nationaal', N], ['internationaal', I], ['sprint', AGE_CUP.sprint.prizes], ['fond', AGE_CUP.fond.prizes]] as const) {
    let minPrize = Infinity;
    for (let r = 1; r <= 60; r++) minPrize = Math.min(minPrize, prizeForRank(t, r));
    ok(`  ${naam}: élke plaats t/m 60 levert geld op (min €${minPrize})`, minPrize > 0);
  }
  // Monotoon: verder achteraan mag nooit méér opleveren.
  for (const [naam, t] of [['regionaal', R], ['nationaal', N], ['internationaal', I]] as const) {
    let mono = true;
    for (let r = 2; r <= 60; r++) if (prizeForRank(t, r) > prizeForRank(t, r - 1)) mono = false;
    ok(`  ${naam}: het bedrag daalt monotoon met de plaats`, mono);
  }
  ok('de titan houdt bewust 3 plaatsen en geen bodem',
    prizeForRank(TITAN.prizes, 3) === 900 && prizeForRank(TITAN.prizes, 4) === 0);
}

// --- Hulpjes voor een echte vlucht ---------------------------------------
const bird = (id: string, owner: string, q: number): Pigeon => ({
  id, ownerId: owner, name: id, sex: 'doffer', birthWeek: WEEK - 60,
  speed: q, endurance: q, orientation: q, libido: 60, form: 88, health: 92,
  experience: 55, sireId: null, damId: null, forSale: false, price: null,
  createdAtWeek: WEEK - 60, ailment: null, inInfirmary: false, races: 20,
  everAiled: false, coached: false, ration: 'normal', compartment: false,
  hungerDays: 0, restDays: 0, genes: { speed: 95, endurance: 95, orientation: 95 },
  declineRate: 1,
} as unknown as Pigeon);

function race(pigeons: Pigeon[], km = 300, id = 'flt_prize') {
  const f = {
    id, name: 'test', type: 'national', fromCity: 'A', toCity: 'B', distanceKm: km,
    startAt: new Date().toISOString(), status: 'scheduled',
    entries: pigeons.map((p) => ({ pigeonId: p.id, ownerId: p.ownerId })),
    results: [], sim: [], entryFee: 20,
  } as unknown as Flight;
  const es: Entry[] = pigeons.map((p) => ({ pigeon: p, ownerName: p.ownerId }));
  startLiveFlight(f, es, WEEK, { label: 't', factor: 1 } as never);
  return f;
}

// --- 2. Drie duiven per hok ----------------------------------------------
console.log('\nHoogstens drie beloonde duiven per hok');
{
  // Eén hok zet er 6 in, een tegenstander 2 — zo eindigt het grote hok gegarandeerd
  // met meer dan drie duiven in de uitslag.
  const pigeons = [
    ...Array.from({ length: 6 }, (_, i) => bird(`groot${i}`, 'groot', 88 - i)),
    ...Array.from({ length: 2 }, (_, i) => bird(`klein${i}`, 'klein', 70 - i)),
  ];
  const f = race(pigeons);
  const before = computeFinishPayouts(f);
  finalizeFlight(f, pigeons.map((p) => ({ ...p })) as Pigeon[]);
  const results = (f.results as FlightResult[]).slice().sort((a, b) => a.rank - b.rank);

  const grootFinishers = results.filter((r) => r.ownerId === 'groot' && r.finished);
  const grootBetaald = grootFinishers.filter((r) => r.prize > 0);
  const grootPunten = grootFinishers.filter((r) => r.points > 0);
  ok(`het grote hok heeft meer dan ${REWARD_BIRDS_PER_LOFT} finishers (${grootFinishers.length})`, grootFinishers.length > REWARD_BIRDS_PER_LOFT);
  ok(`maar hoogstens ${REWARD_BIRDS_PER_LOFT} krijgen geld`, grootBetaald.length <= REWARD_BIRDS_PER_LOFT, `${grootBetaald.length}`);
  ok(`en hoogstens ${REWARD_BIRDS_PER_LOFT} krijgen punten`, grootPunten.length <= REWARD_BIRDS_PER_LOFT, `${grootPunten.length}`);
  ok('het zijn de BEST geplaatste duiven die betaald worden',
    grootBetaald.every((r) => grootFinishers.slice(0, REWARD_BIRDS_PER_LOFT).some((x) => x.pigeonId === r.pigeonId)));
  ok('de niet-beloonde duiven zijn als zodanig gemarkeerd',
    grootFinishers.slice(REWARD_BIRDS_PER_LOFT).every((r) => r.rewarded === false && r.prize === 0 && r.points === 0));
  ok('het kleine hok wordt niet geraakt (beide duiven betaald)',
    results.filter((r) => r.ownerId === 'klein' && r.finished).every((r) => r.prize > 0 && r.rewarded !== false));

  // Geen doorschuiven: de plaats blijft de plaats, het geld vervalt gewoon.
  const table = flightPrizes(f);
  ok('een beloonde duif krijgt exact het bedrag van HAAR plaats (geen doorschuiven)',
    results.filter((r) => r.finished && r.rewarded !== false).every((r) => r.prize === prizeForRank(table, r.rank)));

  // De vroege uitbetaling moet dezelfde gate gebruiken, anders wordt de vierde
  // duif bij het finishen betaald en neemt finalize dat niet meer terug.
  const vroegBetaald = before.filter((p) => p.ownerId === 'groot' && p.prize > 0);
  ok('de vroege uitbetaling hanteert dezelfde limiet', vroegBetaald.length <= REWARD_BIRDS_PER_LOFT, `${vroegBetaald.length}`);
  ok('vroege uitbetaling en afronding wijzen hetzelfde toe',
    before.every((p) => {
      const r = results.find((x) => x.pigeonId === p.pigeonId)!;
      return r.prize === p.prize;
    }));
}

// --- 2b. De limiet dekt óók de criteriumpunten van de duif ----------------
console.log('\nDe limiet dekt ook de criteriumpunten');
{
  // Een criteriumvlucht kent punten toe aan de DUIF (schedule.tickFlights, uit
  // results[].rank). Die tellen als beloning, dus de vierde duif hoort er ook
  // daar niets van te krijgen.
  const pigeons = [
    ...Array.from({ length: 5 }, (_, i) => bird(`c${i}`, 'groot', 88 - i)),
    bird('r0', 'klein', 70),
  ];
  const f = race(pigeons, 250, 'flt_cup');
  (f as unknown as { ageCat: string; cupSprint: boolean }).ageCat = 'y12';
  (f as unknown as { cupSprint: boolean }).cupSprint = true;
  finalizeFlight(f, pigeons.map((p) => ({ ...p })) as Pigeon[]);
  const results = (f.results as FlightResult[]).slice().sort((a, b) => a.rank - b.rank);
  const grootFinishers = results.filter((r) => r.ownerId === 'groot' && r.finished);
  ok('een criteriumvlucht markeert de vierde duif ook als niet-beloond',
    grootFinishers.length > REWARD_BIRDS_PER_LOFT &&
    grootFinishers.slice(REWARD_BIRDS_PER_LOFT).every((r) => r.rewarded === false));
  ok('en betaalt haar geen prijzengeld',
    grootFinishers.slice(REWARD_BIRDS_PER_LOFT).every((r) => r.prize === 0));
}

// --- 3. Een DNF verbruikt geen plaats ------------------------------------
console.log('\nEen duif die niet thuis raakt kost je geen beloonde plaats');
{
  const pigeons = [
    ...Array.from({ length: 5 }, (_, i) => bird(`g${i}`, 'groot', 88 - i)),
    bird('k0', 'klein', 70), bird('k1', 'klein', 69),
  ];
  const f = race(pigeons, 300, 'flt_dnf');
  // De twee snelste duiven van het grote hok geven op.
  const sim = f.sim as SimEntry[];
  for (const id of ['g0', 'g1']) {
    const s = sim.find((x) => x.pigeonId === id)!;
    s.gaveUp = true; s.gaveUpAtSeconds = 60;
  }
  finalizeFlight(f, pigeons.map((p) => ({ ...p })) as Pigeon[]);
  const results = (f.results as FlightResult[]);
  const grootFinishers = results.filter((r) => r.ownerId === 'groot' && r.finished);
  const betaald = grootFinishers.filter((r) => r.prize > 0);
  ok('de opgevers krijgen niets', results.filter((r) => ['g0', 'g1'].includes(r.pigeonId)).every((r) => r.prize === 0 && r.points === 0));
  ok(`de drie overgebleven finishers worden alle drie beloond (${betaald.length}/${grootFinishers.length})`,
    betaald.length === Math.min(REWARD_BIRDS_PER_LOFT, grootFinishers.length));
}

// --- 4. Een klein veld: iedereen betaald ---------------------------------
console.log('\nKlein veld');
{
  const pigeons = [bird('a0', 'a', 80), bird('b0', 'b', 76), bird('c0', 'c', 72)];
  const f = race(pigeons, 150, 'flt_klein');
  finalizeFlight(f, pigeons.map((p) => ({ ...p })) as Pigeon[]);
  const results = f.results as FlightResult[];
  ok('elk hok met één duif krijgt gewoon betaald', results.filter((r) => r.finished).every((r) => r.prize > 0));
}

// --- 5. Groot veld: ook de staart verdient -------------------------------
console.log('\nGroot veld — de achterhoede vliegt niet meer voor niets');
{
  const pigeons = Array.from({ length: 24 }, (_, i) => bird(`p${i}`, `hok${i}`, 85 - i * 0.8));
  const f = race(pigeons, 300, 'flt_groot');
  finalizeFlight(f, pigeons.map((p) => ({ ...p })) as Pigeon[]);
  const results = (f.results as FlightResult[]).filter((r) => r.finished);
  ok(`elke finisher van 24 verdient iets (${results.length} finishers)`, results.every((r) => r.prize > 0),
    results.filter((r) => r.prize === 0).map((r) => r.rank).join(','));
  const laatste = results.reduce((a, b) => (a.rank > b.rank ? a : b));
  ok(`de laatst aankomende duif krijgt de bodem (plaats ${laatste.rank}: €${laatste.prize})`, laatste.prize === PRIZE_MONEY.national.rest);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
