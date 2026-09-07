/**
 * Regressietest: een bod dat JIJ uitbracht blijft zichtbaar en intrekbaar.
 *
 * Het faalgeval dat dit bewaakt is bijzonder stil. `/api/state` is een
 * **smal-laadpad** (`NARROW_PATHS`): bij een verse engine laadt het enkel de
 * eigen duiven + de estafetteploegen. Een bod dat jij uitbracht staat per
 * definitie op **andermans** duif, en `offersFor` controleert of die duif nog
 * van de verkoper is — dus zonder die rij viel je eigen bod stilletjes uit
 * `offers.sent`. Gevolg in het spel: "Jouw uitgebrachte biedingen" op de Markt
 * bleef leeg en de knop *Trek in* bestond niet, terwijl het bod wél gewoon in de
 * database stond en de eigenaar het kon aanvaarden.
 *
 * ⚠️ Het knipperde ook nog: een POST (volle load) toonde het bod wél, een
 * doorgethrottelde poll niet. Zo leest het als een spookbug in plaats van een
 * ontbrekende rij.
 *
 * Draai: npx tsx offer-visibility.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from './core/d1.js';
import { makeOffer, offersFor, respondOffer, withdrawOffer } from './core/game/offers.js';
import type { Database, Loft, Pigeon } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
};

const WEEK = 400;
const bird = (id: string, owner: string, name: string): Pigeon => ({
  id, ownerId: owner, name, sex: 'duivin', birthWeek: WEEK - 60,
  speed: 70, endurance: 70, orientation: 70, libido: 60, form: 85, health: 90,
  experience: 10, sireId: null, damId: null, forSale: false, price: null, minBid: null,
  createdAtWeek: WEEK - 60, ailment: null, inInfirmary: false, races: 3,
  everAiled: false, coached: false, ration: 'normal', compartment: false,
  hungerDays: 0, restDays: 0, genes: { speed: 88, endurance: 88, orientation: 88 },
  declineRate: 1,
} as unknown as Pigeon);

const loft = (userId: string, name: string, isBot = false): Loft => ({
  userId, name, money: 50000, food: { normal: 50, premium: 0, libido: 0, herstel: 0 },
  feedRation: 'normal', capacity: 20, compartments: 0, seasonPoints: 0, totalWins: 0,
  isBot, infirmaryCapacity: 2, medicatedFood: false, doctors: 0, physios: 0, xp: 0, level: 1,
  stats: { entries: 0, wins: 0, gold: 0, silver: 0, bronze: 0, babies: 0, cures: 0, curesSevere: 0, bets: 0, betsWon: 0, broods: 0, trades: 0, races: 0, buys: 0, sells: 0 },
  badges: [], missions: [], missionsDay: '', streak: 0, awards: [],
} as unknown as Loft);

function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  const prepare = (q: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...a: unknown[]) { bound.push(...a); return api; },
      async first() { return sql.prepare(q).get(...(bound as any[])) ?? null; },
      async all() { return { results: sql.prepare(q).all(...(bound as any[])) }; },
      run() { return sql.prepare(q).run(...(bound as any[])); },
    };
    return api;
  };
  return {
    prepare, async exec(q: string) { sql.exec(q); },
    async batch(s: any[]) { for (const x of s) x.run(); }, _raw: sql,
  } as any;
}

const NOW = Date.now();
const user = (id: string, isBot = false) => ({
  id, username: id, passwordHash: 'x', isAdmin: false, isBot,
  createdAt: new Date(NOW).toISOString(),
});

async function freshWorld() {
  const d1 = fakeD1();
  d1._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  let done = await ensureSchema(d1);
  if (!done) {
    d1._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,1)').run();
    let g = 0; while (!done && g++ < 40) done = await ensureSchema(d1);
  }
  const seed = await D1Store.load(d1, 'anna');
  seed.mutate((w: Database) => {
    w.world.seeded = true;
    w.world.dataVersion = 47;
    // Engine "vers" → een leespoll op /state wordt effectief versmald.
    w.world.lastAdvance = new Date(NOW).toISOString();
    w.users.push(user('anna'), user('bert'), user('cesar'));
    w.lofts.push(loft('anna', 'Hok Anna'), loft('bert', 'Hok Bert'), loft('cesar', 'Hok Cesar'));
    w.pigeons.push(
      bird('p_anna', 'anna', 'Anna-duif'),
      bird('p_bert', 'bert', 'Bert-duif'),
      bird('p_cesar', 'cesar', 'Cesar-duif'),
    );
  });
  await seed.persist();
  return d1;
}

/** Precies wat de middleware doet voor GET /api/state bij een verse engine. */
const statePoll = (d1: any, viewer: string) =>
  D1Store.load(d1, viewer, { narrowWhenIdle: true, nowMs: NOW + 1000 });

