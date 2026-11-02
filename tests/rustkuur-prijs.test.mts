/**
 * De rustkuur kost €150 per duif (2 nov, eigenaar: "Verlaag de rustkuur kost naar 150
 * … en melding voor spelers"), met een bel via migratie v74.
 *
 * Gedekt: de prijs in de config en wat een kuur echt kost; elke tekst die de prijs
 * uitschrijft (spelregels §4.3, wiki, welkomstrondleiding) zegt €150; de bel: één per
 * echte speler, geen voor de bots, stabiele id, één keer, met de getallen uit REST_CURE.
 *
 * Run: npx tsx tests/rustkuur-prijs.test.mts
 */
import { readFileSync } from 'node:fs';
import { REST_CURE } from '../core/config/gameConfig.js';
import { createLoftForUser, seedWorld, startRestCure } from '../core/game/engine.js';
import { advanceRealtime } from '../core/game/schedule.js';
import { REST_CURE_PRICE_NEWS } from '../core/game/news.js';
import { MemoryStore } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { User } from '../core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

console.log('\n1. De prijs');
const store = new MemoryStore(emptyDatabase());
seedWorld(store);
const NOW = Date.now();
advanceRealtime(store.data, NOW, new Map()); // the calendar exists, as on production
const db = store.data;
const humans = ['usr_a', 'usr_b'].map((id) => {
  const u: User = { id, username: id, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(NOW).toISOString() };
  store.mutate((d) => d.users.push(u));
  createLoftForUser(store, u, `Hok ${id}`);
  return id;
});
ok(REST_CURE.cost === 150, `REST_CURE.cost = €${REST_CURE.cost}`);
{
  const loft = db.lofts.find((l) => l.userId === 'usr_a')!;
  const bird = db.pigeons.find((p) => p.ownerId === 'usr_a')!;
  bird.form = 30; bird.health = 80;
  const before = loft.money;
  const err = startRestCure(store, 'usr_a', bird.id);
  ok(err === null && loft.money === before - 150, `een rustkuur kost €150 (${err ?? 'gestart'})`);
}

console.log('\n2. Elke tekst die de prijs noemt');
{
  const rules = readFileSync('./spelregels.md', 'utf8');
  const s43 = rules.slice(rules.indexOf('### 4.3 Rustkuur'), rules.indexOf('### 4.4'));
  ok(s43.includes('**€150**') && !s43.includes('Kost **€300**'), 'spelregels §4.3: €150');
  const wiki = readFileSync('./client/src/pages/WikiPage.tsx', 'utf8');
  ok(wiki.includes('€150 voor twee volle dagen rust') && !wiki.includes('€300 voor twee volle dagen rust'), 'wiki: €150 voor twee volle dagen rust');
  const tour = readFileSync('./client/src/components/Tour.tsx', 'utf8');
  ok(tour.includes('twee dagen verplicht rusten voor €150') && !tour.includes('rusten voor €300'), 'welkomstrondleiding: twee dagen, €150');
}

console.log('\n3. De bel (migratie v74)');
{
  db.world.dataVersion = 73;
  advanceRealtime(db, NOW + 60_000, new Map());
  advanceRealtime(db, NOW + 120_000, new Map());
  ok((db.world.dataVersion ?? 0) >= 74, `de migratie liep (dataVersion ${db.world.dataVersion})`);
  const bells = db.notifications.filter((n) => n.id.startsWith('ntf:news:rustkuur150:'));
  ok(bells.length === humans.length && humans.every((u) => bells.some((n) => n.userId === u && n.id === REST_CURE_PRICE_NEWS.id(u))),
    `één bel per echte speler (${bells.length}), stabiele id, geen voor de bots`);
  ok(REST_CURE_PRICE_NEWS.title.includes('€150') && REST_CURE_PRICE_NEWS.body.includes('€150') && REST_CURE_PRICE_NEWS.body.includes('€300')
    && REST_CURE_PRICE_NEWS.body.includes(`+${REST_CURE.energy} energie`) && REST_CURE_PRICE_NEWS.body.includes(`+${REST_CURE.health} gezondheid`),
    'de bel noemt de nieuwe en de oude prijs, en wat een kuur oplevert');
}

console.log(`\n${pass} geslaagd, ${fail} mislukt`);
process.exit(fail > 0 ? 1 : 0);
