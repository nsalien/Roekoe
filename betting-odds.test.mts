/**
 * Regressietest op de weddenschapskansen.
 *
 * De Monte-Carlo is herschreven: hij bouwt geen volledige aankomstvolgorde per
 * trekking meer (1500 sorteringen van ~100 duiven = 15-27 ms CPU, over het
 * Workers-budget van 10 ms), maar telt in één O(duiven)-pass precies wat de
 * inzetsoorten nodig hebben. Er gaat geld om in deze kansen, dus dit bewaakt dat
 * de uitkomsten kloppen, stabiel zijn en op de cache blijven reageren.
 *
 * Run: npx tsx betting-odds.test.mts
 */
import { betProbability, ratioFor } from './core/game/betting.js';
import { generatePigeon } from './core/game/pigeon.js';
import { pigeonVelocity } from './core/game/flight.js';
import { BETTING } from './core/config/gameConfig.js';
import type { Database, Flight, Pigeon } from './core/schema.js';

let fails = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fails++;
};

function world(n: number, seed = 1): { db: Database; flight: Flight; birds: Pigeon[] } {
  const birds: Pigeon[] = [];
  for (let i = 0; i < n; i++) {
    // Oplopende kwaliteit, zodat "sterker = meer kans" toetsbaar is.
    const p = generatePigeon({ currentWeek: 60, quality: 0.2 + (i / n) * 0.7 });
    p.id = `pig_${seed}_${i}`;
    p.name = `Duif ${i}`;
    p.ownerId = `usr_${i % 4}`;
    p.form = 80;
    p.health = 90;
    birds.push(p);
  }
  const flight = {
    id: `flt_${seed}`, name: 'Test', type: 'national', week: 60,
    fromCity: 'A', toCity: 'B', distanceKm: 400,
    startAt: new Date('2026-09-01T06:00:00Z').toISOString(),
    status: 'scheduled', weather: 'zwak', weatherFactor: 1,
    entries: birds.map((p) => ({ pigeonId: p.id, pigeonName: p.name, ownerId: p.ownerId, ownerName: 'Hok' })),
    sim: [], results: [], recap: null,
  } as unknown as Flight;
  const db = { pigeons: birds, flights: [flight], lofts: [], users: [], bets: [] } as unknown as Database;
  return { db, flight, birds };
}

const P = (db: Database, f: Flight, kind: any, user: string, a: string | null, b: string | null = null) =>
  betProbability(db, f, kind, user, a, b);

/**
 * Rangschik op ECHTE snelheid, niet op index: `generatePigeon`'s `quality` is
 * ruizig genoeg dat een hogere quality niet altijd een snellere duif oplevert.
 * De sterkte-invarianten hieronder moeten tegen het model getoetst worden, niet
 * tegen de volgorde waarin de test ze aanmaakt.
 */
const byVelocity = (birds: Pigeon[], f: Flight): Pigeon[] =>
  birds.slice().sort((a, b) => pigeonVelocity(a, f.distanceKm, f.week, 1, 1) - pigeonVelocity(b, f.distanceKm, f.week, 1, 1));

console.log('Kansen liggen in [0,1] en zijn intern consistent');
{
  const { db, flight, birds } = world(24, 11);
  let allInRange = true, winLeTop3 = true, sumWin = 0;
  for (const p of birds) {
    const w = P(db, flight, 'win', p.ownerId, p.id)!;
    const t3 = P(db, flight, 'top3', p.ownerId, p.id)!;
    const l = P(db, flight, 'last', p.ownerId, p.id)!;
    if (!(w >= 0 && w <= 1 && t3 >= 0 && t3 <= 1 && l >= 0 && l <= 1)) allInRange = false;
    if (w > t3 + 1e-9) winLeTop3 = false;
    sumWin += w;
  }
  ok('elke kans zit tussen 0 en 1', allInRange);
  ok('P(wint) is nooit groter dan P(top 3)', winLeTop3);
  ok('de winkansen samen tellen op tot ~1', Math.abs(sumWin - 1) < 0.02, `som = ${sumWin.toFixed(4)}`);

  let sumTop3 = 0, sumLast = 0;
  for (const p of birds) {
    sumTop3 += P(db, flight, 'top3', p.ownerId, p.id)!;
    sumLast += P(db, flight, 'last', p.ownerId, p.id)!;
  }
  ok('de top-3-kansen samen tellen op tot ~3', Math.abs(sumTop3 - 3) < 0.05, `som = ${sumTop3.toFixed(3)}`);
  ok('de laatste-kansen samen tellen op tot ~1', Math.abs(sumLast - 1) < 0.02, `som = ${sumLast.toFixed(4)}`);
}

