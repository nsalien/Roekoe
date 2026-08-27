/**
 * De admin-knop "Match beëindigen" (POST /admin/flights/:id/finish).
 *
 * Een fondvlucht loopt door tot de TRAAGSTE duif binnen is (§3.3) — soms uren,
 * meestal achter twee bots aan. De beheerder kan zo'n vlucht daarom vroeger
 * afronden. Dat mag echter NOOIT de uitslag veranderen: de hele race wordt bij
 * de lossing in `flight.sim` bevroren, dus alle plaatsen, punten, prijzengeld,
 * verbeteringen en blessures liggen op dat moment al vast.
 *
 * De test draait dezelfde bevroren vlucht twee keer:
 *   pad A — gewoon uitvliegen tot de laatste duif binnen is;
 *   pad B — de koplopers zijn al binnen en hun prijzengeld is al gestort
 *           (payFinishedFlightPrizes), en dán drukt de beheerder op de knop.
 * Pad B is het echte scenario, en meteen het gevaarlijkste: daar zou een tweede
 * uitbetaling kunnen sluipen.
 *
 * De vlucht wordt geïsoleerd (alle andere vluchten uit de wereld gehaald) zodat
 * enkel déze race het verschil kan maken — anders vergelijk je ook de vluchten
 * die de kalender intussen zelf gestart is.
 *
 * Run: npx tsx force-finish.test.mts
 */
import { MemoryStore, newId } from './core/store.js';
import { emptyDatabase } from './core/schema.js';
import { seedWorld, createLoftForUser, enterFlight } from './core/game/engine.js';
import { advanceRealtime, tickFlights, tickFlightEnergy, payFinishedFlightPrizes } from './core/game/schedule.js';
import { flightTotalSeconds } from './core/game/flight.js';
import type { Database, User } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const T0 = Date.parse('2026-08-24T06:00:00Z');

/** A world with one live competition flight — every other flight removed. */
function buildWorld(): { db: Database; flightId: string; startMs: number } {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  for (let i = 0; i < 4; i++) {
    const u: User = { id: newId('usr'), username: `speler${i}`, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString() };
    store.mutate((d) => d.users.push(u));
    createLoftForUser(store, u, `Hok ${i}`);
  }
  advanceRealtime(store.data, T0);
  const db = store.data;
  const flight = db.flights.find((f) => f.status === 'scheduled' && !f.practice && !f.relay);
  if (!flight) throw new Error('geen geplande wedstrijdvlucht gevonden');
  for (const loft of db.lofts.filter((l) => !l.isBot)) {
    for (const p of db.pigeons.filter((x) => x.ownerId === loft.userId).slice(0, 3)) {
      try { enterFlight(store, loft.userId, flight.id, p.id); } catch { /* not race-ready */ }
    }
  }
  const startMs = Date.parse(flight.startAt);
  advanceRealtime(db, startMs + 1000);
  // Isolate: only this flight may move from here on.
  db.flights = db.flights.filter((f) => f.id === flight.id);
  return { db, flightId: flight.id, startMs };
}

const clone = (db: Database): Database => JSON.parse(JSON.stringify(db));

/** Run the live-race ticks (energie drain + early prize payouts) up to `until`. */
function runLive(db: Database, from: number, until: number) {
  for (let t = from; t <= until; t += 15 * 60000) {
    tickFlightEnergy(db, t);
    payFinishedFlightPrizes(db, t);
  }
  tickFlightEnergy(db, until);
  payFinishedFlightPrizes(db, until);
}

const base = buildWorld();
const liveFlight = base.db.flights.find((f) => f.id === base.flightId)!;
ok(liveFlight.status === 'live', `de vlucht staat live (${liveFlight.entries.length} duiven, ${liveFlight.distanceKm} km)`);
const total = flightTotalSeconds(liveFlight);
ok(total > 0, `de traagste duif doet er ${(total / 3600).toFixed(1)} uur over`);

// --- Pad A: gewoon uitvliegen -------------------------------------------
const endMs = base.startMs + total * 1000 + 1000;
const dbA = clone(base.db);
runLive(dbA, base.startMs, endMs);
tickFlights(dbA, endMs);

