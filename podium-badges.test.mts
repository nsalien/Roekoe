/**
 * Regressietest: een podium telt op ELKE wedstrijd.
 *
 * Aanleiding (eigenaar): "krijg je bij het behalen van een podiumplaats ook de
 * badge op de criteriumvluchten? Zo niet, dit moet op alle wedstrijden gelden."
 * Dat deed het niet — `tickFlights` sloeg `awardFlightBadges` volledig over voor
 * de titan, de estafette én het leeftijdscriterium, dus medailles (die de
 * `podium_*`-badges en de trofeekast voeden) werden daar niet geboekt.
 *
 * Drie dingen moeten hard blijven staan:
 *
 *  1. **Medailles overal.** Titan, estafette en criterium boeken goud/zilver/brons
 *     net als een gewone wedstrijd.
 *  2. **Maar GEEN tier-zeges.** `regionalWins`/`nationalWins`/`intlWins` betekenen
 *     "won een regionale/nationale/internationale vlucht". Alle drie de speciale
 *     formats dragen intern `type: 'international'`, dus zonder de rem zou een
 *     titanzege stilletjes als internationale zege op het profiel komen.
 *  3. **Een estafetteploeg telt ÉÉN keer.** Daar draagt elke duif van de ploeg een
 *     eigen resultaatrij met de rang van de PLOEG, dus een ploegzege van drie
 *     duiven zou anders drie gouden medailles boeken.
 *
 * Run: npx tsx podium-badges.test.mts
 */
import { awardFlightBadges } from './core/game/badges.js';
import { generatePigeon } from './core/game/pigeon.js';
import { RELAY } from './core/config/gameConfig.js';
import type { Database, Flight, Loft, Pigeon } from './core/schema.js';

let fails = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fails++;
};

function loft(userId: string): Loft {
  return {
    id: `l_${userId}`, userId, name: `Hok ${userId}`, money: 10000, capacity: 12,
    food: { normal: 100, premium: 0, libido: 0, herstel: 0 },
    compartments: 0, doctors: 0, physios: 0, medicatedFeed: false, infirmaryCapacity: 2,
    totalWins: 0, seasonWins: 0, seasonPoints: 0, level: 1, xp: 0, badges: [],
    stats: {
      gold: 0, silver: 0, bronze: 0, regionalWins: 0, nationalWins: 0, intlWins: 0,
      races: 0, buys: 0, sells: 0, babies: 0, cures: 0, curesSevere: 0, bets: 0, betsWon: 0, broods: 0,
    },
  } as unknown as Loft;
}

function world(lofts: Loft[], pigeons: Pigeon[]): Database {
  return {
    world: { currentWeek: 400, dataVersion: 45, seasonYear: 1 },
    lofts, pigeons, users: lofts.map((l) => ({ id: l.userId, username: l.userId, isBot: false })),
    flights: [], trades: [], notifications: [], bets: [], auctions: [], offers: [], breedingPairs: [],
  } as unknown as Database;
}

let seq = 0;
function pigeon(ownerId: string): Pigeon {
  const p = generatePigeon({ ownerId, currentWeek: 400, quality: 0.5, birthWeek: 340 });
  p.id = `pig_${seq++}`; p.ownerId = ownerId; p.races = 0;
  return p;
}

/** Een gewone uitslag: één rij per duif, rang = plaats van die duif. */
function soloFlight(kind: Partial<Flight>, rows: { p: Pigeon; rank: number }[]): Flight {
  return {
    id: `flt_${seq++}`, name: 'T', type: 'international', week: 400,
    fromCity: 'A', toCity: 'B', distanceKm: 400,
    startAt: new Date('2026-09-05T04:00:00Z').toISOString(), status: 'completed',
    weather: 'zwak', weatherFactor: 1, entries: [],
    results: rows.map((r) => ({
      pigeonId: r.p.id, pigeonName: r.p.name, ownerId: r.p.ownerId, ownerName: 'Hok',
      velocity: 1200, timeSeconds: 3600, rank: r.rank, points: 0, prize: 0, finished: true,
    })),
    ...kind,
  } as unknown as Flight;
}

console.log('\n1. Medailles worden overal geboekt');
{
  for (const [label, kind] of [
    ['gewone wedstrijd', {}],
    ['titanenwedstrijd', { titan: true }],
    ['leeftijdscriterium', { ageCat: 'y12' }],
  ] as [string, Partial<Flight>][]) {
    const l = loft('u1');
    const a = pigeon('u1'), b = pigeon('u1'), c = pigeon('u1');
    const db = world([l], [a, b, c]);
    const f = soloFlight(kind, [{ p: a, rank: 1 }, { p: b, rank: 2 }, { p: c, rank: 3 }]);
    const special = !!(kind.titan || kind.ageCat);
    awardFlightBadges(db, f, { tierWins: !special });
    ok(`${label}: goud/zilver/brons geboekt`,
      l.stats.gold === 1 && l.stats.silver === 1 && l.stats.bronze === 1,
      `${l.stats.gold}/${l.stats.silver}/${l.stats.bronze}`);
    ok(`${label}: de podiumbadge is toegekend`,
      (l.badges ?? []).some((b2: any) => (b2.key ?? b2) === 'podium_1'));
    ok(`${label}: elke deelnemende duif telt een vlucht`,
      a.races === 1 && b.races === 1 && c.races === 1);
  }
}

