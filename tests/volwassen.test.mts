/**
 * Volwassen — een duif wordt in je hok 8 weken (RACE_AGE_WEEKS) en mag
 * vliegen: de motor onthoudt het moment (care.grownUpAt, core/game/grownup.ts), de
 * client geeft er één keer een feestje voor (GrownUpCelebration.tsx).
 *
 * Gedekt: de echte dagovergang markeert een duif die 8 weken wordt, één keer, met de
 * middernacht als tijdstip; een oudere duif, een bot en een duif van 7 weken niet; de
 * knop "Volgende week" van de beheerder ook; enkel de eigenaar ziet het; bij verkoop
 * verdwijnt het; de Layout toont het feestje en onthoudt het per toestel.
 *
 * Run: npx tsx tests/volwassen.test.mts
 */
import { readFileSync } from 'node:fs';
import { RACE_AGE_WEEKS } from '../core/config/gameConfig.js';
import { advanceWeek, buyPigeon, createLoftForUser, listForSale, seedWorld } from '../core/game/engine.js';
import { advanceRealtime } from '../core/game/schedule.js';
import { markGrownUp } from '../core/game/grownup.js';
import { ageInWeeks } from '../core/game/pigeon.js';
import { pigeonDTO } from '../core/presenters.js';
import { MemoryStore } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { User } from '../core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const DAY = 86400000;
const T = Date.parse('2026-11-04T20:00:00+01:00');

const store = new MemoryStore(emptyDatabase());
seedWorld(store);
advanceRealtime(store.data, T, new Map());
const db = store.data;
for (const id of ['usr_a', 'usr_b']) {
  const u: User = { id, username: id, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T).toISOString() };
  store.mutate((d) => d.users.push(u));
  const loft = createLoftForUser(store, u, `Hok ${id}`);
  loft.money = 100_000;
}
const week0 = db.world.currentWeek;
const mineA = db.pigeons.filter((p) => p.ownerId === 'usr_a');
const [young, older, seven] = mineA;
young.birthWeek = week0 - (RACE_AGE_WEEKS - 1); // turns 8 at the next game week
older.birthWeek = week0 - 30;                    // long grown
seven.birthWeek = week0 - (RACE_AGE_WEEKS - 2);  // still a week to go after that
const botBird = db.pigeons.find((p) => db.lofts.find((l) => l.userId === p.ownerId)?.isBot)!;
botBird.birthWeek = week0 - (RACE_AGE_WEEKS - 1);

console.log('\n1. De dagovergang');
let t = T;
while (db.world.currentWeek === week0 && t < T + 5 * DAY) {
  t += DAY;
  for (let i = 0; i < 12; i++) advanceRealtime(db, t + i * 1000, new Map());
}
ok(db.world.currentWeek === week0 + 1, `een speelweek verder (week ${db.world.currentWeek})`);
ok(ageInWeeks(young, db.world.currentWeek) === RACE_AGE_WEEKS && !!young.care?.grownUpAt, `de duif van 7 weken is nu 8 en gemarkeerd (${young.care?.grownUpAt})`);
ok(new Date(young.care!.grownUpAt!).getUTCMinutes() === 0 && Date.parse(young.care!.grownUpAt!) <= t, 'met de middernacht als tijdstip (stabiel bij gelijktijdige verzoeken)');
ok(!older.care?.grownUpAt, 'een duif die al lang volwassen is: niets');
ok(!seven.care?.grownUpAt, 'een duif die nog 7 weken is: nog niets');
ok(!botBird.care?.grownUpAt, 'een botduif: niets');
const first = young.care!.grownUpAt;
markGrownUp(db, db.world.currentWeek, t + DAY);
ok(young.care!.grownUpAt === first, 'één keer: een tweede run verandert het tijdstip niet');

console.log('\n2. De knop "Volgende week" van de beheerder');
advanceWeek(store);
ok(ageInWeeks(seven, db.world.currentWeek) === RACE_AGE_WEEKS && !!seven.care?.grownUpAt, 'de volgende duif wordt 8 weken en is gemarkeerd');

console.log('\n3. Enkel de eigenaar, en weg bij verkoop');
ok(pigeonDTO(db, young, 'usr_a').grownUpAt === first, 'de eigenaar ziet het');
ok(pigeonDTO(db, young, 'usr_b').grownUpAt === null && pigeonDTO(db, young).grownUpAt === null, 'een ander (of geen kijker) niet');
{
  const ask = Math.max(500, pigeonDTO(db, young, 'usr_a').minPrice ?? 0);
  const sold = listForSale(store, 'usr_a', young.id, ask) === null && buyPigeon(store, 'usr_b', young.id) === null;
  ok(sold && young.ownerId === 'usr_b' && !young.care?.grownUpAt, 'verkocht: de nieuwe eigenaar krijgt geen feestje voor een duif die al volwassen was');
}

console.log('\n4. De client');
{
  const layout = readFileSync('./client/src/components/Layout.tsx', 'utf8');
  const party = readFileSync('./client/src/components/GrownUpCelebration.tsx', 'utf8');
  const css = readFileSync('./client/src/styles/global.css', 'utf8');
  ok(layout.includes('<GrownUpCelebration') && layout.includes('roekoe.grownSeen.'), 'de Layout toont het feestje en onthoudt het per toestel');
  ok(party.includes('is volwassen!') && party.includes('Vliegklaar') && party.includes("navigate('/vluchten')"), 'het feestje: de naam, VLIEGKLAAR, en meteen naar Vluchten');
  ok(/prefers-reduced-motion[\s\S]*grown-chick/.test(css), 'met minder beweging: enkel het eindbeeld');
}

console.log(`\n${pass} geslaagd, ${fail} mislukt`);
process.exit(fail > 0 ? 1 : 0);
