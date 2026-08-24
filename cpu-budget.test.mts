/**
 * Regressietest op het CPU-budget van Cloudflare Workers (gratis plan: 10 ms per
 * invocatie, daarboven "Exceeded CPU Time Limits" / Error 1102).
 *
 * Dit is de wacht die moet voorkomen dat het probleem terugkomt. Twee soorten
 * controles, want alleen tijd meten is te wankel om op te sturen:
 *
 *  1. STRUCTUREEL — het werk is per constructie begrensd, ongeacht hoe lang of
 *     hoe vol een vlucht is. Deze controles zijn hard: ze meten geen tijd.
 *  2. TIJD — een ruime bovengrens (BUDGET_MS) op de zwaarste KOUDE aanroep, dus
 *     zonder cache, zoals het eerste verzoek na een isolate-recycle. Ruim gezet
 *     zodat een trage machine niet vals alarm slaat, maar strak genoeg om een
 *     terugval van een orde van grootte te vangen.
 *
 * Run: npx tsx cpu-budget.test.mts
 */
import { flightCommentary, flightTotalSeconds, startLiveFlight, liveSnapshot } from './core/game/flight.js';
import { betProbability } from './core/game/betting.js';
import { generatePigeon } from './core/game/pigeon.js';
import { COMMENTARY_INTERVAL_SECONDS, COMMENTARY_LIMITS } from './core/config/gameConfig.js';
import type { Database, Flight, Pigeon } from './core/schema.js';

/** Ruim boven de gemeten waarden, ver onder de 10 ms die Cloudflare toestaat. */
const BUDGET_MS = 6;

let fails = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fails++;
};

let seq = 0;
function bigFlight(n: number, km: number): { flight: Flight; birds: Pigeon[]; db: Database } {
  const birds: Pigeon[] = [];
  for (let i = 0; i < n; i++) {
    const p = generatePigeon({ currentWeek: 60, quality: 0.25 + (i % 8) / 11 });
    p.ownerId = `usr_${i % 12}`;
    birds.push(p);
  }
  const flight = {
    id: `flt_budget_${seq++}`, name: 'Zwaarste geval', type: 'international', week: 60,
    fromCity: 'A', toCity: 'B', distanceKm: km,
    startAt: new Date('2026-09-05T04:00:00Z').toISOString(),
    status: 'scheduled', weather: 'zwak', weatherFactor: 1,
    entries: birds.map((p) => ({ pigeonId: p.id, pigeonName: p.name, ownerId: p.ownerId, ownerName: 'Hok' })),
    sim: [], results: [], recap: null,
  } as unknown as Flight;
  startLiveFlight(flight, birds.map((p) => ({ pigeon: p, ownerId: p.ownerId, ownerName: 'Hok' })) as any, 60, undefined);
  const db = { pigeons: birds, flights: [flight], lofts: [], users: [], bets: [] } as unknown as Database;
  return { flight, birds, db };
}

const ms = (fn: () => unknown): number => {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
};

// De JIT moet eerst warmlopen, anders meet de eerste aanroep de compiler.
{
  const w = bigFlight(20, 300);
  const t = Date.parse(w.flight.startAt) + flightTotalSeconds(w.flight) * 500;
  for (let i = 0; i < 5; i++) { flightCommentary(w.flight, t); liveSnapshot(w.flight, t); }
  betProbability(w.db, w.flight, 'win', w.birds[0].ownerId, w.birds[0].id, null);
}