// --- Pad B: koplopers al binnen én uitbetaald, dan pas afgerond ----------
const dbB = clone(base.db);
const lateMs = base.startMs + Math.round(total * 0.85) * 1000;
runLive(dbB, base.startMs, lateMs);
const paidEarly = dbB.flights.find((f) => f.id === base.flightId)!.sim.filter((s) => s.prizePaid).length;
ok(paidEarly > 0, `bij 85% van de race is er al prijzengeld gestort aan ${paidEarly} duiven`);
tickFlights(dbB, lateMs, undefined, base.flightId);

const fA = dbA.flights.find((f) => f.id === base.flightId)!;
const fB = dbB.flights.find((f) => f.id === base.flightId)!;

ok(fA.status === 'completed' && fB.status === 'completed', 'beide paden: de vlucht is afgerond');
ok(fB.results.length === fA.results.length && fB.results.length > 0, `even veel duiven in de uitslag (${fB.results.length})`);

const key = (r: (typeof fA.results)[number]) => `${r.pigeonId}|${r.rank}|${r.points}|${r.prize}|${r.velocity}|${r.finished}`;
const sortRes = (f: typeof fA) => f.results.map(key).sort().join('\n');
ok(sortRes(fA) === sortRes(fB), 'uitslag identiek (plaats, punten, prijzengeld, snelheid, gefinisht)');

ok(dbA.pigeons.length === dbB.pigeons.length, `evenveel duiven over (${dbB.pigeons.length}) — niemand geëlimineerd`);

let moneyEqual = true, moneyDetail = '';
for (const la of dbA.lofts) {
  const lb = dbB.lofts.find((l) => l.userId === la.userId)!;
  if (la.money !== lb.money) { moneyEqual = false; moneyDetail = `${la.name}: A €${la.money} vs B €${lb.money}`; }
}
ok(moneyEqual, `geld in elk hok gelijk — geen dubbele uitbetaling${moneyEqual ? '' : ' — ' + moneyDetail}`);

let ptsEqual = true;
for (const la of dbA.lofts) {
  const lb = dbB.lofts.find((l) => l.userId === la.userId)!;
  if (la.seasonPoints !== lb.seasonPoints) ptsEqual = false;
}
ok(ptsEqual, 'seizoenspunten per hok gelijk');

let pigEqual = true, pigDetail = '';
for (const pa of dbA.pigeons) {
  const pb = dbB.pigeons.find((p) => p.id === pa.id);
  if (!pb) { pigEqual = false; pigDetail = `${pa.name} ontbreekt in B`; break; }
  const shot = (p: typeof pa) => [p.form, p.health, p.endurance, p.speed, p.orientation, p.experience, p.ailment?.name ?? '-'].join('/');
  if (shot(pa) !== shot(pb)) { pigEqual = false; pigDetail = `${pa.name}: A ${shot(pa)} vs B ${shot(pb)}`; break; }
}
ok(pigEqual, `elke duif identiek (energie/gezondheid/conditie/skills/aandoening)${pigEqual ? '' : ' — ' + pigDetail}`);

// De energie moet volledig afgerekend zijn, niet blijven staan op de 85%.
const drainedOk = fB.results.every((r) => {
  const before = base.db.pigeons.find((p) => p.id === r.pigeonId)!;
  const after = dbB.pigeons.find((p) => p.id === r.pigeonId)!;
  return after.form <= before.form;
});
ok(drainedOk, 'vroeg afronden rekent de volledige vluchtenergie af (niet enkel het gevlogen deel)');

// Nog een keer klikken op een afgeronde vlucht mag niets meer doen.
const dbC = clone(dbB);
const before = JSON.stringify(dbC.flights.find((f) => f.id === base.flightId));
const moneyBefore = dbC.lofts.map((l) => l.money).join(',');
tickFlights(dbC, lateMs + 60000, undefined, base.flightId);
ok(
  JSON.stringify(dbC.flights.find((f) => f.id === base.flightId)) === before && dbC.lofts.map((l) => l.money).join(',') === moneyBefore,
  'een tweede klik op een al afgeronde vlucht doet niets (idempotent, geen extra geld)',
);

// Zonder force-id blijft een lopende vlucht gewoon lopen.
const dbD = clone(base.db);
tickFlights(dbD, lateMs);
ok(dbD.flights.find((f) => f.id === base.flightId)!.status === 'live', 'zonder force-id blijft de vlucht gewoon live');

// Een force-id die niet bestaat raakt niets aan.
const dbE = clone(base.db);
tickFlights(dbE, lateMs, undefined, 'bestaat-niet');
ok(dbE.flights.find((f) => f.id === base.flightId)!.status === 'live', 'een onbekende force-id doet niets');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