console.log('\n2. Maar de TIER-zeges blijven bij de drie competitieniveaus');
{
  const l = loft('u1');
  const a = pigeon('u1');
  const db = world([l], [a]);
  // Een titan draagt intern type 'international' — precies de valstrik.
  awardFlightBadges(db, soloFlight({ titan: true }, [{ p: a, rank: 1 }]), { tierWins: false });
  ok('een titanzege telt NIET als internationale zege',
    l.stats.intlWins === 0, `intlWins ${l.stats.intlWins}`);
  ok('maar het goud is er wel', l.stats.gold === 1);
  awardFlightBadges(db, soloFlight({ ageCat: 'o3' }, [{ p: a, rank: 1 }]), { tierWins: false });
  ok('een criteriumzege telt NIET als internationale zege', l.stats.intlWins === 0);
  ok('en het goud stapelt gewoon door', l.stats.gold === 2);
  awardFlightBadges(db, soloFlight({ type: 'international' }, [{ p: a, rank: 1 }]), { tierWins: true });
  ok('een échte internationale zege telt wél', l.stats.intlWins === 1);
}

console.log('\n3. Een estafetteploeg telt één keer, niet drie keer');
{
  const l = loft('u1');
  const team = [pigeon('u1'), pigeon('u1'), pigeon('u1')];
  const rival = [pigeon('u2'), pigeon('u2'), pigeon('u2')];
  const l2 = loft('u2');
  const db = world([l, l2], [...team, ...rival]);
  // Zoals finalizeRelayFlight het schrijft: één rij per duif, met de PLOEGRANG.
  const f = soloFlight({ relay: true, teamSize: RELAY.teamSize }, [
    ...team.map((p) => ({ p, rank: 1 })),
    ...rival.map((p) => ({ p, rank: 2 })),
  ]);
  awardFlightBadges(db, f, { tierWins: false });
  ok('de winnende ploeg boekt precies ÉÉN goud', l.stats.gold === 1, `${l.stats.gold} goud`);
  ok('en geen zilver of brons erbij', l.stats.silver === 0 && l.stats.bronze === 0);
  ok('de tweede ploeg boekt precies één zilver',
    l2.stats.silver === 1 && l2.stats.gold === 0, `${l2.stats.gold}/${l2.stats.silver}`);
  ok('een ploegzege telt niet als internationale zege', l.stats.intlWins === 0);
  ok('elke duif die haar etappe vloog telt één vlucht',
    team.every((p) => p.races === 1), team.map((p) => p.races).join(','));
}

console.log('\n4. Een estafetteduif die nooit gelost werd, telt geen vlucht');
{
  const l = loft('u1');
  const team = [pigeon('u1'), pigeon('u1'), pigeon('u1')];
  const db = world([l], team);
  const f = soloFlight({ relay: true, teamSize: RELAY.teamSize }, team.map((p) => ({ p, rank: 3 })));
  // Ploeg uitgeschakeld op etappe 1: de twee volgende duiven zijn nooit gelost.
  (f.results as any)[1].finished = false;
  (f.results as any)[2].finished = false;
  awardFlightBadges(db, f, { tierWins: false });
  ok('de duif die wél vloog telt een vlucht', team[0].races === 1);
  ok('de twee die aan de wissel bleven staan niet',
    team[1].races === 0 && team[2].races === 0, `${team[1].races}/${team[2].races}`);
  // Een uitgeschakelde ploeg kan nog steeds in de prijzen eindigen (spelregels
  // §2.9), dus derde worden levert brons op — maar wel precies één keer.
  ok('een uitgeschakelde derde ploeg krijgt precies één brons',
    l.stats.gold === 0 && l.stats.silver === 0 && l.stats.bronze === 1,
    `${l.stats.gold}/${l.stats.silver}/${l.stats.bronze}`);
}

console.log('\n5. Een DNF levert geen medaille op');
{
  const l = loft('u1');
  const a = pigeon('u1');
  const db = world([l], [a]);
  const f = soloFlight({ ageCat: 'u1' }, [{ p: a, rank: 1 }]);
  (f.results as any)[0].finished = false;
  awardFlightBadges(db, f, { tierWins: false });
  ok('geen goud voor een duif die niet finishte', l.stats.gold === 0);
  ok('maar de start telt wel als vlucht', a.races === 1);
}

console.log(`\n${fails === 0 ? '✅ alles groen' : `❌ ${fails} controle(s) gefaald`}\n`);
process.exit(fails === 0 ? 0 : 1);