// --- 1. Het gemelde geval ---------------------------------------------------
console.log('\nJe eigen bod overleeft een smalle poll');
{
  const d1 = await freshWorld();
  const s = await D1Store.load(d1, 'anna');
  ok('een bod uitbrengen lukt', s.mutate((w) => makeOffer(w, 'anna', 'p_bert', 3000)) === null);
  await s.persist();

  const poll = await statePoll(d1, 'anna');
  ok('de load is effectief versmald (anders test dit niets)', poll.narrowed);
  const mine = offersFor(poll.data, 'anna');
  ok('het bod staat in offers.sent', mine.sent.length === 1, `${mine.sent.length}`);
  ok('  met het juiste bedrag en de juiste duif',
    mine.sent[0]?.amount === 3000 && mine.sent[0]?.pigeonId === 'p_bert',
    JSON.stringify(mine.sent[0]));
  ok('  en de naam van de verkoper, voor de regel op de Markt',
    mine.sent[0]?.toUserName === 'Hok Bert', mine.sent[0]?.toUserName);
  // ⚠️ De vreemde duif hoort erbij te zijn — dát is de eigenlijke fix.
  ok('de duif waarop geboden is, is meegeladen',
    poll.data.pigeons.some((p) => p.id === 'p_bert'),
    poll.data.pigeons.map((p) => p.id).join(','));

  const full = await D1Store.load(d1, 'anna');
  ok('en een volle load geeft exact hetzelfde (geen knipperend bod)',
    JSON.stringify(offersFor(full.data, 'anna').sent) === JSON.stringify(mine.sent));
}

// --- 2. Intrekken zolang het niet aanvaard is -------------------------------
console.log('\nIntrekken kan zolang het bod openstaat');
{
  const d1 = await freshWorld();
  const s = await D1Store.load(d1, 'anna');
  s.mutate((w) => makeOffer(w, 'anna', 'p_bert', 3000));
  await s.persist();
  const offerId = offersFor((await D1Store.load(d1, 'anna')).data, 'anna').sent[0].id;

  const w1 = await D1Store.load(d1, 'anna');
  ok('intrekken lukt', w1.mutate((w) => withdrawOffer(w, 'anna', offerId)) === null);
  await w1.persist();

  const poll = await statePoll(d1, 'anna');
  ok('  het bod is weg uit offers.sent', offersFor(poll.data, 'anna').sent.length === 0);
  ok('  en ook echt uit de DATABASE', (d1._raw.prepare('SELECT * FROM offers').all() as any[]).length === 0);
  const bert = await statePoll(d1, 'bert');
  ok('  Bert ziet het ook niet meer staan', offersFor(bert.data, 'bert').received.length === 0);
  ok('  geen geld verplaatst', poll.data.lofts.find((l) => l.userId === 'anna')!.money === 50000);
}

// --- 3. Andermans bod trek je niet in ---------------------------------------
console.log('\nJe trekt alleen je EIGEN bod in');
{
  const d1 = await freshWorld();
  const s = await D1Store.load(d1, 'anna');
  s.mutate((w) => makeOffer(w, 'anna', 'p_bert', 3000));
  await s.persist();
  const offerId = offersFor((await D1Store.load(d1, 'anna')).data, 'anna').sent[0].id;

  const c = await D1Store.load(d1, 'cesar');
  ok('Cesar kan Anna\'s bod niet intrekken',
    c.mutate((w) => withdrawOffer(w, 'cesar', offerId)) === 'Dit bod bestaat niet (meer)');
  ok('  en de verkoper zelf evenmin — hij weigert het, hij trekt het niet in',
    (await D1Store.load(d1, 'bert')).mutate((w) => withdrawOffer(w, 'bert', offerId)) !== null);
  ok('  het bod staat er nog', offersFor((await statePoll(d1, 'anna')).data, 'anna').sent.length === 1);
}

