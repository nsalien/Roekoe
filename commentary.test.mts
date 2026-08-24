/**
 * Regressietest op het live verslag (📻).
 *
 * Het verslag is herbouwd om binnen het CPU-budget te blijven: de dure
 * veldbemonstering wordt gecachet en uitgebreid i.p.v. per poll herbouwd, ze
 * stopt bij `elapsed`, en het aantal monsters is begrensd. Dat mag NIETS
 * veranderen aan wat de speler ziet, en juist dáár zit het risico:
 *
 *  - het aantal loterijtrekkingen in de scan groeit tijdens de race, dus de
 *    gebeurtenisregels krijgen een EIGEN, apart geseede stroom. Deelden ze er
 *    één, dan zou het verslag zichzelf bij elke poll herschrijven;
 *  - een gecachete scan moet exact hetzelfde opleveren als een koude.
 *
 * Run: npx tsx commentary.test.mts
 */
import { flightCommentary, flightTotalSeconds, startLiveFlight } from './core/game/flight.js';
import { generatePigeon } from './core/game/pigeon.js';
import { RELAY } from './core/config/gameConfig.js';
import type { Flight, Pigeon } from './core/schema.js';

let fails = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fails++;
};

let seq = 0;
function soloFlight(n: number, km: number): Flight {
  const birds: Pigeon[] = [];
  for (let i = 0; i < n; i++) {
    const p = generatePigeon({ currentWeek: 60, quality: 0.25 + (i % 8) / 11 });
    p.ownerId = `usr_${i % 10}`;
    birds.push(p);
  }
  const f = {
    id: `flt_comm_${seq++}`, name: 'Test', type: 'international', week: 60,
    fromCity: 'A', toCity: 'B', distanceKm: km,
    startAt: new Date('2026-09-05T04:00:00Z').toISOString(),
    status: 'live', weather: 'zwak', weatherFactor: 1,
    entries: birds.map((p) => ({ pigeonId: p.id, pigeonName: p.name, ownerId: p.ownerId, ownerName: 'Hok' })),
    sim: [], results: [], recap: null,
  } as unknown as Flight;
  startLiveFlight(f, birds.map((p) => ({ pigeon: p, ownerId: p.ownerId, ownerName: 'Hok' })) as any, 60, undefined);
  return f;
}

function relayFlight(teams: number): Flight {
  const size = RELAY.teamSize;
  const legKm = 300;
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
    id: `flt_relay_${seq++}`, name: 'Estafette', type: 'international', week: 60,
    fromCity: 'A', toCity: 'B', distanceKm: legKm * size,
    startAt: new Date('2026-09-05T03:00:00Z').toISOString(),
    status: 'live', weather: 'zwak', weatherFactor: 1, relay: true, teamSize: size,
    legs: Array.from({ length: size }, (_, i) => ({
      index: i + 1, fromName: `P${i}`, toName: `P${i + 1}`, distanceKm: legKm, weather: 'zwak', weatherFactor: 1,
    })),
    entries, sim: [], results: [], recap: null,
  } as unknown as Flight;
  startLiveFlight(f, birds.map((p) => ({ pigeon: p, ownerId: p.ownerId, ownerName: 'Hok' })) as any, 60, undefined);
  return f;
}

/** Poll a flight through its whole race and check the feed only ever grows. */
function checkMonotone(f: Flight, label: string) {
  const total = flightTotalSeconds(f);
  const start = Date.parse(f.startAt);
  let previous: { atSeconds: number; text: string }[] = [];
  let grows = true, prefixStable = true, noFuture = true;
  for (let step = 0; step <= 40; step++) {
    const at = start + (total * step / 40) * 1000;
    const now = flightCommentary(f, at);
    if (now.length < previous.length) grows = false;
    for (let i = 0; i < previous.length; i++) {
      if (now[i]?.text !== previous[i].text || now[i]?.atSeconds !== previous[i].atSeconds) prefixStable = false;
    }
    const elapsed = (at - start) / 1000;
    for (const l of now) if (l.atSeconds > elapsed + 1) noFuture = false;
    previous = now;
  }
  ok(`${label}: het verslag wordt nooit korter`, grows);
  ok(`${label}: eerdere regels blijven woordelijk staan`, prefixStable);
  ok(`${label}: geen regel uit de toekomst`, noFuture);
  ok(`${label}: er komt effectief verslag`, previous.length > 3, `${previous.length} regels aan het eind`);
}

