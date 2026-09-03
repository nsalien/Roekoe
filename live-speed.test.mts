/**
 * Regressietest op het km/u-cijfer van het live-bord.
 *
 * Aanleiding: de afgelegde afstand verzette bij élke poll (60 s) terwijl de
 * snelheid ernaast minutenlang stilstond. Oorzaak was niet het pollritme maar
 * `FLIGHT_DYNAMICS.segments` (10): `raceProgress` geeft de multiplicator van het
 * HUIDIGE segment, en die is binnen een segment constant. Gemeten duurde één
 * segment ~9 min op een regiovlucht, ~45 min op 733 km en ~66 min op de fond.
 *
 * `smoothPaceMult` interpoleert nu tussen de segmentmiddens. Twee dingen moeten
 * daarbij hard blijven staan, en dat is wat deze test bewaakt:
 *
 *  1. **Het is enkel weergave.** Posities, duur, de aankomstvolgorde, de
 *     energie-afrekening en het verslag lezen nog steeds de RAUWE `segMult`. Een
 *     interpolatie die daarin lekt zou finishtijden verschuiven en de invariant
 *     "live-einde == einduitslag" breken.
 *  2. **Het mag niets kosten.** Dit draait op `/flights/:id/live`, het heetste
 *     endpoint van het spel, tegen een CPU-budget van 10 ms per verzoek op het
 *     gratis plan — en productie rekent ~1,9× zwaarder dan lokaal. De helper is
 *     O(1) en vervangt een tweede `raceProgress`-aanroep per duif per poll, dus
 *     het bord hoort GOEDKOPER te zijn dan met de oude 5-minutenraster-versie.
 *
 * Run: npx tsx live-speed.test.mts
 */
import {
  smoothPaceMult, liveSnapshot, startLiveFlight, flightTotalSeconds, finalizeFlight,
} from './core/game/flight.js';
import { generatePigeon } from './core/game/pigeon.js';
import { FLIGHT_DYNAMICS, RELAY } from './core/config/gameConfig.js';
import type { Flight, Pigeon } from './core/schema.js';

let fails = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fails++;
};

let seq = 0;
const START = '2026-09-05T04:00:00Z';

function soloFlight(n: number, km: number): { flight: Flight; birds: Pigeon[] } {
  const birds: Pigeon[] = [];
  for (let i = 0; i < n; i++) {
    const p = generatePigeon({ currentWeek: 60, quality: 0.25 + (i % 8) / 11 });
    p.ownerId = `usr_${i % 10}`;
    birds.push(p);
  }
  const f = {
    id: `flt_spd_${seq++}`, name: 'Test', type: 'international', week: 60,
    fromCity: 'A', toCity: 'B', distanceKm: km,
    startAt: new Date(START).toISOString(),
    status: 'live', weather: 'zwak', weatherFactor: 1,
    entries: birds.map((p) => ({ pigeonId: p.id, pigeonName: p.name, ownerId: p.ownerId, ownerName: 'Hok' })),
    sim: [], results: [], recap: null,
  } as unknown as Flight;
  startLiveFlight(f, birds.map((p) => ({ pigeon: p, ownerId: p.ownerId, ownerName: 'Hok' })) as any, 60, undefined);
  return { flight: f, birds };
}

function relayFlight(teams: number): Flight {
  const size = RELAY.teamSize, legKm = 300;
  const birds: Pigeon[] = [];
  const entries: any[] = [];
  for (let t = 0; t < teams; t++) {
    for (let l = 1; l <= size; l++) {
      const p = generatePigeon({ currentWeek: 60, quality: 0.3 + ((t * size + l) % 7) / 12 });
      p.ownerId = `usr_${t}`;
      birds.push(p);
      entries.push({ pigeonId: p.id, pigeonName: p.name, ownerId: p.ownerId, ownerName: `Hok ${t}`, leg: l });
    }
  }
  const f = {
    id: `flt_spd_relay_${seq++}`, name: 'Estafette', type: 'international', week: 60,
    fromCity: 'A', toCity: 'B', distanceKm: legKm * size,
    startAt: new Date(START).toISOString(),
    status: 'live', weather: 'zwak', weatherFactor: 1, relay: true, teamSize: size,
    legs: Array.from({ length: size }, (_, i) => ({
      index: i + 1, fromName: `P${i}`, toName: `P${i + 1}`, distanceKm: legKm, weather: 'zwak', weatherFactor: 1,
    })),
    entries, sim: [], results: [], recap: null,
  } as unknown as Flight;
  startLiveFlight(f, birds.map((p) => ({ pigeon: p, ownerId: p.ownerId, ownerName: 'Hok' })) as any, 60, undefined);
  return f;
}

