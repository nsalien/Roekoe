/**
 * De harde regel: een duif vliegt HOOGSTENS ÉÉN vlucht per kalenderdag (§3.9).
 *
 * Vroeger gold die regel maar half: ze blokkeerde enkel zolang de andere race
 * van die dag nog BEZIG was. Een duif die 's ochtends binnenkwam, mocht 's
 * middags gewoon opnieuw starten. Dat kan niet meer — de dag is op zodra ze
 * ergens ingeschreven staat, of die race nu nog moet beginnen, loopt, of allang
 * uitgevlogen is.
 *
 * De test dekt de vier gevallen die er in de praktijk toe doen:
 *   1. tweede inschrijving op dezelfde dag wordt geweigerd (vlucht nog gepland);
 *   2. ook nadat de eerste vlucht helemaal AFGEROND is (de oude gatenkaas);
 *   3. uitschrijven geeft de dag wél terug, en een afgelaste vlucht telt niet mee;
 *   4. een vlucht op een ANDERE dag blijft gewoon toegelaten.
 * En tot slot: de bots houden zich aan exact dezelfde regel.
 *
 * Run: npx tsx one-flight-per-day.test.mts
 */
import { MemoryStore, newId } from './core/store.js';
import { emptyDatabase } from './core/schema.js';
import { seedWorld, createLoftForUser, enterFlight, withdrawFlight } from './core/game/engine.js';
import { advanceRealtime, tickFlights } from './core/game/schedule.js';
import { flightDay } from './core/game/flight.js';
import type { Database, Flight, User } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const T0 = Date.parse('2026-08-24T04:00:00Z');

function buildWorld(): { store: MemoryStore; db: Database; userId: string } {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  let userId = '';
  for (let i = 0; i < 3; i++) {
    const u: User = {
      id: newId('usr'), username: `speler${i}`, passwordHash: 'x',
      isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString(),
    };
    store.mutate((d) => d.users.push(u));
    createLoftForUser(store, u, `Hok ${i}`);
    if (i === 0) userId = u.id;
  }
  advanceRealtime(store.data, T0);
  return { store, db: store.data, userId };
}

/** Two plain competition flights on the SAME calendar day, in start order. */
function sameDayPair(db: Database): [Flight, Flight] {
  const plain = db.flights
    .filter((f) => f.status === 'scheduled' && !f.ageCat && !f.relay && !f.titan)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  for (const a of plain) {
    const b = plain.find((x) => x.id !== a.id && flightDay(x) === flightDay(a) && x.startAt > a.startAt);
    if (b) return [a, b];
  }
  throw new Error('geen twee geplande vluchten op dezelfde dag gevonden');
}

console.log('\n=== 1. Twee vluchten op één dag: de tweede wordt geweigerd ===');
{
  const { store, db, userId } = buildWorld();
  const [f1, f2] = sameDayPair(db);
  const bird = db.pigeons.find((p) => p.ownerId === userId && enterFlight(store, userId, f1.id, p.id) === null);
  ok(!!bird, `duif ingeschreven voor ${f1.name} (${f1.startAt.slice(11, 16)})`);
  const err = enterFlight(store, userId, f2.id, bird!.id);
  ok(err != null && err.includes('één vlucht per dag'), `tweede vlucht diezelfde dag geweigerd: "${err}"`);
  ok(!f2.entries.some((e) => e.pigeonId === bird!.id), 'ze staat ook echt niet op de tweede vlucht');

  console.log('\n=== 4. Een vlucht op een ANDERE dag mag wel ===');
  const other = db.flights.find(
    (f) => f.status === 'scheduled' && !f.ageCat && !f.relay && !f.titan && flightDay(f) !== flightDay(f1),
  );
  ok(!!other, `er staat ook een vlucht op een andere dag gepland (${other?.name})`);
  ok(enterFlight(store, userId, other!.id, bird!.id) === null, 'diezelfde duif mag daar wél starten');
}

