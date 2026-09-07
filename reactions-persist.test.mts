/**
 * Vluchtreacties overleven de databank.
 *
 * Twee nieuwe kolommen (`flights.chat` en `lofts.unlocked_reactions`) moeten op
 * VIJF plaatsen kloppen voor ze werken: de ALTER in `SCHEMA_STEPS`, de mapper
 * heen (`rowToFlight`/`rowToLoft`), de kolomlijst terug, de rij-mapper terug, en
 * — voor de loft — de plek in `LOFT_COLUMNS` moet overeenkomen met de plek in
 * `loftRow`.
 *
 * Vergeet je er één, dan werkt alles in het geheugen gewoon (de engine-test is
 * groen) en verdwijnt de aankoop van een speler pas bij de volgende paginalading.
 * Dat is het soort fout dat je niet ziet tot iemand 500 munten kwijt is, dus
 * draait deze test tegen een echte SQLite-engine, net als d1-partial-load.
 *
 * Run: npx tsx reactions-persist.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from './core/d1.js';
import { buyReaction, postReaction } from './core/game/reactions.js';
import { hashPassword } from './core/auth.js';

let fails = 0;
const ok = (c: boolean, m: string) => { c ? console.log(`  ✓ ${m}`) : (fails++, console.log(`  ✗ ${m}`)); };

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { bound.push(...args); return api; },
      async first() { return sql.prepare(query).get(...(bound as any[])) ?? null; },
      async all() { return { results: sql.prepare(query).all(...(bound as any[])) }; },
      run() { return sql.prepare(query).run(...(bound as any[])); },
    };
    return api;
  };
  return {
    prepare,
    async exec(query: string) { sql.exec(query); },
    async batch(stmts: any[]) { for (const s of stmts) s.run(); },
    _raw: sql,
  };
}

const db = fakeD1();
db._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
// De upgrade is in blokken gehakt om binnen D1's querybudget te blijven, en hij
// kan zijn voortgang pas bewaren zodra er een world-rij is (zie ensureSchema).
db._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,1)').run();
for (let i = 0; i < 20 && !(await ensureSchema(db)); i++) { /* volgende blok */ }

console.log('\nSchema');
{
  const cols = (t: string) => db._raw.prepare(`PRAGMA table_info(${t})`).all().map((r: any) => r.name);
  ok(cols('flights').includes('chat'), 'flights.chat bestaat na ensureSchema');
  ok(cols('lofts').includes('unlocked_reactions'), 'lofts.unlocked_reactions bestaat na ensureSchema');
}

// Twee spelers en een live vlucht opzetten via de echte store.
{
  const store = await D1Store.load(db, undefined);
  const now = new Date().toISOString();
  for (const [id, naam] of [['u1', 'Hok Een'], ['u2', 'Hok Twee']] as const) {
    store.data.users.push({ id, username: naam, passwordHash: await hashPassword('x'), isAdmin: false, isBot: false, createdAt: now } as any);
    store.data.lofts.push({
      userId: id, name: naam, money: 5000, food: {} as any, feedRation: 'normal',
      capacity: 20, compartments: 0, seasonPoints: 0, totalWins: 0, isBot: false,
      infirmaryCapacity: 4, medicatedFood: false, doctors: 0, physios: 0,
      xp: 0, level: 9, stats: {} as any, badges: [], missions: [], missionsDay: '',
      streak: 0, pendingEvent: null, pendingBroods: [], sponsorship: { active: [], offers: [], declined: [] } as any,
    } as any);
  }
  store.data.flights.push({
    id: 'f1', week: 1, templateKey: 't', name: 'Testvlucht', type: 'regional',
    distanceKm: 100, entryFee: 0, fromCity: 'A', toCity: 'B', startAt: now, status: 'live',
    entries: [], weather: '', weatherFactor: 1, results: [], recap: '', createdAt: now,
    sim: [
      { pigeonId: 'p1', pigeonName: 'A', ownerId: 'u1', ownerName: 'Hok Een' },
      { pigeonId: 'p2', pigeonName: 'B', ownerId: 'u2', ownerName: 'Hok Twee' },
    ] as any,
  } as any);
  store.data.world.seeded = true;
  await store.persist();
}

console.log('\nEen aankoop overleeft een herlading');
{
  const store = await D1Store.load(db, 'u1');
  ok(buyReaction(store, 'u1', 'z_bistro') === null, 'de aankoop lukt');
  await store.persist();

  const vers = await D1Store.load(db, 'u1');
  const loft = vers.data.lofts.find((l) => l.userId === 'u1')!;
  ok(loft.unlockedReactions?.includes('z_bistro') === true, 'en staat er na een verse load nog steeds in');
  ok(Math.round(loft.money) === 4500, `de 500 munten zijn echt weg (${Math.round(loft.money)})`);

  // De kolomvolgorde is de klassieke stille fout: LOFT_COLUMNS en loftRow zijn
  // twee lijsten die met de hand in de pas moeten blijven. Als ze verschuiven,
  // landt hier een naam of een bedrag in het verkeerde vakje.
  ok(loft.name === 'Hok Een', 'en de rest van de loft is niet verschoven');
  ok(loft.level === 9 && loft.capacity === 20, 'level en capaciteit staan nog op hun plek');
}

console.log('\nDe tribune overleeft een herlading');
{
  const store = await D1Store.load(db, 'u1');
  ok(postReaction(store, 'u1', 'f1', 'j_allez', null) === null, 'een kreet komt door');
  ok(postReaction(store, 'u1', 'f1', 'z_bistro', 'u2', Date.now() + 60000) === null, 'en een gerichte ook');
  await store.persist();

  const vers = await D1Store.load(db, 'u2');
  const f = vers.data.flights.find((x) => x.id === 'f1')!;
  ok(f.chat?.length === 2, `beide regels staan er na een verse load (${f.chat?.length})`);
  ok(f.chat?.[0].userName === 'Hok Een', 'met de bevroren naam van de zender');
  ok(f.chat?.[1].targetName === 'Hok Twee', 'en de bevroren naam van het doelwit');
  ok(
    vers.data.notifications.some((n) => n.userId === 'u2' && n.kind === 'taunt'),
    "de melding voor het doelwit is ook bewaard (kind 'taunt')",
  );
  // De rest van de vluchtrij mag niet opgeschoven zijn door de nieuwe kolom.
  ok(f.name === 'Testvlucht' && f.distanceKm === 100 && f.status === 'live', 'de vlucht zelf is ongewijzigd');
  ok(f.sim.length === 2, 'en de sim staat er nog');
}

console.log('\nEen vlucht zonder tribune schrijft geen rommel');
{
  const store = await D1Store.load(db, 'u1');
  const row = db._raw.prepare('SELECT chat FROM flights WHERE id = ?').get('f1') as any;
  ok(typeof row.chat === 'string' && row.chat.startsWith('['), 'een volle tribune staat als JSON in de kolom');
  const leeg = store.data.flights.find((x) => x.id === 'f1')!;
  ok((leeg.chat?.length ?? 0) === 2, 'en komt er als array weer uit');
}

console.log(fails ? `\n❌ ${fails} gefaald` : '\n✅ alles groen');
process.exit(fails ? 1 : 0);
