/**
 * Regressietest: een duif die niet kan vliegen, vliegt niet.
 *
 * Twee gaten die hier ooit zaten, allebei stil:
 *
 *  1. `enterFlight` liet je een duif inschrijven terwijl ze OP DAT MOMENT nog in
 *     de lucht hing op een andere vlucht. Je weet dan niet wanneer ze thuis is —
 *     of ze überhaupt thuis komt, want ze kan dagen verdwaald blijven (LOST).
 *     De client verborg haar wel, de API niet.
 *  2. Bij de lossing werd de deelnemerslijst gewoon overgenomen, zonder te kijken
 *     of die duiven nog konden vliegen. Inschrijven gebeurt dagen vooraf, dus een
 *     duif kon intussen verdwaald, ziek, gewond of op rustkuur zijn — en werd dan
 *     alsnog gelost. Een duif die officieel vermist was, vloog een tweede race.
 *
 * Draai: npx tsx flight-eligibility.test.mts
 */
import { MemoryStore } from './core/store.js';
import { startLiveFlight, type Entry } from './core/game/flight.js';
import { enterFlight } from './core/game/engine.js';
import { tickFlights } from './core/game/schedule.js';
import { REST_CURE } from './core/config/gameConfig.js';
import type { Flight, Pigeon, SimEntry, Database, Loft } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
};

const WEEK = 400;
const NOW = Date.now();

const bird = (id: string, owner = 'u1'): Pigeon => ({
  id, ownerId: owner, name: id, sex: 'doffer', birthWeek: WEEK - 60,
  speed: 70, endurance: 70, orientation: 70, libido: 70, form: 85, health: 92,
  experience: 55, sireId: null, damId: null, forSale: false, price: null,
  createdAtWeek: WEEK - 60, ailment: null, inInfirmary: false, races: 20,
  everAiled: false, coached: false, ration: 'normal', compartment: false,
  hungerDays: 0, restDays: 0, genes: { speed: 95, endurance: 95, orientation: 95 },
  declineRate: 1, trainedAt: {},
} as unknown as Pigeon);

const loft = (userId: string, name: string): Loft => ({
  userId, name, money: 50000, food: { normal: 100, premium: 0, libido: 0, herstel: 0 },
  feedRation: 'normal', capacity: 20, compartments: 0, seasonPoints: 0, totalWins: 0,
  isBot: false, infirmaryCapacity: 4, medicatedFood: false, doctors: 0, physios: 0,
  xp: 0, level: 1,
  stats: { entries: 0, wins: 0, gold: 0, silver: 0, bronze: 0, babies: 0, cures: 0, curesSevere: 0, bets: 0, betsWon: 0, broods: 0, trades: 0, races: 0 },
  badges: [], missions: [], missionsDay: '', streak: 0, awards: [],
} as unknown as Loft);

function world() {
  const pigeons = [
    bird('onderweg'), bird('verdwaalde'), bird('zieke'), bird('gekwetste'),
    bird('opkuur'), bird('koppelaar'), bird('gezonde'), bird('rivaal', 'u2'), bird('rivaal2', 'u2'),
  ];
  // Een fondvlucht die NU bezig is; 'onderweg' hangt er nog in de lucht.
  const fond = {
    id: 'flt_fond', name: 'Fondvlucht', type: 'international', fromCity: 'A', toCity: 'B',
    distanceKm: 1100, startAt: new Date(NOW - 3600_000).toISOString(), status: 'scheduled',
    entries: [{ pigeonId: 'onderweg', ownerId: 'u1' }], results: [], sim: [], entryFee: 40, week: WEEK,
  } as unknown as Flight;
  const e: Entry[] = [{ pigeon: pigeons[0], ownerName: 'Hok 1' }];
  startLiveFlight(fond, e, WEEK, { label: 't', factor: 1 } as never);

  const morgen = {
    id: 'flt_morgen', name: 'Vlucht morgen', type: 'regional', fromCity: 'C', toCity: 'D',
    distanceKm: 150, startAt: new Date(NOW + 86400_000).toISOString(), status: 'scheduled',
    entries: [], results: [], sim: [], entryFee: 10, week: WEEK,
  } as unknown as Flight;

  const db = {
    world: { currentWeek: WEEK, dataVersion: 42, lastDailyTick: new Date(NOW).toISOString() },
    users: [{ id: 'u1', username: 'ik', isBot: false }, { id: 'u2', username: 'ander', isBot: false }],
    lofts: [loft('u1', 'Hok 1'), loft('u2', 'Hok 2')],
    pigeons, flights: [fond, morgen], breedingPairs: [], trades: [], auctions: [],
    bets: [], offers: [], notifications: [],
  } as unknown as Database;
  return { db, fond, morgen, store: new MemoryStore(db) };
}

// --- 1. Inschrijven terwijl ze nog in de lucht hangt -----------------------
console.log('\nInschrijven terwijl haar vorige race nog loopt');
{
  const { db, fond, store } = world();
  const s = (fond.sim as SimEntry[])[0];
  ok('de testduif hangt echt nog in de lucht (rit > 1 u)', s.durationSeconds > 3600,
    `${(s.durationSeconds / 3600).toFixed(1)} u`);

  const res = enterFlight(store, 'u1', 'flt_morgen', 'onderweg');
  ok('een duif die nog vliegt kan NIET ingeschreven worden', res !== null, `kreeg: ${res}`);
  ok('de melding legt uit waaróm', (res ?? '').includes('onderweg'), res ?? '');

  // Zodra haar eigen race erop zit (opgegeven) mag het wél — dat is §3.8.
  s.gaveUp = true; s.gaveUpAtSeconds = 60;
  ok('zodra ze opgegeven heeft, mag ze wél voor een andere dag ingeschreven worden',
    enterFlight(store, 'u1', 'flt_morgen', 'onderweg') === null);
  ok('en dan staat ze ook echt op die vlucht',
    db.flights.find((f) => f.id === 'flt_morgen')!.entries.some((x) => x.pigeonId === 'onderweg'));
}

