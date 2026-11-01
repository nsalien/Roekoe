/**
 * Migratie v53: de sponsors die bij de start van seizoen 3 opstapten, komen terug.
 *
 * De seizoensbeoordeling liet sponsors vertrekken wie minder dan 60 % van zijn
 * punten van vorig seizoen haalde. Dat was te streng; v53 zet die contracten
 * terug. Wat de test bewaakt:
 *  - enkel de sponsors die EXACT bij de wissel vertrokken komen terug, niet een
 *    sponsor die de speler zelf weigerde of opzegde;
 *  - ze komen terug op hun catalogusvoorwaarden, zonder nieuw tekengeld, met de
 *    gemiste dagbedragen bijbetaald;
 *  - `refPoints` is leeg, zodat ze aan het einde van dit seizoen niet meteen
 *    opnieuw kunnen opstappen;
 *  - heeft de speler intussen een concurrent in dezelfde categorie getekend, dan
 *    komt de oude niet terug (één per categorie);
 *  - één melding per speler, en een tweede run doet niets.
 *
 * Run: npx tsx tests/sponsor-restore.test.mts
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase, emptySponsorState } from '../core/schema.js';
import type { User, Loft } from '../core/schema.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import { runSeasonEnd } from '../core/game/season.js';
import { runDataMigrations } from '../core/game/schedule.js';
import { activeContracts } from '../core/game/sponsors.js';
import { SPONSORS } from '../core/config/gameConfig.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const store = new MemoryStore(emptyDatabase());
seedWorld(store);
const db = store.data;
const mk = (name: string): Loft => {
  const u: User = { id: newId('usr'), username: name, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
  store.mutate((d) => d.users.push(u));
  return createLoftForUser(store, u, name);
};

// Three sponsors in three different categories, plus a rival for the first one.
const cafe = SPONSORS.filter((s) => s.category === 'cafe');
const [A, rivalOfA] = [cafe[0], cafe[1]];
const B = SPONSORS.find((s) => s.category === 'bank')!;
const C = SPONSORS.find((s) => s.category === 'telecom')!;
const R = SPONSORS.find((s) => s.category === 'slagerij')!; // refused by the player himself

const alice = mk('alice'); // loses A and B at the rollover, keeps C
const bob = mk('bob'); // loses A, then signs its rival before the fix
for (const l of [alice, bob]) l.sponsorship = emptySponsorState();

const contract = (id: string, daily: number, podium: number, refPoints: number | undefined) =>
  ({ id, since: '2026-09-01T00:00:00.000Z', dailyStipend: daily, podiumBase: podium, refPoints });

// Alice: A signed on a re-offer (scaled terms), B on catalogue terms, C too new for a verdict.
alice.sponsorship!.active = [
  contract(A.id, A.dailyStipend + 10, A.podiumBase + 10, 200),
  contract(B.id, B.dailyStipend, B.podiumBase, 200),
  contract(C.id, C.dailyStipend, C.podiumBase, 10), // below minReviewPoints → no verdict
];
alice.sponsorship!.signed = [A.id, B.id, C.id, R.id];
alice.sponsorship!.declined = [{ id: R.id, at: '2026-09-20T10:00:00.000Z', perf: 1 }];
alice.seasonPoints = 50; // < 60 % of 200
bob.sponsorship!.active = [contract(A.id, A.dailyStipend, A.podiumBase, 200)];
bob.sponsorship!.signed = [A.id];
bob.seasonPoints = 50;

// The rollover, exactly as tickSeason does it.
const season = db.world.seasonYear;
const atMs = Date.parse('2026-09-26T13:00:00.000Z');
runSeasonEnd(db, season, atMs);
db.world.seasonYear = season + 1;
db.world.seasonStartedAt = new Date(atMs).toISOString();

console.log('\n1. De strenge beoordeling (uitgangspunt)');
ok(!activeContracts(alice).some((c) => c.def.id === A.id || c.def.id === B.id), 'alice verloor A en B bij de wissel');
ok(activeContracts(alice).some((c) => c.def.id === C.id), 'alice hield C (te nieuw voor een oordeel)');
ok(!activeContracts(bob).some((c) => c.def.id === A.id), 'bob verloor A');

// Bob signs A's rival in the meantime.
bob.sponsorship!.active.push(contract(rivalOfA.id, rivalOfA.dailyStipend, rivalOfA.podiumBase, undefined));

// One midnight passed since the rollover.
db.world.lastDailyTick = '2026-09-26T22:00:00.000Z';
db.world.dataVersion = 52;
const moneyBefore = alice.money;
const bobMoneyBefore = bob.money;

runDataMigrations(db);

console.log('\n2. Migratie v53');
const aliceA = activeContracts(alice).find((c) => c.def.id === A.id);
const aliceB = activeContracts(alice).find((c) => c.def.id === B.id);
ok(!!aliceA && !!aliceB, 'A en B staan weer onder contract bij alice');
ok(!!aliceB && aliceB.contract.dailyStipend === B.dailyStipend && aliceB.contract.podiumBase === B.podiumBase,
  `B komt terug op dezelfde voorwaarden (€${B.dailyStipend}/dag)`);
ok(!!aliceA && aliceA.contract.dailyStipend === A.dailyStipend,
  'A (getekend op een heraanbod) komt terug op de catalogusvoorwaarden — de oude voorwaarden waren niet bewaard');
ok([aliceA, aliceB].every((c) => c && c.contract.refPoints === undefined),
  'refPoints is leeg: ze kunnen op het einde van dit seizoen niet opnieuw opstappen');
ok(activeContracts(alice).filter((c) => c.def.id === C.id).length === 1, 'C staat er nog, en maar één keer');
ok(!alice.sponsorship!.declined.some((d) => d.id === A.id || d.id === B.id), 'A en B staan niet meer bij de geweigerden');
ok(alice.sponsorship!.declined.some((d) => d.id === R.id), 'de sponsor die alice zelf weigerde, blijft geweigerd');
ok(!activeContracts(alice).some((c) => c.def.id === R.id), '...en komt dus niet terug');
ok(alice.money - moneyBefore === A.dailyStipend + B.dailyStipend,
  `één gemiste dag bijbetaald: €${alice.money - moneyBefore} (geen nieuw tekengeld)`);
const note = db.notifications.find((n) => n.id === `ntf:sponsorrestore:${alice.userId}`);
ok(!!note && note.body.includes(A.name) && note.body.includes(B.name), 'alice krijgt één melding met beide sponsors');

ok(!activeContracts(bob).some((c) => c.def.id === A.id), 'bob tekende intussen een concurrent: A komt niet terug');
ok(activeContracts(bob).some((c) => c.def.id === rivalOfA.id), '...en zijn nieuwe sponsor blijft');
ok(bob.money === bobMoneyBefore, 'bob krijgt dus ook geen bijbetaling');
ok(!db.notifications.some((n) => n.id === `ntf:sponsorrestore:${bob.userId}`), 'en geen melding');
ok(db.world.dataVersion! >= 53, 'dataVersion staat op 53');

console.log('\n3. Een tweede run doet niets');
const again = alice.money;
runDataMigrations(db);
ok(alice.money === again && activeContracts(alice).filter((c) => c.def.id === A.id).length === 1, 'geen dubbele sponsor, geen dubbele bijbetaling');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