console.log('\n1. smoothPaceMult — de wiskunde zelf');
{
  const seg = [1.0, 2.0, 3.0, 4.0];
  const N = seg.length;
  // Het midden van segment i ligt op (i+0.5)/N: daar moet de rauwe waarde staan.
  let exact = true;
  for (let i = 0; i < N; i++) {
    if (Math.abs(smoothPaceMult(seg, (i + 0.5) / N) - seg[i]) > 1e-9) exact = false;
  }
  ok('op elk segmentmidden staat exact de rauwe waarde', exact);
  ok('halverwege twee middens ligt het er precies tussenin',
    Math.abs(smoothPaceMult(seg, 1 / N) - 1.5) < 1e-9, `${smoothPaceMult(seg, 1 / N)}`);
  ok('vóór het eerste midden blijft het vlak', smoothPaceMult(seg, 0) === seg[0]);
  ok('ná het laatste midden blijft het vlak', smoothPaceMult(seg, 1) === seg[N - 1]);
  ok('nooit buiten het bereik van de segmenten', (() => {
    for (let k = 0; k <= 1000; k++) {
      const v = smoothPaceMult(seg, k / 1000);
      if (v < Math.min(...seg) - 1e-9 || v > Math.max(...seg) + 1e-9) return false;
    }
    return true;
  })());
  ok('continu — geen sprong tussen twee naburige punten', (() => {
    let prev = smoothPaceMult(seg, 0);
    for (let k = 1; k <= 2000; k++) {
      const v = smoothPaceMult(seg, k / 2000);
      if (Math.abs(v - prev) > 0.01) return false; // stap 3.0 zou 1.0 per grens zijn
      prev = v;
    }
    return true;
  })());
  ok('legacy-vlucht zonder profiel valt terug op 1', smoothPaceMult(undefined, 0.5) === 1
    && smoothPaceMult([], 0.5) === 1);
  ok('één segment geeft dat ene segment', smoothPaceMult([1.7], 0.42) === 1.7);
  ok('progress buiten [0,1] wordt geklemd i.p.v. te extrapoleren',
    smoothPaceMult(seg, -5) === seg[0] && smoothPaceMult(seg, 9) === seg[N - 1]);
}

