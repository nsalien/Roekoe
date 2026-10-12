/**
 * Aankondiging van samen kweken + de vergeten melding over vaccins en verzekering
 * per duif (migratie v62, core/game/news.ts), en de rechtzetting van v63 (de bots
 * doen toch niet mee). Bewaakt:
 *  - per echte speler precies twee bellen (samen kweken, verzorging per duif),
 *    geen voor bots, stabiele ids (een tweede run schrijft geen extra rij);
 *  - de bots bieden niets aan;
 *  - v63: een oud aanbod van een bot verdwijnt, dat van een speler blijft, en wie de
 *    bel van v62 al had, krijgt de rechtzetting — een nieuwe wereld niet;
 *  - wat de bellen zeggen, met de bedragen uit de config (één bron);
 *  - dataVersion staat op 63.
 *
 * Run (vanuit de repo-root): npx tsx tests/samen-kweken-news.test.mts
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { User } from '../core/schema.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import { runDataMigrations } from '../core/game/schedule.js';
import { CARE_NEWS, STUD_BOTS_NEWS, STUD_NEWS } from '../core/game/news.js';
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
const bells = (title: string) => db.notifications.filter((n) => n.title === title);

console.log('\nDe bellen van v62 (een nieuwe wereld draait v62 en v63 samen)');
db.world.dataVersion = 61;
runDataMigrations(db);
for (const news of [STUD_NEWS, CARE_NEWS]) {
  const b = bells(news.title);
  ok(b.length === humans.length && humans.every((l) => b.some((n) => n.userId === l.userId && n.id === news.id(l.userId))),
    `"${news.title}": één bel per echte speler, met een stabiele id`);
  ok(b.every((n) => !bots.some((x) => x.userId === n.userId)), '…en geen voor bots');
}
ok(bells(STUD_BOTS_NEWS.title).length === 0, 'geen rechtzetting: deze spelers lazen de oude tekst nooit');
ok(db.world.dataVersion === 63, 'dataVersion staat op 63');
ok(!db.pigeons.some((p) => activeListing(p)), 'de bots bieden niets aan');

db.world.dataVersion = 61;
runDataMigrations(db);
ok(bells(STUD_NEWS.title).length + bells(CARE_NEWS.title).length === humans.length * 2, 'een tweede run schrijft geen extra bel');

console.log('\nv63 op een wereld die v62 al had (productie)');
const at = new Date().toISOString();
const botBird = db.pigeons.find((p) => p.ownerId === bots[0].userId)!;
const myBird = db.pigeons.find((p) => p.ownerId === humans[0].userId)!;
botBird.stud = { by: botBird.ownerId, minScore: 0, minEnergy: 0, minLibido: 0, wants: 'young', at };
myBird.stud = { by: myBird.ownerId, minScore: 50, minEnergy: 30, minLibido: 30, wants: 'fee', at };
db.world.dataVersion = 62;
runDataMigrations(db);
ok(botBird.stud === null, 'het aanbod van de bot is weg');
ok(!!myBird.stud && myBird.stud.minScore === 50, 'dat van de speler blijft staan');
const fix = bells(STUD_BOTS_NEWS.title);
ok(fix.length === humans.length && humans.every((l) => fix.some((n) => n.userId === l.userId && n.id === STUD_BOTS_NEWS.id(l.userId))),
  'elke echte speler krijgt de rechtzetting, met een stabiele id');
ok(db.world.dataVersion === 63, 'dataVersion staat op 63');
db.world.dataVersion = 62;
runDataMigrations(db);
ok(bells(STUD_BOTS_NEWS.title).length === humans.length, 'een tweede run schrijft geen extra rechtzetting');

console.log('\nWat de bellen zeggen');
for (const [word, what] of [
  ['Kweek → Samen kweken', 'waar het staat'], ['de jongen wil of de vergoeding', 'de keuze bij het aanbieden'],
  ['geschatte score', 'de geschatte score'], ['enkel over het bedrag', 'dat enkel het bedrag besproken wordt'],
  ['niet gegarandeerd', 'dat een jong niet zeker is'], ['hok vol', 'het volle hok'], ['blijft thuis', 'dat de duif thuis blijft'],
] as const) ok(STUD_NEWS.body.includes(word), `samen kweken noemt ${what}`);
ok(!/computermelker|bot/i.test(STUD_NEWS.body), 'samen kweken zegt niet meer dat de bots meedoen');
ok(STUD_NEWS.body.includes(`€${STUD.cost}`) && STUD_NEWS.body.includes(`€${studFailedRefund()}`), `bedragen uit STUD (€${STUD.cost}, €${studFailedRefund()})`);
for (const [word, what] of [['computermelkers doen toch niet mee', 'dat de bots niet meedoen'], ['echte spelers', 'met wie het wel kan'],
  ['niets voor', 'dat een gestopte onderhandeling niets kostte'], ['maakt het gewoon af', 'dat een lopend nest doorgaat']] as const) {
  ok(STUD_BOTS_NEWS.body.includes(word), `de rechtzetting noemt ${what}`);
}
for (const [word, what] of [['pagina van elke duif', 'waar het staat'], ['vaccin', 'de vaccins'], ['Verzeker', 'de verzekering'], ['Dagbalans', 'waar de premie staat']] as const) {
  ok(CARE_NEWS.body.includes(word), `verzorging per duif noemt ${what}`);
}
ok(CARE_NEWS.body.includes(`${Math.round(INSURANCE.payoutRate * 100)} %`) && CARE_NEWS.body.includes(`${INSURANCE.waitingDays} dagen`),
  'uitkering en wachttijd uit INSURANCE');

console.log(`\n${pass} geslaagd, ${fail} mislukt`);
if (fail > 0) process.exit(1);