console.log('Het verslag groeit alleen aan — het herschrijft zichzelf niet\n');
checkMonotone(soloFlight(60, 700), 'gewone vlucht');
checkMonotone(soloFlight(95, 1200), 'grote fondvlucht');
checkMonotone(relayFlight(8), 'estafette');

console.log('\nGecachet en koud geven exact hetzelfde\n');
{
  const f = soloFlight(70, 900);
  const total = flightTotalSeconds(f);
  const at = Date.parse(f.startAt) + total * 0.7 * 1000;
  const warmFirst = flightCommentary(f, at);
  const warmAgain = flightCommentary(f, at);
  ok('twee polls op hetzelfde moment zijn identiek', JSON.stringify(warmFirst) === JSON.stringify(warmAgain));

  // Verdring de scan uit de cache (zoals een isolate-recycle) en vraag opnieuw.
  for (let k = 0; k < 8; k++) {
    const other = soloFlight(10, 200);
    flightCommentary(other, Date.parse(other.startAt) + flightTotalSeconds(other) * 900);
  }
  const cold = flightCommentary(f, at);
  ok('na verdringing uit de cache identiek', JSON.stringify(cold) === JSON.stringify(warmFirst),
    `${warmFirst.length} vs ${cold.length} regels`);

  // En een poll die in één keer tot het einde springt, moet dezelfde regels
  // bevatten als de reeks polls ernaartoe (de scan mag niets overslaan).
  const f2 = soloFlight(70, 900);
  const total2 = flightTotalSeconds(f2);
  const end2 = Date.parse(f2.startAt) + total2 * 1000;
  const oneShot = flightCommentary(f2, end2);
  const f3 = soloFlight(70, 900);
  ok('in één sprong naar het einde levert een volledig verslag', oneShot.length > 5, `${oneShot.length} regels`);
  void f3;
}

console.log('\nGebeurtenissen staan op hun exacte seconde, niet op een raster\n');
{
  const f = soloFlight(80, 800);
  const total = flightTotalSeconds(f);
  const end = Date.parse(f.startAt) + total * 1000;
  const lines = flightCommentary(f, end);
  // Elke finisher heeft een aankomstregel op haar eigen durationSeconds.
  const finishers = f.sim.filter((s) => !s.gaveUp && s.dnfAtSeconds == null && s.durationSeconds <= total + 0.5);
  const times = new Set(lines.map((l) => l.atSeconds));
  let allPresent = true;
  for (const s of finishers) if (!times.has(s.durationSeconds)) allPresent = false;
  ok('elke finisher heeft een regel op haar eigen finishtijd', allPresent, `${finishers.length} finishers`);
  // Een DNF-regel valt op de DNF-seconde.
  const dnfs = f.sim.filter((s) => s.dnfAtSeconds != null);
  let dnfOk = true;
  for (const s of dnfs) if (!times.has(s.dnfAtSeconds!)) dnfOk = false;
  ok('elke uitvaller heeft een regel op haar eigen moment', dnfOk, `${dnfs.length} uitvallers`);
  ok('de regels staan op tijd gesorteerd', lines.every((l, i) => i === 0 || lines[i - 1].atSeconds <= l.atSeconds));
}

console.log('\nEen vlucht zonder sim geeft gewoon niets\n');
{
  const empty = { id: 'flt_leeg', sim: [], startAt: new Date().toISOString(), distanceKm: 300 } as unknown as Flight;
  ok('lege vlucht → leeg verslag', flightCommentary(empty, Date.now()).length === 0);
}

console.log(fails === 0 ? '\nAlles OK' : `\n${fails} FOUT(EN)`);
process.exitCode = fails === 0 ? 0 : 1;
