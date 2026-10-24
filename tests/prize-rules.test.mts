/**
 * Regressietest op de twee uitbetalingsregels.
 *
 *  1. ELKE finisher verdient iets. De oude tabellen stopten na 8 of 10 plaatsen,
 *     dus in een veld van 20 vloog de achterhoede voor niets en verloor een zwak
 *     hok week na week zijn inschrijfgeld. De tabellen hebben nu banden en een
 *     bodem: wie thuis raakt, brengt altijd geld mee.
 *  2. Geld voor élke duif, punten voor de beste REWARD_BIRDS_PER_LOFT per hok
 *     (eigenaar, 24 okt; tot dan gold de limiet ook voor het geld). Een vierde
 *     duif vliegt, staat in de uitslag, verbetert en krijgt het geld van haar
 *     plaats, maar scoort geen punten. Die punten schuiven NIET door: de uitslag
 *     op het bord is de uitslag die gevlogen is.
 *  3. De aankondiging (migratie v69): één bel per speler, pas ná v68.
 *
 * Draai: npx tsx prize-rules.test.mts
 */
import { startLiveFlight, finalizeFlight, computeFinishPayouts, flightPrizes, type Entry } from '../core/game/flight.js';
import { PRIZE_MONEY, TITAN, REWARD_BIRDS_PER_LOFT, leaguePrizes, prizeForRank } from '../core/config/gameConfig.js';
import { emptyDatabase } from '../core/schema.js';
import { MemoryStore, newId } from '../core/store.js';
import { createLoftForUser, seedWorld } from '../core/game/engine.js';
import { runDataMigrations } from '../core/game/schedule.js';
import { PRIZE_RULE_NEWS } from '../core/game/news.js';
import type { Flight, Pigeon, SimEntry, FlightResult } from '../core/schema.js';

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
  ok('league ★81+ sprint 1e €1.100, bodem €65', prizeForRank(leaguePrizes('l81', true), 1) === 1100 && prizeForRank(leaguePrizes('l81', true), 40) === 65);
  ok('league ★81+ fond 1e €1.650, bodem €100', prizeForRank(leaguePrizes('l81', false), 1) === 1650 && prizeForRank(leaguePrizes('l81', false), 40) === 100);
  ok('league ★ t/m 60 sprint 1e €800, fond 1e €1.200, bodem €50',
    prizeForRank(leaguePrizes('l60', true), 1) === 800 && prizeForRank(leaguePrizes('l60', false), 1) === 1200 && prizeForRank(leaguePrizes('l60', true), 40) === 50);

  // De kern van de wijziging: geen enkele plaats levert nog niets op.
  for (const [naam, t] of [['regionaal', R], ['nationaal', N], ['internationaal', I], ['league ★81+ sprint', leaguePrizes('l81', true)], ['league ★81+ fond', leaguePrizes('l81', false)], ['league ★ t/m 60 sprint', leaguePrizes('l60', true)]] as const) {
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
console.log('\nGeld voor élke duif, punten voor de beste drie per hok');
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
  ok(`ELKE finisher krijgt geld (${grootBetaald.length} van ${grootFinishers.length})`, grootBetaald.length === grootFinishers.length);
  ok(`maar hoogstens ${REWARD_BIRDS_PER_LOFT} krijgen punten`, grootPunten.length <= REWARD_BIRDS_PER_LOFT, `${grootPunten.length}`);
  ok('het zijn de BEST geplaatste duiven die punten scoren',
    grootPunten.every((r) => grootFinishers.slice(0, REWARD_BIRDS_PER_LOFT).some((x) => x.pigeonId === r.pigeonId)));
  ok('de vierde duif en verder: gemarkeerd, betaald, zonder punten',
    grootFinishers.slice(REWARD_BIRDS_PER_LOFT).every((r) => r.rewarded === false && r.prize > 0 && r.points === 0));
  ok('het kleine hok wordt niet geraakt (beide duiven betaald en gescoord)',
    results.filter((r) => r.ownerId === 'klein' && r.finished).every((r) => r.prize > 0 && r.rewarded !== false));

  // Geen doorschuiven: elke finisher krijgt het bedrag van HAAR plaats, en de
  // punten van een vierde duif gaan naar niemand.
  const table = flightPrizes(f);
  ok('elke finisher krijgt exact het bedrag van HAAR plaats',
    results.filter((r) => r.finished).every((r) => r.prize === prizeForRank(table, r.rank)));

  // De vroege uitbetaling (bij het finishen) en de afronding moeten hetzelfde
  // betalen, anders krijgt een duif twee keer of nooit haar geld.
  const vroegBetaald = before.filter((p) => p.ownerId === 'groot' && p.prize > 0);
  ok('de vroege uitbetaling betaalt ook elke duif', vroegBetaald.length === grootFinishers.length, `${vroegBetaald.length}`);
  ok('vroege uitbetaling en afronding wijzen hetzelfde toe',
    before.every((p) => {
      const r = results.find((x) => x.pigeonId === p.pigeonId)!;
      return r.prize === p.prize;
    }));
}