// --- 4. Na aanvaarden valt er niets meer in te trekken ----------------------
console.log('\nEen aanvaard bod is geen openstaand bod meer');
{
  const d1 = await freshWorld();
  const s = await D1Store.load(d1, 'anna');
  s.mutate((w) => makeOffer(w, 'anna', 'p_bert', 3000));
  await s.persist();
  const offerId = offersFor((await D1Store.load(d1, 'anna')).data, 'anna').sent[0].id;

  const b = await D1Store.load(d1, 'bert');
  ok('Bert aanvaardt', b.mutate((w) => respondOffer(w, 'bert', offerId, true)) === null);
  await b.persist();

  const poll = await statePoll(d1, 'anna');
  ok('  het bod verdwijnt uit offers.sent', offersFor(poll.data, 'anna').sent.length === 0);
  ok('  de duif is van Anna', poll.data.pigeons.find((p) => p.id === 'p_bert')?.ownerId === 'anna');
  ok('  intrekken kan niet meer',
    poll.mutate((w) => withdrawOffer(w, 'anna', offerId)) === 'Dit bod bestaat niet (meer)');
}

// --- 5. Meerdere biedingen, en andermans bod lekt niet ----------------------
console.log('\nMeerdere biedingen tegelijk, elk bij de juiste speler');
{
  const d1 = await freshWorld();
  const s = await D1Store.load(d1, 'anna');
  s.mutate((w) => {
    makeOffer(w, 'anna', 'p_bert', 3000);
    makeOffer(w, 'anna', 'p_cesar', 4500);
  });
  await s.persist();
  const c = await D1Store.load(d1, 'cesar');
  c.mutate((w) => makeOffer(w, 'cesar', 'p_anna', 900));
  await c.persist();

  const poll = await statePoll(d1, 'anna');
  const mine = offersFor(poll.data, 'anna');
  ok('Anna ziet haar twee uitgebrachte biedingen', mine.sent.length === 2, `${mine.sent.length}`);
  ok('  beide duiven zijn meegeladen',
    ['p_bert', 'p_cesar'].every((id) => poll.data.pigeons.some((p) => p.id === id)));
  ok('  en het bod ÓP haar duif staat bij "ontvangen"', mine.received.length === 1);
  ok('  Anna ziet Cesars bod op Berts duif niet', !mine.sent.some((o) => o.fromUserName === 'Hok Cesar'));

  const cesarPoll = await statePoll(d1, 'cesar');
  const his = offersFor(cesarPoll.data, 'cesar');
  ok('Cesar ziet enkel zijn eigen bod', his.sent.length === 1 && his.sent[0].pigeonId === 'p_anna');
  ok('  en het bod dat hij ontving', his.received.length === 1 && his.received[0].amount === 4500);
}

// --- 6. Een bod op een duif die intussen verkocht is ------------------------
console.log('\nEen bod op een duif die niet meer van de verkoper is, verdwijnt');
{
  const d1 = await freshWorld();
  const s = await D1Store.load(d1, 'anna');
  s.mutate((w) => makeOffer(w, 'anna', 'p_bert', 3000));
  await s.persist();
  // Simuleer een verkoop die de offer-rij (om welke reden ook) liet staan.
  const t = await D1Store.load(d1, 'anna');
  t.mutate((w) => { w.pigeons.find((p) => p.id === 'p_bert')!.ownerId = 'cesar'; });
  await t.persist();

  const poll = await statePoll(d1, 'anna');
  ok('het weesbod wordt niet getoond', offersFor(poll.data, 'anna').sent.length === 0);
  // ⚠️ Dit is de controle die de fix eerlijk houdt: de duif is geladen, dus de
  // eigenaarscheck kán draaien. Zonder de geladen rij zou hij "toevallig" ook
  // niets tonen, en dan bewaakt deze test niets.
  ok('  en dat komt van de eigenaarscheck, niet van een ontbrekende rij',
    poll.data.pigeons.some((p) => p.id === 'p_bert'));
}

console.log(`\n${pass} geslaagd, ${fail} gefaald\n`);
process.exit(fail === 0 ? 0 : 1);
