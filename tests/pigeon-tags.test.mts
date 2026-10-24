/**
 * Tags op je duiven (core/game/tags.ts, PIGEON_TAGS in gameConfig).
 *
 * Bewaakt:
 *  - het opkuisen van wat de speler typt (komma's, spaties, '#', dubbels, onzichtbare
 *    tekens) en de grenzen (aantal, lengte) — fout i.p.v. stil afkappen;
 *  - zetten/wissen enkel door de eigenaar, zonder de rest van `care` te raken, en
 *    zonder leeg `care` achter te laten (een onaangeroerde duif schrijft '');
 *  - PRIVÉ: enkel de eigenaar krijgt ze in de DTO — niet een andere speler, niet de
 *    beheerder, niet een aanroep zonder kijker;
 *  - WEG bij een eigendomswissel: verkoop, aanvaard bod, duivenlokker, en een
 *    bewaker die elke `.ownerId = …` in core/game naast clearOwnerCare zoekt;
 *  - de rondrit door D1 + de echte API (zetten, /state, andermans blik, verkoop);
 *  - wiki/spelregels/bel noemen dezelfde grenzen; de bel van v65.
 *
 * Run (vanuit de repo-root): npx tsx tests/pigeon-tags.test.mts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/[[path]].ts';
import { D1Store, ensureSchema } from '../core/d1.js';
import { signToken } from '../core/auth.js';
import { PIGEON_TAGS } from '../core/config/gameConfig.js';
import { buyPigeon, createLoftForUser, listForSale, releasePigeon, seedWorld } from '../core/game/engine.js';
import { clearOwnerCare } from '../core/game/inrichting.js';
import { makeOffer, respondOffer } from '../core/game/offers.js';
import { advanceRealtime, runDataMigrations } from '../core/game/schedule.js';
import { normalizeTags, pigeonTags, setPigeonTags } from '../core/game/tags.js';
import { TAGS_NEWS } from '../core/game/news.js';
import { pigeonDTO } from '../core/presenters.js';
import { MemoryStore } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Loft, User } from '../core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const tagsOf = (r: ReturnType<typeof normalizeTags>) => ('tags' in r ? r.tags.join('|') : `!${r.error}`);

console.log('\nOpkuisen (normalizeTags)');
ok(tagsOf(normalizeTags('sprint, lange-fond')) === 'sprint|lange-fond', 'komma-gescheiden tekst → twee tags');
ok(tagsOf(normalizeTags('  mid   fond  ,')) === 'mid fond', 'spaties gekuist, lege stukken weg');
ok(tagsOf(normalizeTags('#sprint')) === 'sprint', "een '#' vooraan valt weg");
ok(tagsOf(normalizeTags('Sprint, sprint, SPRINT')) === 'Sprint', 'dezelfde tag in andere hoofdletters telt één keer');
ok(tagsOf(normalizeTags('spr​int‮')) === 'sprint', 'onzichtbare tekens en richtingswissels weg');
ok(tagsOf(normalizeTags(['sprint', 'kweek, fond'])) === 'sprint|kweek|fond', 'een lijst mag ook (met komma\'s erin)');
ok(tagsOf(normalizeTags('')) === '' && tagsOf(normalizeTags(42)) === '' && tagsOf(normalizeTags(null)) === '', 'leeg of geen tekst = geen tags');
ok(tagsOf(normalizeTags('a, b, c, d')).startsWith('!') && PIGEON_TAGS.max === 3, `meer dan ${PIGEON_TAGS.max}: geweigerd`);
ok(tagsOf(normalizeTags('x'.repeat(PIGEON_TAGS.maxLength))) === 'x'.repeat(PIGEON_TAGS.maxLength), `precies ${PIGEON_TAGS.maxLength} tekens mag`);
ok(tagsOf(normalizeTags('x'.repeat(PIGEON_TAGS.maxLength + 1))).startsWith('!'), `${PIGEON_TAGS.maxLength + 1} tekens: geweigerd, niet stil afgekapt`);
ok(tagsOf(normalizeTags('🏁'.repeat(PIGEON_TAGS.maxLength))).length > 0 && !tagsOf(normalizeTags('🏁'.repeat(PIGEON_TAGS.maxLength))).startsWith('!'), 'een emoji telt als één teken');

// --- een wereld in het geheugen --------------------------------------------------
const store = new MemoryStore(emptyDatabase());
seedWorld(store);
const db = store.data;
function player(name: string, admin = false): Loft {
  const u: User = { id: `usr_${name}`, username: name, passwordHash: 'x', isAdmin: admin, isBot: false, createdAt: new Date().toISOString() };
  store.mutate((d) => d.users.push(u));
  const loft = createLoftForUser(store, u, `Hok ${name}`);
  loft.money = 100_000;
  loft.capacity = 14;
  return loft;
}
const A = player('anna');
const B = player('bert');
const mine = (l: Loft) => db.pigeons.filter((p) => p.ownerId === l.userId);

console.log('\nZetten en wissen');
{
  const p = mine(A)[0];
  p.care = { vaccines: { pmv: new Date(Date.now() + 86400e3).toISOString() } };
  ok(setPigeonTags(store, A.userId, p.id, 'sprint, mid-fond') === null && pigeonTags(p).join('|') === 'sprint|mid-fond', 'de eigenaar zet twee tags');
  ok(!!p.care?.vaccines?.pmv, 'haar vaccin blijft staan');
  ok(setPigeonTags(store, B.userId, p.id, 'gestolen') !== null && pigeonTags(p).join('|') === 'sprint|mid-fond', 'een andere speler kan ze niet aanpassen');
  ok(setPigeonTags(store, A.userId, p.id, 'a, b, c, d') !== null && pigeonTags(p).length === 2, 'te veel tags: geweigerd, de oude blijven');
  ok(setPigeonTags(store, A.userId, p.id, '') === null && pigeonTags(p).length === 0 && !!p.care?.vaccines, 'leeg = gewist, de rest van care blijft');
  const q = mine(A)[1];
  delete q.care;
  setPigeonTags(store, A.userId, q.id, 'kweek');
  setPigeonTags(store, A.userId, q.id, []);
  ok(q.care === undefined, 'een duif zonder iets anders houdt geen leeg care over (schrijft weer \'\')');
}

console.log('\nPrivé');
{
  const p = mine(A)[0];
  setPigeonTags(store, A.userId, p.id, 'lange-fond');
  ok(pigeonDTO(db, p, A.userId).tags.join() === 'lange-fond', 'de eigenaar ziet ze');
  ok(pigeonDTO(db, p, B.userId).tags.length === 0, 'een andere speler niet');
  ok(pigeonDTO(db, p, B.userId, true).tags.length === 0, 'de beheerder ook niet');
  ok(pigeonDTO(db, p).tags.length === 0, 'een aanroep zonder kijker ook niet');
  p.forSale = true; p.price = 500;
  ok(pigeonDTO(db, p, B.userId).tags.length === 0, 'ook niet als ze te koop staat (alle eigenschappen open)');
  p.forSale = false; p.price = null;
}

console.log('\nWeg bij een eigendomswissel');
{
  const sold = mine(A)[0];
  setPigeonTags(store, A.userId, sold.id, 'sprint');
  ok(listForSale(store, A.userId, sold.id, 500) === null && buyPigeon(store, B.userId, sold.id) === null, 'verkocht op de markt');
  ok(sold.ownerId === B.userId && pigeonTags(sold).length === 0, 'de koper krijgt haar zonder tags');

  const bid = mine(A)[0];
  setPigeonTags(store, A.userId, bid.id, 'fond');
  const err = makeOffer(db, B.userId, bid.id, 5_000);
  const offer = db.offers.find((o) => o.pigeonId === bid.id);
  ok(err === null && !!offer && respondOffer(db, A.userId, offer.id, true) === null, 'privébod aanvaard');
  ok(bid.ownerId === B.userId && pigeonTags(bid).length === 0, 'ook dan zonder tags');

  const lured = mine(A)[0];
  setPigeonTags(store, A.userId, lured.id, 'weg ermee');
  B.equipment = { hygiene: 50, lastStrawAt: null, cleaner: false, lure: 5 };
  releasePigeon(store, A.userId, lured.id, () => 0);
  const waiting = B.pendingBroods.find((b) => b.young[0]?.id === lured.id)?.young[0];
  ok(!!waiting && pigeonTags(waiting).length === 0, 'een duif die een duivenlokker vangt, komt zonder tags');

  const direct = mine(A)[0];
  setPigeonTags(store, A.userId, direct.id, 'x');
  clearOwnerCare(direct);
  ok(pigeonTags(direct).length === 0, 'clearOwnerCare wist de tags');

  // Bewaker: elke plek die een duif een nieuwe eigenaar geeft, roept clearOwnerCare.
  const misses: string[] = [];
  for (const f of readdirSync('./core/game').filter((x) => x.endsWith('.ts'))) {
    const lines = readFileSync(`./core/game/${f}`, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/\b\w+\.ownerId = /.test(line)) return;
      const before = lines.slice(Math.max(0, i - 10), i + 1).join('\n');
      if (!before.includes('clearOwnerCare(')) misses.push(`${f}:${i + 1}`);
    });
  }
  ok(misses.length === 0, `elke ".ownerId = …" in core/game staat naast clearOwnerCare${misses.length ? ` (mist: ${misses.join(', ')})` : ''}`);
}

// --- D1 + de echte API -------------------------------------------------------------
console.log('\nD1 + API');
function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const val = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { bound.push(...args.map(val)); return api; },
      async first() { return sql.prepare(query).get(...(bound as any[])) ?? null; },
      async all() { return { results: sql.prepare(query).all(...(bound as any[])) }; },
      async run() { return sql.prepare(query).run(...(bound as any[])); },
    };
    return api;
  };
  return { prepare, async exec(query: string) { sql.exec(query); }, async batch(stmts: any[]) { for (const st of stmts) await st.run(); }, _raw: sql };
}
{
  const ME = 'usr_tagger';
  const OTHER = 'usr_koper';
  const d1 = fakeD1();
  d1._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  d1._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1, 1, 1, 0)').run();
  for (let i = 0; i < 40 && !(await ensureSchema(d1)); i++);
  {
    let s = await D1Store.load(d1);
    seedWorld(s);
    await s.persist();
    s = await D1Store.load(d1);
    const nowMs = Date.now();
    advanceRealtime(s.data, nowMs, new Map());
    s.data.world.lastAdvance = new Date(nowMs).toISOString();
    await s.persist();
    s = await D1Store.load(d1, ME);
    for (const [id, name] of [[ME, 'tagger'], [OTHER, 'koper']] as const) {
      const user: User = { id, username: name, passwordHash: '!', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
      s.mutate((w) => w.users.push(user));
      const loft = createLoftForUser(s, user, `Hok ${name}`);
      loft.money = 50_000;
    }
    await s.persist();
  }
  const SECRET = 'test-geheim';
  const tokens = {
    [ME]: await signToken({ sub: ME, username: 'tagger' }, SECRET, 3600),
    [OTHER]: await signToken({ sub: OTHER, username: 'koper' }, SECRET, 3600),
  };
  async function call(who: string, path: string, method = 'GET', body?: unknown) {
    const request = new Request(`http://demo.local/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[who]}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res: Response = await (onRequest as any)({
      request, env: { DB: d1, JWT_SECRET: SECRET }, params: {}, data: {},
      waitUntil() {}, passThroughOnException() {}, next: () => Promise.reject(new Error('no next')),
    });
    return { status: res.status, json: await res.json() as any };
  }

  const st0 = await call(ME, '/state');
  const bird = st0.json.pigeons[0];
  ok(st0.json.economy.pigeonTagsMax === PIGEON_TAGS.max && st0.json.economy.pigeonTagMaxLength === PIGEON_TAGS.maxLength, '/state draagt de grenzen');
  ok(Array.isArray(bird.tags) && bird.tags.length === 0, 'nog geen tags');
  const set = await call(ME, `/pigeons/${bird.id}/tags`, 'POST', { tags: 'sprint, mid-fond' });
  ok(set.status === 200, 'POST /pigeons/:id/tags');
  const bad = await call(ME, `/pigeons/${bird.id}/tags`, 'POST', { tags: 'a,b,c,d' });
  ok(bad.status === 400 && /Hoogstens/.test(bad.json.error ?? ''), 'te veel: 400 met uitleg');
  const st1 = await call(ME, '/state');
  ok(st1.json.pigeons.find((p: any) => p.id === bird.id)?.tags?.join('|') === 'sprint|mid-fond', 'na herladen staan ze er (bewaard in D1)');
  const row = d1._raw.prepare('SELECT care FROM pigeons WHERE id = ?').get(bird.id) as any;
  ok(JSON.parse(row.care).tags.join('|') === 'sprint|mid-fond', 'in de kolom care');
  const hijack = await call(OTHER, `/pigeons/${bird.id}/tags`, 'POST', { tags: 'van mij' });
  ok(hijack.status === 400, 'een andere speler kan ze niet zetten');
  const seen = await call(OTHER, `/pigeons/${bird.id}`);
  ok(seen.status === 200 && (seen.json.pigeon.tags ?? []).length === 0, 'een andere speler ziet ze niet op de duifpagina');
  const mineView = await call(ME, `/pigeons/${bird.id}`);
  ok(mineView.json.pigeon.tags?.join('|') === 'sprint|mid-fond', 'de eigenaar wel');
  // Ask what the bird is worth instead of a fixed price: a sale may not go below 1/5
  // of the market value, and that floor moves with the valuation (Marktwaarde v2).
  const price = Math.max(400, bird.minPrice ?? 0);
  await call(ME, '/market/list', 'POST', { pigeonId: bird.id, price });
  const market = await call(OTHER, '/market');
  const listing = (market.json.listings ?? []).find((l: any) => (l.pigeon?.id ?? l.id) === bird.id);
  ok(!!listing && ((listing.pigeon ?? listing).tags ?? []).length === 0, 'te koop op de markt: de koper ziet geen tags');
  const buy = await call(OTHER, '/market/buy', 'POST', { pigeonId: bird.id });
  const after = d1._raw.prepare('SELECT owner_id, care FROM pigeons WHERE id = ?').get(bird.id) as any;
  ok(buy.status === 200 && after.owner_id === OTHER && !(after.care && JSON.parse(after.care).tags), 'verkocht: de tags zijn weg in D1');
}

console.log('\nWiki, spelregels en bel noemen dezelfde grenzen');
{
  const wiki = readFileSync('./client/src/pages/WikiPage.tsx', 'utf8');
  const rules = readFileSync('./spelregels.md', 'utf8');
  ok(wiki.includes(`Tot <strong>${PIGEON_TAGS.max} tags</strong>`) && wiki.includes(`<strong>${PIGEON_TAGS.maxLength} tekens</strong>`), 'wiki');
  ok(rules.includes(`Tot **${PIGEON_TAGS.max} tags**`) && rules.includes(`**${PIGEON_TAGS.maxLength} tekens**`), 'spelregels');
  ok(TAGS_NEWS.body.includes(`tot ${PIGEON_TAGS.max} tags`) && TAGS_NEWS.body.includes(`${PIGEON_TAGS.maxLength} tekens`), 'bel');
}

console.log('\nDe bel van v65');
{
  db.world.dataVersion = 64;
  runDataMigrations(db);
  const humans = db.lofts.filter((l) => !l.isBot);
  const b = db.notifications.filter((n) => n.title === TAGS_NEWS.title);
  ok(b.length === humans.length && humans.every((l) => b.some((n) => n.userId === l.userId && n.id === TAGS_NEWS.id(l.userId))), 'één bel per echte speler, met een stabiele id');
  ok(b.every((n) => !db.lofts.find((l) => l.userId === n.userId)?.isBot), 'geen voor bots');
  ok((db.world.dataVersion ?? 0) >= 65, 'dataVersion staat op 65');
  db.world.dataVersion = 64;
  runDataMigrations(db);
  ok(db.notifications.filter((n) => n.title === TAGS_NEWS.title).length === humans.length, 'een tweede run schrijft geen extra bel');
  for (const [word, what] of [['pagina van een duif', 'waar je ze zet'], ['inschrijven', 'het inschrijven'], ['Mijn hok', 'Mijn hok'], ['Enkel jij', 'dat ze privé zijn'], ['verdwijnen', 'dat ze bij verkoop verdwijnen']] as const) {
    ok(TAGS_NEWS.body.includes(word), `de bel noemt ${what}`);
  }
}

console.log(`\n${pass} geslaagd, ${fail} mislukt`);
if (fail > 0) process.exit(1);