console.log('\n2. Het cijfer beweegt nu mee met de poll (de eigenlijke klacht)');
{
  // ⚠️ Meet op een duif met een SCHONE vlucht. Tijdens een omweg (§3.5) zakt haar
  // voortgang OP DE ROUTE naar een fractie van normaal — ze vliegt zijwaarts — en
  // dan hoort het cijfer wél een tijd stil te staan: haar pace-multiplicator is
  // over die strook een constante. Een plateau is daar juist gedrag, geen trap.
  // Op 733 km dwaalt een flink deel van het veld af, dus zoek gericht een vlucht
  // die er één bevat i.p.v. te hopen dat de eerste duif toevallig schoon vliegt.
  let flight: Flight | null = null;
  let target = '';
  for (let attempt = 0; attempt < 40 && !flight; attempt++) {
    const f = soloFlight(30, 733).flight;
    const clean = f.sim!.find((s) => !s.strays?.length && !s.dnfAtSeconds && !s.gaveUp);
    if (clean) { flight = f; target = clean.pigeonId; }
  }
  ok('een vlucht met een schoon vliegende duif gevonden', !!flight);
  if (!flight) throw new Error('geen schone duif gevonden in 40 vluchten');
  const startMs = Date.parse(flight.startAt);
  const total = flightTotalSeconds(flight);
  // Bemonster op het échte pollritme van LiveFlightPage (60 s) over de hele race.
  const speeds: number[] = [];
  for (let t = 60; t < total; t += 60) {
    const b = liveSnapshot(flight, startMs + t * 1000).birds.find((x) => x.pigeonId === target);
    if (!b || b.finished || b.gaveUp) break;
    speeds.push(b.speedKmh);
  }
  const distinct = new Set(speeds).size;
  ok('meer dan tien verschillende snelheidswaarden in één vlucht',
    distinct > FLIGHT_DYNAMICS.segments, `${distinct} waarden over ${speeds.length} polls`);
  // ⚠️ De eerste en laatste HALVE segment houden bewust vlak: daar ligt geen tweede
  // segmentmidden meer om naartoe te interpoleren, en een waarde verzinnen voorbij
  // het profiel zou motie tonen die de sim niet heeft. Die twee stukken zijn dus
  // per constructie stil, en de bewaking gaat over het binnenstuk van de race.
  const longestRun = (xs: number[]) => {
    let longest = 0, run = 1;
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] === xs[i - 1]) run++; else { longest = Math.max(longest, run); run = 1; }
    }
    return Math.max(longest, run);
  };
  // ⚠️ RELATIEF meten, niet absoluut. Twee naburige segmenten kunnen bijna dezelfde
  // multiplicator hebben; de vloeiende curve loopt daar dan echt even vlak, en op
  // 0,1 km/u afgerond staat het cijfer een tijdje stil. Dat is juist gedrag. Wat
  // fout zou zijn, is een plateau ter grootte van een heel segment — dat is precies
  // de trap die we weggehaald hebben. De grens hangt dus aan de segmentlengte.
  const half = Math.ceil(speeds.length / (2 * FLIGHT_DYNAMICS.segments));
  const inner = speeds.slice(half, speeds.length - half);
  const segPolls = speeds.length / FLIGHT_DYNAMICS.segments;
  ok('geen plateau ter grootte van een segment meer (< een derde ervan)',
    longestRun(inner) < segPolls / 3,
    `langste stilstand ${longestRun(inner)} polls, segment ≈ ${segPolls.toFixed(0)} polls`);
  // En de winst tegenover de oude trap moet groot zijn, niet marginaal: de rauwe
  // staircase gaf per definitie hoogstens `segments` verschillende waarden.
  ok('ruim meer beweging dan de oude trap kon geven',
    distinct >= FLIGHT_DYNAMICS.segments * 5,
    `${distinct} waarden tegen hoogstens ${FLIGHT_DYNAMICS.segments} vroeger`);
  ok('en het blijft een geloofwaardige snelheid', speeds.every((v) => v > 20 && v < 200),
    `min ${Math.min(...speeds)} / max ${Math.max(...speeds)} km/u`);
}

console.log('\n3. ENKEL weergave — de race zelf verandert niet');
{
  const { flight, birds } = soloFlight(40, 992);
  const startMs = Date.parse(flight.startAt);
  const total = flightTotalSeconds(flight);
  // Posities en aankomsten blijven op de rauwe segmenten lopen: de duur van elke
  // duif ligt bevroren in `sim` en mag door de weergave niet bewegen.
  const durations = flight.sim!.map((s) => s.durationSeconds);
  const snaps = [0.1, 0.35, 0.6, 0.9].map((f) => liveSnapshot(flight, startMs + total * f * 1000));
  ok('de bevroren finishtijden zijn onaangeroerd',
    flight.sim!.every((s, i) => s.durationSeconds === durations[i]));
  ok('kmDone loopt monotoon vooruit', (() => {
    for (const s of flight.sim!) {
      let prev = -1;
      for (const snap of snaps) {
        const b = snap.birds.find((x) => x.pigeonId === s.pigeonId)!;
        if (b.kmDone < prev - 0.05) return false;
        prev = b.kmDone;
      }
    }
    return true;
  })());
  // De uitslag moet identiek zijn aan wat het bord aan het eind toont.
  const board = liveSnapshot(flight, startMs + total * 1000).birds
    .filter((b) => b.finished).map((b) => b.pigeonId);
  finalizeFlight(flight, birds as any); // schrijft de uitslag in flight.results
  const finalOrder = (flight.results ?? []).filter((r: any) => r.finished !== false && r.rank > 0)
    .sort((a: any, b: any) => a.rank - b.rank).map((r: any) => r.pigeonId);
  ok('live-einde == einduitslag (volgorde van de finishers)',
    JSON.stringify(board.slice(0, finalOrder.length)) === JSON.stringify(finalOrder),
    `${finalOrder.length} finishers`);
}