// --- 2b. In een league: geld voor elke duif, leaguepunten voor de beste drie --
console.log('\nIn een league: geld voor elke duif, leaguepunten voor de beste drie');
{
  // Een leaguevlucht kent punten toe aan de DUIF (schedule.tickFlights, uit
  // results[].rank, enkel als `rewarded !== false`) — dus de vierde duif scoort
  // daar niets, maar haar prijzengeld krijgt ze wel.
  const pigeons = [
    ...Array.from({ length: 5 }, (_, i) => bird(`c${i}`, 'groot', 88 - i)),
    bird('r0', 'klein', 70),
  ];
  const f = race(pigeons, 250, 'flt_league');
  f.league = 'l81';
  f.leagueSprint = true;
  finalizeFlight(f, pigeons.map((p) => ({ ...p })) as Pigeon[]);
  const results = (f.results as FlightResult[]).slice().sort((a, b) => a.rank - b.rank);
  const grootFinishers = results.filter((r) => r.ownerId === 'groot' && r.finished);
  ok('een leaguevlucht markeert de vierde duif ook (geen leaguepunten)',
    grootFinishers.length > REWARD_BIRDS_PER_LOFT &&
    grootFinishers.slice(REWARD_BIRDS_PER_LOFT).every((r) => r.rewarded === false));
  ok('maar betaalt haar wel het geld van haar plaats',
    grootFinishers.slice(REWARD_BIRDS_PER_LOFT).every((r) => r.prize === prizeForRank(leaguePrizes('l81', true), r.rank)));
}

// --- 3. Een DNF verbruikt geen plaats ------------------------------------
console.log('\nEen duif die niet thuis raakt kost je geen plaats bij de punten');
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
  const gescoord = grootFinishers.filter((r) => r.rewarded !== false);
  ok('de opgevers krijgen niets', results.filter((r) => ['g0', 'g1'].includes(r.pigeonId)).every((r) => r.prize === 0 && r.points === 0));
  ok(`de drie overgebleven finishers scoren alle drie (${gescoord.length}/${grootFinishers.length})`,
    gescoord.length === Math.min(REWARD_BIRDS_PER_LOFT, grootFinishers.length));
  ok('en ze worden alle drie betaald', grootFinishers.every((r) => r.prize > 0));
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

// --- 6. De aankondiging: migratie v69 -------------------------------------
console.log('\nDe aankondiging (migratie v69)');
{
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const humans = ['a', 'b'].map((n) => {
    const u = { id: newId('usr'), username: n, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
    store.mutate((d) => d.users.push(u));
    createLoftForUser(store, u, `Hok ${n}`);
    return u.id;
  });
  const db = store.data;
  runDataMigrations(db);
  ok('een verse wereld loopt door tot v69', db.world.dataVersion === 69);
  // Production at v68: the bell goes to every real player, once.
  db.world.dataVersion = 68;
  db.notifications = db.notifications.filter((n) => !n.id.startsWith('ntf:news:prijsregel:'));
  runDataMigrations(db);
  runDataMigrations(db);
  const bells = db.notifications.filter((n) => n.id.startsWith('ntf:news:prijsregel:'));
  ok(`één bel per echte speler (${bells.length}), geen voor de bots`,
    bells.length === humans.length && humans.every((u) => bells.some((n) => n.userId === u)));
  ok('de bel legt de regel uit', /élke duif/.test(PRIZE_RULE_NEWS.body) && /3 best geplaatste/.test(PRIZE_RULE_NEWS.body)
    && PRIZE_RULE_NEWS.body.includes('€800') && PRIZE_RULE_NEWS.body.includes('€1.200') && PRIZE_RULE_NEWS.body.length < 900);
  // While v68 still fills bots (production, in steps), v69 must wait for it.
  db.world.dataVersion = 67;
  db.world.seasonYear = 4;
  db.notifications = db.notifications.filter((n) => !n.id.startsWith('ntf:news:prijsregel:'));
  db.flights.push({ id: 'flt_busy', status: 'scheduled', startAt: new Date(Date.now() - 60000).toISOString(), entries: [] } as unknown as Flight);
  runDataMigrations(db);
  ok('zolang v68 de bots bijvult, wacht de bel', (db.world.dataVersion ?? 0) < 68 && !db.notifications.some((n) => n.id.startsWith('ntf:news:prijsregel:')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