// --- 2. Bij de lossing valt af wie niet kan vliegen ------------------------
console.log('\nBij de lossing');
{
  const { db, morgen } = world();
  const P = (id: string) => db.pigeons.find((p) => p.id === id)!;
  P('verdwaalde').awayUntil = new Date(NOW + 3 * 86400_000).toISOString();
  P('zieke').ailment = { kind: 'ziekte', name: 'Ornithose', severity: 'matig', description: '', sinceWeek: WEEK } as never;
  P('gekwetste').ailment = { kind: 'kwetsuur', name: 'Verstuikte vleugel', severity: 'matig', description: '', sinceWeek: WEEK } as never;
  P('opkuur').cureUntil = new Date(NOW + REST_CURE.durationHours * 3600_000).toISOString();
  db.breedingPairs.push({ id: 'bp1', ownerId: 'u1', sireId: 'koppelaar', damId: 'gezonde2', startedAt: new Date().toISOString() } as never);

  for (const id of ['onderweg', 'verdwaalde', 'zieke', 'gekwetste', 'opkuur', 'koppelaar', 'gezonde']) {
    morgen.entries.push({ pigeonId: id, ownerId: 'u1' } as never);
  }
  morgen.entries.push({ pigeonId: 'rivaal', ownerId: 'u2' } as never);
  const moneyBefore = db.lofts[0].money;

  morgen.startAt = new Date(NOW - 1000).toISOString();
  tickFlights(db, NOW, undefined);

  ok('de vlucht gaat door', morgen.status === 'live', morgen.status);
  const flying = new Set((morgen.sim as SimEntry[]).map((x) => x.pigeonId));
  for (const id of ['onderweg', 'verdwaalde', 'zieke', 'gekwetste', 'opkuur', 'koppelaar']) {
    ok(`  '${id}' wordt NIET gelost`, !flying.has(id));
  }
  ok(`  'gezonde' vliegt gewoon mee`, flying.has('gezonde'));
  ok(`  'rivaal' vliegt gewoon mee`, flying.has('rivaal'));

  const refunded = db.lofts[0].money - moneyBefore;
  ok('elke geschrapte duif krijgt haar inschrijfgeld terug', refunded === 6 * morgen.entryFee,
    `€${refunded} i.p.v. €${6 * morgen.entryFee}`);
  ok('de speler krijgt per geschrapte duif een melding',
    db.notifications.filter((n) => n.id.startsWith('ntf:grounded:flt_morgen:')).length === 6,
    `${db.notifications.filter((n) => n.id.startsWith('ntf:grounded:')).length} meldingen`);
  ok('de geschrapte duiven staan ook niet meer in de deelnemerslijst',
    morgen.entries.every((e) => ['gezonde', 'rivaal'].includes(e.pigeonId)));
}

// --- 3. De vlucht wordt afgelast als er te weinig melkers overblijven ------
console.log('\nAls er door het schrappen te weinig melkers overblijven');
{
  const { db, morgen } = world();
  db.pigeons.find((p) => p.id === 'verdwaalde')!.awayUntil = new Date(NOW + 3 * 86400_000).toISOString();
  morgen.entries.push(
    { pigeonId: 'verdwaalde', ownerId: 'u1' } as never,
    { pigeonId: 'rivaal', ownerId: 'u2' } as never,
  );
  const before = [db.lofts[0].money, db.lofts[1].money];
  morgen.startAt = new Date(NOW - 1000).toISOString();
  tickFlights(db, NOW, undefined);

  ok('de vlucht wordt afgelast (nog maar één melker over)', morgen.status === 'completed', morgen.status);
  ok('de geschrapte duif is terugbetaald', db.lofts[0].money === before[0] + morgen.entryFee);
  ok('de overgebleven melker krijgt zijn inschrijfgeld ook terug', db.lofts[1].money === before[1] + morgen.entryFee);
}

// --- 4. Idempotent: een tweede tick verandert niets ------------------------
console.log('\nIdempotentie');
{
  const { db, morgen } = world();
  db.pigeons.find((p) => p.id === 'zieke')!.ailment = { kind: 'ziekte', name: 'X', severity: 'licht', description: '', sinceWeek: WEEK } as never;
  morgen.entries.push(
    { pigeonId: 'zieke', ownerId: 'u1' } as never,
    { pigeonId: 'gezonde', ownerId: 'u1' } as never,
    { pigeonId: 'rivaal', ownerId: 'u2' } as never,
    { pigeonId: 'rivaal2', ownerId: 'u2' } as never,
  );
  morgen.startAt = new Date(NOW - 1000).toISOString();
  tickFlights(db, NOW, undefined);
  const money = db.lofts[0].money;
  const notes = db.notifications.length;
  tickFlights(db, NOW + 1000, undefined);
  ok('een tweede tick betaalt niet nog eens terug', db.lofts[0].money === money);
  ok('en stuurt geen tweede melding', db.notifications.length === notes);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