console.log('\nEen sterkere duif krijgt een hogere winkans');
{
  const { db, flight, birds } = world(20, 12);
  const ranked = byVelocity(birds, flight);
  const best = ranked[ranked.length - 1], worst = ranked[0];
  const pb = P(db, flight, 'win', best.ownerId, best.id)!;
  const pw = P(db, flight, 'win', worst.ownerId, worst.id)!;
  ok('beste duif > slechtste duif', pb > pw, `${(pb * 100).toFixed(1)}% vs ${(pw * 100).toFixed(1)}%`);
  const tb = P(db, flight, 'top3', best.ownerId, best.id)!;
  const tw = P(db, flight, 'top3', worst.ownerId, worst.id)!;
  ok('idem voor top 3', tb > tw, `${(tb * 100).toFixed(1)}% vs ${(tw * 100).toFixed(1)}%`);
  const lb = P(db, flight, 'last', best.ownerId, best.id)!;
  const lw = P(db, flight, 'last', worst.ownerId, worst.id)!;
  ok('de slechtste eindigt vaker laatst', lw > lb, `${(lw * 100).toFixed(1)}% vs ${(lb * 100).toFixed(1)}%`);
}

console.log('\nKop-aan-kop');
{
  const { db, flight, birds } = world(16, 13);
  const ranked = byVelocity(birds, flight);
  const a = ranked[ranked.length - 1], b = ranked[0];
  const ab = P(db, flight, 'head2head', a.ownerId, a.id, b.id)!;
  const ba = P(db, flight, 'head2head', b.ownerId, b.id, a.id)!;
  ok('sterkere duif wint het duel vaker', ab > ba, `${(ab * 100).toFixed(1)}% vs ${(ba * 100).toFixed(1)}%`);
  ok('beide richtingen samen ≤ 1', ab + ba <= 1 + 1e-9, `som = ${(ab + ba).toFixed(4)}`);
  ok('beide richtingen samen ~1 (rest = allebei DNF)', ab + ba > 0.9, `som = ${(ab + ba).toFixed(4)}`);
  ok('duel met zichzelf is ongeldig', P(db, flight, 'head2head', a.ownerId, a.id, a.id) === null);
  const mid = ranked[Math.floor(ranked.length / 2)];
  const am = P(db, flight, 'head2head', a.ownerId, a.id, mid.id)!;
  const mb = P(db, flight, 'head2head', mid.ownerId, mid.id, b.id)!;
  ok('transitief: sterk>midden en midden>zwak', am > 0.5 && mb > 0.5, `${(am * 100).toFixed(0)}% / ${(mb * 100).toFixed(0)}%`);
}

console.log('\nEigendom-gebonden inzetten');
{
  const { db, flight, birds } = world(12, 14);
  const mine = birds.find((p) => p.ownerId === 'usr_0')!;
  const theirs = birds.find((p) => p.ownerId === 'usr_1')!;
  ok('own_top3 werkt op je eigen duif', typeof P(db, flight, 'own_top3', 'usr_0', mine.id) === 'number');
  ok('own_top3 weigert andermans duif', P(db, flight, 'own_top3', 'usr_0', theirs.id) === null);
  ok('own_top3 == top3 voor dezelfde duif', P(db, flight, 'own_top3', 'usr_0', mine.id) === P(db, flight, 'top3', 'usr_0', mine.id));
  const mw = P(db, flight, 'mine_wins', 'usr_0', null)!;
  ok('mine_wins is een geldige kans', mw >= 0 && mw < 1, `${(mw * 100).toFixed(1)}%`);
  ok('mine_wins weigert een speler zonder duiven', P(db, flight, 'mine_wins', 'usr_zonder', null) === null);
  const own = birds.filter((p) => p.ownerId === 'usr_0');
  const sumOwn = own.reduce((s, p) => s + P(db, flight, 'win', 'usr_0', p.id)!, 0);
  ok('mine_wins == som van de winkansen van je duiven', Math.abs(mw - sumOwn) < 1e-9, `${mw.toFixed(4)} vs ${sumOwn.toFixed(4)}`);
  ok('onbekende duif geeft null', P(db, flight, 'win', 'usr_0', 'pig_bestaat_niet') === null);
}