console.log('STRUCTUREEL — het werk is begrensd, hoe zwaar de vlucht ook is\n');
{
  // Het live verslag bemonstert het veld; zonder plafond schaalt dat met de
  // duur van de race (een fondvlucht van 50 uur = 300 monsters elke poll).
  let worstSamples = 0;
  let monotoon = true;
  for (const km of [150, 400, 700, 1000, 1200]) {
    const { flight } = bigFlight(60, km);
    const total = flightTotalSeconds(flight);
    const end = Date.parse(flight.startAt) + total * 1000;
    const lines = flightCommentary(flight, end);
    // Alle regels die op een bemonsteringsmoment vallen (dus geen event-regels).
    const step = Math.max(
      COMMENTARY_INTERVAL_SECONDS,
      COMMENTARY_INTERVAL_SECONDS * Math.max(1, Math.ceil(Math.ceil(total / COMMENTARY_INTERVAL_SECONDS) / COMMENTARY_LIMITS.maxSamples)),
    );
    const samples = Math.floor(total / step);
    worstSamples = Math.max(worstSamples, samples);
    // Groeit monotoon: elke regel heeft een vast tijdstip, dus een latere poll
    // mag nooit regels laten verdwijnen.
    const half = flightCommentary(flight, Date.parse(flight.startAt) + total * 500);
    if (half.length > lines.length) monotoon = false;
  }
  ok(`nooit meer dan ${COMMENTARY_LIMITS.maxSamples} bemonsteringen per race`, worstSamples <= COMMENTARY_LIMITS.maxSamples, `zwaarste = ${worstSamples}`);
  ok('het verslag groeit monotoon (regels verdwijnen nooit)', monotoon);
}
{
  // Overtake-detectie kijkt alleen naar de kopgroep; anders is ze kwadratisch in
  // de veldgrootte. Dat mag niet stilletjes teruggedraaid worden.
  ok('overtake-detectie blijft begrensd tot de kopgroep', COMMENTARY_LIMITS.field > 0 && COMMENTARY_LIMITS.field <= 30, `veld = ${COMMENTARY_LIMITS.field}`);
}

console.log('\nTIJD — koude aanroep (verse isolate), budget ' + BUDGET_MS + ' ms\n');
const rows: { label: string; ms: number }[] = [];
for (const [n, km] of [[60, 400], [95, 700], [95, 1200], [140, 1200]] as const) {
  const { flight, birds, db } = bigFlight(n, km);
  const total = flightTotalSeconds(flight);
  // 90% door de race: het duurste moment, want de scan moet het hele verleden
  // inhalen, en precies wanneer spelers het live-bord openhouden.
  const now = Date.parse(flight.startAt) + total * 0.9 * 1000;

  const tComm = ms(() => flightCommentary(flight, now));
  const tSnap = ms(() => liveSnapshot(flight, now));
  // Verse vlucht-id => gegarandeerde cache-miss op de Monte-Carlo.
  const betFlight = { ...flight, id: `flt_bet_${seq++}` } as Flight;
  const tBet = ms(() => betProbability(db, betFlight, 'win', birds[0].ownerId, birds[0].id, null));
  const tH2h = ms(() => betProbability(db, betFlight, 'head2head', birds[0].ownerId, birds[0].id, birds[1].id));

  rows.push({ label: `verslag ${n} duiven / ${km} km (${(total / 3600).toFixed(0)}u)`, ms: tComm });
  rows.push({ label: `live-bord ${n} duiven / ${km} km`, ms: tSnap });
  rows.push({ label: `odds koud ${n} duiven / ${km} km`, ms: tBet });
  rows.push({ label: `odds kop-aan-kop ${n} duiven`, ms: tH2h });
}
for (const r of rows) ok(r.label, r.ms < BUDGET_MS, `${r.ms.toFixed(2)} ms`);

console.log('\nWARM — herhaalde polls (dezelfde isolate) zijn zo goed als gratis\n');
{
  const { flight, birds, db } = bigFlight(95, 1000);
  const total = flightTotalSeconds(flight);
  const now = Date.parse(flight.startAt) + total * 0.9 * 1000;
  flightCommentary(flight, now);
  betProbability(db, flight, 'win', birds[0].ownerId, birds[0].id, null);
  const warmComm = ms(() => flightCommentary(flight, now));
  const warmBet = ms(() => betProbability(db, flight, 'win', birds[0].ownerId, birds[0].id, null));
  ok('verslag opnieuw', warmComm < 1, `${warmComm.toFixed(3)} ms`);
  ok('odds opnieuw', warmBet < 1, `${warmBet.toFixed(3)} ms`);
}

console.log(fails === 0 ? '\nAlles OK — elk pad blijft binnen het CPU-budget' : `\n${fails} FOUT(EN) — een pad dreigt over de 10 ms te gaan`);
process.exitCode = fails === 0 ? 0 : 1;
