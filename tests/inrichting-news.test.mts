/**
 * Aankondiging van de hokinrichting & co (migratie v61, core/game/news.ts). Bewaakt:
 *  - precies één bel per echte speler, geen voor bots, stabiele id (een tweede
 *    run schrijft geen extra rij);
 *  - de bel noemt alle vier de nieuwigheden en de prijs/duur van het zoekertje
 *    komt uit MARKET_BOOST (één bron);
 *  - dataVersion staat op 61.
 *
 * Run (vanuit de repo-root): npx tsx tests/inrichting-news.test.mts
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { User } from '../core/schema.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import { runDataMigrations } from '../core/game/schedule.js';
import { INRICHTING_NEWS } from '../core/game/news.js';
import { MARKET_BOOST } from '../core/config/gameConfig.js';

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

console.log('\nDe bel van v61');
db.world.dataVersion = 60;
runDataMigrations(db);
const bells = db.notifications.filter((n) => n.title === INRICHTING_NEWS.title);
ok(bells.length === humans.length, `één bel per echte speler (${bells.length} voor ${humans.length})`);
ok(humans.every((l) => bells.some((n) => n.userId === l.userId && n.id === INRICHTING_NEWS.id(l.userId))), 'stabiele id per speler');
const bots = new Set(db.lofts.filter((l) => l.isBot).map((l) => l.userId));
ok(bots.size > 0 && bells.every((n) => !bots.has(n.userId)), 'geen bel voor bots');
ok(db.world.dataVersion === 61, 'dataVersion staat op 61');

db.world.dataVersion = 60;
runDataMigrations(db);
ok(db.notifications.filter((n) => n.title === INRICHTING_NEWS.title).length === humans.length, 'een tweede run schrijft geen extra bel');

console.log('\nWat de bel zegt');
const body = INRICHTING_NEWS.body;
for (const [word, what] of [['Inrichting', 'de pagina Inrichting'], ['hokoverzicht', 'het hokoverzicht'], ['zoekertje', 'het zoekertje naar boven'], ['Besmetting gaat nu per ziekte', 'de besmetting per ziekte'], ['verzekering', 'de verzekering'], ['vakblad', 'het vakblad'], ['Niets kopen', 'dat niets kopen het oude spel is']] as const) {
  ok(body.includes(word), `noemt ${what}`);
}
ok(body.includes(`€${MARKET_BOOST.cost}`) && body.includes(`${MARKET_BOOST.hours} uur`), `prijs en duur van het zoekertje komen uit MARKET_BOOST (€${MARKET_BOOST.cost}, ${MARKET_BOOST.hours} uur)`);

console.log(`\n${pass} geslaagd, ${fail} mislukt`);
if (fail > 0) process.exit(1);