console.log('\nDeterministisch: dezelfde vraag geeft altijd hetzelfde antwoord');
{
  const { db, flight, birds } = world(20, 15);
  const p = birds[7];
  const first = P(db, flight, 'win', p.ownerId, p.id)!;
  const again = P(db, flight, 'win', p.ownerId, p.id)!;
  ok('twee keer achter elkaar (cache-hit)', first === again);

  // Nu de KOUDE weg met exact dezelfde invoer: druk de cache vol met andere
  // vluchten tot deze eruit gevallen is, en vraag het dan opnieuw. Dat is het
  // geval na een isolate-recycle, en daar mag de uitkomst niet van verschuiven.
  for (let k = 0; k < 12; k++) {
    const other = world(6, 900 + k);
    P(other.db, other.flight, 'win', other.birds[0].ownerId, other.birds[0].id);
  }
  const afterEvict = P(db, flight, 'win', p.ownerId, p.id)!;
  ok('na verdringing uit de cache (koude weg)', first === afterEvict, `${first} vs ${afterEvict}`);

  // Een tweede vlucht met dezelfde duiven maar een andere id hoort een ANDERE
  // trekking te geven: de seed hangt aan de vlucht. Vergelijk het HELE veld —
  // één duif met een kans van een fractie van een procent kan bij twee losse
  // trekkingen best toevallig op hetzelfde aantal uitkomen.
  const twin = { ...flight, id: 'flt_15_twin' } as Flight;
  const here = birds.map((b) => P(db, flight, 'win', b.ownerId, b.id));
  const there = birds.map((b) => P(db, twin, 'win', b.ownerId, b.id));
  ok('een andere vlucht-id geeft een eigen trekking', JSON.stringify(here) !== JSON.stringify(there));
}

console.log('\nDe cache reageert op wijzigingen');
{
  const { db, flight, birds } = world(16, 16);
  // De favoriet: die heeft een kans die merkbaar kan zakken.
  const p = byVelocity(birds, flight)[birds.length - 1];
  const before = P(db, flight, 'win', p.ownerId, p.id)!;
  // Energie omlaag = hogere DNF-kans = lagere winkans. Als de cache niet
  // invalideert, blijft het antwoord onterecht staan.
  p.form = 5;
  const after = P(db, flight, 'win', p.ownerId, p.id)!;
  ok('lagere energie verlaagt de winkans', after < before, `${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%`);

  // De favoriet uitschrijven moet de kansen van de nummer twee verhogen.
  const ranked = byVelocity(birds, flight);
  const favourite = ranked[ranked.length - 1];
  const runnerUp = ranked[ranked.length - 2];
  const solo = P(db, flight, 'win', runnerUp.ownerId, runnerUp.id)!;
  flight.entries = flight.entries.filter((e) => e.pigeonId !== favourite.id);
  const afterWithdraw = P(db, flight, 'win', runnerUp.ownerId, runnerUp.id)!;
  ok('favoriet uitgeschreven verhoogt de nummer twee', afterWithdraw > solo, `${(solo * 100).toFixed(1)}% → ${(afterWithdraw * 100).toFixed(1)}%`);
}

console.log('\nUitbetalingsratio blijft binnen zijn grenzen');
{
  const { db, flight, birds } = world(30, 17);
  const ranked = byVelocity(birds, flight);
  let inBounds = true;
  const ratios = ranked.map((p) => ratioFor(P(db, flight, 'win', p.ownerId, p.id)!));
  for (const r of ratios) if (r < BETTING.minRatio || r > BETTING.maxRatio) inBounds = false;
  const favouriteCheaper = ratios[ratios.length - 1] < ratios[0];
  ok('elke ratio zit tussen min en max', inBounds);
  ok('de favoriet betaalt minder uit dan de outsider', favouriteCheaper, `${ratios[ratios.length - 1]}× vs ${ratios[0]}×`);
  ok('het huis houdt zijn marge', ratioFor(0.5) < 2, `${ratioFor(0.5)}× bij 50%`);
}

console.log('\nRandgevallen');
{
  const one = world(1, 18);
  ok('vlucht met één duif geeft null', P(one.db, one.flight, 'win', one.birds[0].ownerId, one.birds[0].id) === null);
  const big = world(140, 19);
  const p = big.birds[70];
  const w = P(big.db, big.flight, 'win', p.ownerId, p.id);
  ok('vol veld van 140 duiven levert een geldige kans', typeof w === 'number' && w! >= 0 && w! <= 1);
}

console.log(fails === 0 ? '\nAlles OK' : `\n${fails} FOUT(EN)`);
process.exitCode = fails === 0 ? 0 : 1;
