/**
 * Aankondiging van samen kweken + de vergeten melding over vaccins en verzekering
 * per duif (migratie v62, core/game/news.ts). Bewaakt:
 *  - per echte speler precies twee bellen (samen kweken, verzorging per duif),
 *    geen voor bots, stabiele ids (een tweede run schrijft geen extra rij);
 *  - de bots bieden meteen een duif aan;
 *  - wat de bellen zeggen, met de bedragen uit de config (één bron);
 *  - dataVersion staat op 62.
 *
 * Run (vanuit de repo-root): npx tsx tests/samen-kweken-news.test.mts
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { User } from '../core/schema.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import { runDataMigrations } from '../core/game/schedule.js';
import { CARE_NEWS, STUD_NEWS } from '../core/game/news.js';
import { activeListing } from '../core/game/stud.js';
import { INSURANCE, STUD, studFailedRefund } from '../core/config/gameConfig.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const store = new MemoryStore(emptyDatabase());
seedWorld(store);
const db = store.data;
const humans = ['anna', 'bert'].map((name) => {
  const u: User = { id: newId('usr'), username: name, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
  store.mutate((d) => d.users.push(u));
  return createLoftForUser(store, u, name);
});
const bots = db.lofts.filter((l) => l.isBot);
// Old enough and good enough birds, so a bot has something to put up.
for (const p of db.pigeons) {
  if (!bots.some((b) => b.userId === p.ownerId)) continue;
  p.birthWeek = db.world.currentWeek - 60;
  p.speed = p.endurance = p.orientation = 62;
}

console.log('\nDe bellen van v62');
db.world.dataVersion = 61;
runDataMigrations(db);
for (const news of [STUD_NEWS, CARE_NEWS]) {
  const bells = db.notifications.filter((n) => n.title === news.title);
  ok(bells.length === humans.length && humans.every((l) => bells.some((n) => n.userId === l.userId && n.id === news.id(l.userId))),
    `"${news.title}": één bel per echte speler, met een stabiele id`);
  ok(bells.every((n) => !bots.some((b) => b.userId === n.userId)), '…en geen voor bots');
}
ok(db.world.dataVersion === 62, 'dataVersion staat op 62');
const listedBots = bots.filter((b) => db.pigeons.some((p) => p.ownerId === b.userId && activeListing(p)));
ok(listedBots.length === bots.length, `de bots bieden meteen een duif aan (${listedBots.length} van ${bots.length})`);

db.world.dataVersion = 61;
runDataMigrations(db);
ok(db.notifications.filter((n) => n.title === STUD_NEWS.title || n.title === CARE_NEWS.title).length === humans.length * 2,
  'een tweede run schrijft geen extra bel');
ok(db.pigeons.filter((p) => activeListing(p)).length === listedBots.length, '…en geen tweede aanbod per bot');

console.log('\nWat de bellen zeggen');
for (const [word, what] of [
  ['Kweek → Samen kweken', 'waar het staat'], ['computermelkers', 'dat de bots meedoen'], ['de jongen wil of de vergoeding', 'de keuze bij het aanbieden'],
  ['geschatte score', 'de geschatte score'], ['enkel over het bedrag', 'dat enkel het bedrag besproken wordt'],
  ['niet gegarandeerd', 'dat een jong niet zeker is'], ['hok vol', 'het volle hok'], ['blijft thuis', 'dat de duif thuis blijft'],
] as const) ok(STUD_NEWS.body.includes(word), `samen kweken noemt ${what}`);
ok(STUD_NEWS.body.includes(`€${STUD.cost}`) && STUD_NEWS.body.includes(`€${studFailedRefund()}`), `bedragen uit STUD (€${STUD.cost}, €${studFailedRefund()})`);
for (const [word, what] of [['pagina van elke duif', 'waar het staat'], ['vaccin', 'de vaccins'], ['Verzeker', 'de verzekering'], ['Dagbalans', 'waar de premie staat']] as const) {
  ok(CARE_NEWS.body.includes(word), `verzorging per duif noemt ${what}`);
}
ok(CARE_NEWS.body.includes(`${Math.round(INSURANCE.payoutRate * 100)} %`) && CARE_NEWS.body.includes(`${INSURANCE.waitingDays} dagen`),
  'uitkering en wachttijd uit INSURANCE');

console.log(`\n${pass} geslaagd, ${fail} mislukt`);
if (fail > 0) process.exit(1);