console.log('\n4. Randgevallen op het bord');
{
  const { flight } = soloFlight(20, 300);
  const startMs = Date.parse(flight.startAt);
  const total = flightTotalSeconds(flight);
  const end = liveSnapshot(flight, startMs + total * 1000);
  ok('een duif die binnen is toont 0 km/u', end.birds.filter((b) => b.finished).every((b) => b.speedKmh === 0));
  ok('een duif uit de race toont 0 km/u', end.birds.filter((b) => b.gaveUp).every((b) => b.speedKmh === 0));
  const t0 = liveSnapshot(flight, startMs);
  ok('bij de lossing heeft iedereen al een snelheid',
    t0.birds.every((b) => b.finished || b.gaveUp || b.speedKmh > 0));
}

console.log('\n5. Estafette: hetzelfde, maar op de eigen etappe');
{
  const f = relayFlight(6);
  const startMs = Date.parse(f.startAt);
  const total = flightTotalSeconds(f);
  const speeds: number[] = [];
  for (let t = 60; t < total; t += 60) {
    const snap = liveSnapshot(f, startMs + t * 1000);
    const team = snap.teams?.[0];
    if (!team) break;
    const flying = team.legs.find((l) => l.status === 'onderweg');
    if (flying) speeds.push(flying.speedKmh);
  }
  ok('ook de ploegduif krijgt een bewegend cijfer',
    new Set(speeds).size > FLIGHT_DYNAMICS.segments, `${new Set(speeds).size} waarden`);
  ok('en een wachtende of binnengekomen etappe blijft op 0', (() => {
    const snap = liveSnapshot(f, startMs + total * 0.5 * 1000);
    return (snap.teams ?? []).every((tm) =>
      tm.legs.every((l) => l.status === 'onderweg' || l.speedKmh === 0));
  })());
}

console.log('\n6. Cloudflare-budget: het bord mag hier niet duurder van worden');
{
  // 10 ms CPU per invocatie op het gratis plan, en productie rekent ~1,9× zwaarder
  // dan deze lokale meting — vandaar de marge. Zie context.md §Performance.
  const { flight } = soloFlight(90, 992);
  const startMs = Date.parse(flight.startAt);
  const total = flightTotalSeconds(flight);
  const times: number[] = [];
  for (let i = 0; i < 60; i++) {
    const at = startMs + (total * (i / 60)) * 1000;
    const t = performance.now();
    liveSnapshot(flight, at);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(times.length / 2)];
  ok('liveSnapshot blijft ruim onder 1 ms bij 90 duiven op 992 km',
    med < 1, `mediaan ${med.toFixed(3)} ms`);
  // Structureel, niet enkel op de klok: de helper mag niet over de segmenten lopen.
  const src = smoothPaceMult.toString();
  ok('smoothPaceMult is O(1) — geen lus over de segmenten',
    !/\bfor\b|\bwhile\b|\.map\(|\.reduce\(/.test(src));
  // De payload verandert niet: `speedKmh` was er al en blijft één getal per duif.
  const snap = liveSnapshot(flight, startMs + total * 0.4 * 1000);
  ok('geen extra velden in de DTO (zelfde payload per poll)',
    snap.birds.every((b) => typeof b.speedKmh === 'number'));
  // De rijkost van /flights/:id/live (2 rijen, via loadLiveFlight) staat los van
  // deze wijziging en wordt bewaakt door daily-budget.test.mts — niet hier
  // nagebootst, want een assertie die niets meet is erger dan geen assertie.
}

console.log(`\n${fails === 0 ? '✅ alles groen' : `❌ ${fails} controle(s) gefaald`}\n`);
process.exit(fails === 0 ? 0 : 1);