console.log('\n=== 2. Ook ná het afronden van de eerste vlucht blijft de dag op ===');
{
  const { store, db, userId } = buildWorld();
  const [f1, f2] = sameDayPair(db);
  // Iedereen inschrijven, anders wordt f1 afgelast wegens te weinig melkers.
  const mine: string[] = [];
  for (const loft of db.lofts.filter((l) => !l.isBot)) {
    for (const p of db.pigeons.filter((x) => x.ownerId === loft.userId)) {
      if (enterFlight(store, loft.userId, f1.id, p.id) === null) {
        if (loft.userId === userId) mine.push(p.id);
        break;
      }
    }
  }
  const bird = mine[0]!;
  const startMs = Date.parse(f1.startAt);
  tickFlights(db, startMs + 1000);                // lossing
  tickFlights(db, startMs + 2000, undefined, f1.id); // forceer de afronding
  ok(f1.status === 'completed' && f1.sim.length > 0, `${f1.name} is uitgevlogen en afgerond`);
  ok(Date.parse(f2.startAt) > startMs && f2.status === 'scheduled', `${f2.name} staat diezelfde dag nog gepland`);
  // Deze duif kan van haar ochtendvlucht gewond of ziek zijn thuisgekomen — dat is
  // een gewone uitkomst, maar dan weigert `canRace` haar vóór de dagregel eraan
  // toekomt en meet dit blok iets anders dan het beweert. Even opknappen, zodat
  // enkel de één-vlucht-per-dag-regel de weigering kan veroorzaken.
  {
    const p = db.pigeons.find((x) => x.id === bird)!;
    p.ailment = null;
    p.inInfirmary = false;
    p.health = Math.max(p.health, 80);
    p.form = Math.max(p.form, 50);
  }
  const err = enterFlight(store, userId, f2.id, bird);
  ok(err != null && err.includes('één vlucht per dag'),
     `een duif die vanochtend gevlogen heeft, mag 's middags niet opnieuw: "${err}"`);
}

console.log('\n=== 3. Uitschrijven geeft de dag terug; een afgelaste vlucht telt niet ===');
{
  const { store, db, userId } = buildWorld();
  const [f1, f2] = sameDayPair(db);
  const bird = db.pigeons.find((p) => p.ownerId === userId && enterFlight(store, userId, f1.id, p.id) === null)!;
  ok(withdrawFlight(store, userId, f1.id, bird.id) === null, `weer uitgeschreven voor ${f1.name}`);
  ok(enterFlight(store, userId, f2.id, bird.id) === null, 'de dag is vrij: ze mag nu de tweede vlucht doen');

  // Een vlucht die wordt afgelast (geen sim, geen uitslag) heeft nooit gevlogen.
  f2.status = 'completed';
  f2.weather = 'Afgelast (te weinig deelnemers)';
  f2.results = [];
  ok(enterFlight(store, userId, f1.id, bird.id) === null,
     'na een AFGELASTE vlucht mag ze diezelfde dag gewoon nog starten');
}

console.log('\n=== 5. De bots volgen dezelfde regel ===');
{
  const { db } = buildWorld();
  // Een week doorspoelen zodat de bots zich vol inschrijven op elke vlucht.
  for (let t = T0; t <= T0 + 7 * 86400000; t += 3600000) advanceRealtime(db, t);
  const perDay = new Map<string, Map<string, number>>();
  for (const f of db.flights) {
    const day = perDay.get(flightDay(f)) ?? new Map<string, number>();
    perDay.set(flightDay(f), day);
    for (const e of f.entries) day.set(e.pigeonId, (day.get(e.pigeonId) ?? 0) + 1);
  }
  let doubles = 0, checked = 0;
  for (const day of perDay.values()) for (const n of day.values()) { checked++; if (n > 1) doubles++; }
  ok(checked > 0, `${checked} duif-dagen nagekeken over ${perDay.size} kalenderdagen`);
  ok(doubles === 0, `geen enkele duif staat twee keer op één dag ingeschreven (${doubles} gevonden)`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald\n`);
process.exit(fail === 0 ? 0 : 1);
