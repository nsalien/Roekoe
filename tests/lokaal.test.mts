/**
 * HET LOKAAL — de vrije chat.
 *
 * Net als De Stem omzeilt de chat de per-rij-diff van `persist()`, en hij gaat
 * nog een stap verder: de routes laden de wereld niet eens. Een fout zit dan in
 * precies de hoek die geen enkele andere test raakt, dus deze test draait tegen
 * een echte SQLite-engine (zoals stem en d1-partial-load).
 *
 * Wat bewaakt wordt:
 *  - `ensureSchema` maakt de tabel en de twee wereldkolommen aan;
 *  - de eerste lading geeft de nieuwste berichten, oudste eerst, en weet of er
 *    nog oudere zijn; "oudere laden" sluit daar naadloos op aan;
 *  - een poll brengt enkel wat veranderde (nieuw + weggehaald), en vangt via de
 *    overlap ook een bericht op dat net vóór de cursor zijn tijdstip kreeg;
 *  - een weggehaald bericht verdwijnt, met gewiste tekst;
 *  - berichten ouder dan de bewaartermijn worden opgeruimd;
 *  - ⚠️ `chat_last_at` wordt door een gewone `persist` NIET teruggezet — de
 *    kern van de keuze om die kolommen buiten de world-UPDATE te houden;
 *  - een verwijderde speler wordt `Oud-speler`, de rest blijft;
 *  - de regels: opkuisen, valideren, de rem, wie mag weghalen, het bolletje;
 *  - migratie v60 belt elke echte speler precies één keer, en geen bots;
 *  - GIFs: een losse Giphy/Tenor-link wordt de vaste GIF-vorm, al de rest
 *    (een zin met een link, een andere host) blijft gewoon tekst.
 *
 * Run: npx tsx tests/lokaal.test.mts (vanuit de repo-root)
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  D1Store,
  deleteLokaalMessage,
  ensureSchema,
  findLokaalMessage,
  insertLokaalMessage,
  lastLokaalPostAt,
  loadLokaalChanges,
  loadLokaalLatest,
  lokaalNameFor,
} from '../core/d1.js';
import {
  LOKAAL_INTRO,
  canDeleteMessage,
  cleanMessage,
  normalizeGifLink,
  pollWindowStart,
  rateLimitError,
  validateMessage,
} from '../core/game/lokaal.js';
import { hasLokaalNews } from '../client/src/game/lokaalSeen.js';
import { LOKAAL } from '../core/config/gameConfig.js';
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { LokaalMessage, User } from '../core/schema.js';
import { createLoftForUser, seedWorld } from '../core/game/engine.js';
import { runDataMigrations } from '../core/game/schedule.js';

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
      run() { const r = sql.prepare(query).run(...(bound as any[])); return { meta: { changes: Number(r.changes) } }; },
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
db._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,1)').run();
for (let i = 0; i < 30 && !(await ensureSchema(db)); i++) { /* volgend blok */ }

const T0 = Date.parse('2026-09-29T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
const msg = (userId: string, atMs: number, body?: string): LokaalMessage => {
  const n = ++seq;
  return {
    id: `msg_${String(n).padStart(4, '0')}_${userId}`,
    userId,
    authorName: `Hok ${userId}`,
    body: body ?? `bericht ${n}`,
    createdAt: iso(atMs),
    deletedAt: null,
  };
};

console.log('\nSchema');
{
  const tables = db._raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r: any) => r.name);
  ok(tables.includes('lokaal_messages'), 'lokaal_messages bestaat na ensureSchema');
  const cols = new Set(db._raw.prepare('PRAGMA table_info(world)').all().map((r: any) => r.name));
  ok(cols.has('chat_last_at') && cols.has('chat_last_by'), 'world heeft chat_last_at + chat_last_by');
  const idx = db._raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'lokaal_messages'").all().map((r: any) => r.name);
  ok(['idx_lokaal_created', 'idx_lokaal_user', 'idx_lokaal_deleted'].every((n) => idx.includes(n)),
    'de drie indexen die de polls dekken bestaan');
}

console.log('\nEen leeg lokaal');
{
  const first = await loadLokaalLatest(db);
  ok(first.messages.length === 0 && !first.hasMore, 'geen berichten, geen "oudere berichten"-knop');
  const store = await D1Store.load(db, 'u1');
  ok(!store.data.world.chatLastAt, 'nog geen markering op de wereldrij');
}

console.log('\nPlaatsen + de markering op de wereldrij');
{
  const m = msg('u1', T0, 'Goeiemorgen iedereen!');
  await insertLokaalMessage(db, m, T0);
  const back = await findLokaalMessage(db, m.id);
  ok(!!back && back.body === 'Goeiemorgen iedereen!' && back.authorName === 'Hok u1', 'het bericht staat er, tekst en naam ongeschonden');
  const store = await D1Store.load(db, 'u2');
  ok(store.data.world.chatLastAt === m.createdAt, 'world.chatLastAt = het tijdstip van het bericht');
  ok(store.data.world.chatLastBy === 'u1', 'world.chatLastBy = de schrijver');
}

console.log('\n⚠️ Een gewone persist zet de markering niet terug');
{
  // Een ander verzoek laadt de wereld, dan post iemand, dan schrijft dat andere
  // verzoek zijn (verouderde) wereldrij weg. De markering moet blijven staan.
  const stale = await D1Store.load(db, 'u3');
  const newer = msg('u2', T0 + 60_000, 'Wie vliegt er zondag mee?');
  await insertLokaalMessage(db, newer, T0 + 60_000);
  stale.data.world.lastAdvance = iso(T0 + 61_000); // de wereldrij verandert echt
  await stale.persist();
  const row = db._raw.prepare('SELECT chat_last_at, chat_last_by, last_advance FROM world WHERE id = 1').get() as any;
  ok(row.last_advance === iso(T0 + 61_000), 'de persist schreef de wereldrij wel degelijk');
  ok(row.chat_last_at === newer.createdAt && row.chat_last_by === 'u2', 'maar chat_last_at/by bleven op het nieuwste bericht');
}

console.log('\nEerste lading en "oudere berichten"');
{
  // Vul aan tot ruim twee pagina's.
  const total = LOKAAL.loadLimit * 2 + 10;
  for (let i = 0; i < total - 2; i++) await insertLokaalMessage(db, msg('u1', T0 + 120_000 + i * 1000), T0 + 120_000 + i * 1000);
  const p1 = await loadLokaalLatest(db);
  ok(p1.messages.length === LOKAAL.loadLimit && p1.hasMore, `de eerste lading toont ${LOKAAL.loadLimit} berichten en meldt dat er meer zijn`);
  ok(p1.messages.every((m, i, a) => i === 0 || a[i - 1].createdAt <= m.createdAt), 'oudste eerst, zoals een gesprek leest');
  const newest = db._raw.prepare('SELECT MAX(created_at) AS t FROM lokaal_messages').get() as any;
  ok(p1.messages[p1.messages.length - 1].createdAt === newest.t, 'het laatste bericht op het scherm is het nieuwste');
  const p2 = await loadLokaalLatest(db, p1.messages[0].createdAt);
  ok(p2.messages.length === LOKAAL.loadLimit && p2.hasMore, 'de tweede pagina is weer vol');
  ok(p2.messages[p2.messages.length - 1].createdAt < p1.messages[0].createdAt, 'en sluit aan vóór de eerste, zonder overlap');
  const p3 = await loadLokaalLatest(db, p2.messages[0].createdAt);
  ok(p3.messages.length === 10 && !p3.hasMore, 'de laatste pagina: de rest, en geen knop meer');
  const ids = new Set([...p1.messages, ...p2.messages, ...p3.messages].map((m) => m.id));
  ok(ids.size === total, `samen precies alle ${total} berichten, geen dubbel, geen gat`);
}

console.log('\nDe poll');
{
  const cursorMs = T0 + 3_600_000;
  const cursor = iso(cursorMs);
  const quiet = await loadLokaalChanges(db, pollWindowStart(cursor)!);
  ok(quiet.messages.length === 0 && quiet.deleted.length === 0, 'niets veranderd → een lege poll');

  // Een bericht dat zijn tijdstip kreeg VÓÓR de cursor, maar pas daarna in de
  // tabel belandde (de race die de overlap afvangt).
  const late = msg('u2', cursorMs - 5_000, 'net te laat opgeslagen');
  const fresh = msg('u3', cursorMs + 2_000, 'vers');
  await insertLokaalMessage(db, late, cursorMs + 1_000);
  await insertLokaalMessage(db, fresh, cursorMs + 2_000);
  const poll = await loadLokaalChanges(db, pollWindowStart(cursor)!);
  ok(poll.messages.some((m) => m.id === fresh.id), 'het nieuwe bericht komt mee');
  ok(poll.messages.some((m) => m.id === late.id), 'ook het bericht dat net vóór de cursor zijn tijdstip kreeg (overlap)');
  ok(poll.messages.length === 2, 'en verder niets — een poll leest geen oude berichten');
  ok(pollWindowStart('onzin') === null && pollWindowStart(undefined) === null, 'een ongeldige cursor = een eerste lading');

  const at = iso(cursorMs + 3_000);
  ok(await deleteLokaalMessage(db, fresh.id, at), 'weghalen lukt');
  ok(!(await deleteLokaalMessage(db, fresh.id, at)), 'tweemaal weghalen verandert niets meer');
  const gone = await loadLokaalChanges(db, pollWindowStart(cursor)!);
  ok(gone.deleted.includes(fresh.id), 'de volgende poll meldt het weggehaalde bericht');
  ok(!gone.messages.some((m) => m.id === fresh.id), 'en brengt het niet opnieuw als nieuw');
  const row = await findLokaalMessage(db, fresh.id);
  ok(row?.body === '' && !!row?.deletedAt, 'de tekst is echt gewist, de rij draagt deleted_at');
  const latest = await loadLokaalLatest(db);
  ok(!latest.messages.some((m) => m.id === fresh.id), 'de eerste lading toont het niet meer');
}

console.log('\nOpruimen na de bewaartermijn');
{
  const nowMs = T0 + 40 * 86400000;
  const old = msg('u1', nowMs - (LOKAAL.retentionDays + 1) * 86400000, 'heel oud');
  db._raw.prepare('INSERT INTO lokaal_messages (id, user_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(old.id, old.userId, old.authorName, old.body, old.createdAt);
  const keep = msg('u2', nowMs - 86400000, 'van gisteren');
  db._raw.prepare('INSERT INTO lokaal_messages (id, user_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(keep.id, keep.userId, keep.authorName, keep.body, keep.createdAt);
  await insertLokaalMessage(db, msg('u3', nowMs, 'nieuw'), nowMs);
  ok(!(await findLokaalMessage(db, old.id)), `een bericht ouder dan ${LOKAAL.retentionDays} dagen is weg`);
  ok(!!(await findLokaalMessage(db, keep.id)), 'een bericht van gisteren blijft');
}

console.log('\nEen speler verwijderen');
{
  const store = await D1Store.load(db, 'u1');
  store.data.pendingPurge = { userIds: ['u2'], pigeonIds: [] };
  await store.persist();
  const u2 = db._raw.prepare("SELECT COUNT(*) AS n FROM lokaal_messages WHERE user_id = 'u2'").get() as any;
  const oud = db._raw.prepare("SELECT COUNT(*) AS n FROM lokaal_messages WHERE user_id = '' AND author_name = 'Oud-speler'").get() as any;
  // (u3 en niet u1: de berichten van u1 zijn in het blok hierboven al terecht
  // opgeruimd als ouder dan de bewaartermijn.)
  const u3 = db._raw.prepare("SELECT COUNT(*) AS n FROM lokaal_messages WHERE user_id = 'u3' AND author_name = 'Hok u3'").get() as any;
  ok(Number(u2.n) === 0, 'geen bericht staat nog op naam van de vertrekker');
  ok(Number(oud.n) > 0, 'zijn berichten blijven staan als "Oud-speler" (het gesprek blijft leesbaar)');
  ok(Number(u3.n) > 0, 'de berichten van de blijvers zijn ongemoeid');
}

console.log('\nDe rem + de naam');
{
  const last = await lastLokaalPostAt(db, 'u3');
  ok(!!last, 'het laatste bericht van een speler wordt gevonden');
  ok((await lastLokaalPostAt(db, 'niemand')) === null, 'wie nooit iets zei, heeft geen laatste bericht');
  const lastMs = Date.parse(last!);
  ok(rateLimitError(last, lastMs + 500) !== null, 'binnen de rem: geweigerd');
  ok(rateLimitError(last, lastMs + LOKAAL.minIntervalSeconds * 1000 + 1) === null, 'na de rem: mag weer');
  ok(rateLimitError(null, lastMs) === null, 'een eerste bericht mag altijd');

  db._raw.prepare("INSERT INTO users (id, username, password_hash, is_admin, is_bot, created_at) VALUES ('u9', 'jan', 'x', 0, 0, '2026-01-01')").run();
  const jan = { id: 'u9', username: 'jan' } as User;
  ok((await lokaalNameFor(db, jan)) === 'jan', 'zonder hok: de login');
  db._raw.prepare("INSERT INTO lofts (user_id, name, money, food, feed_ration, capacity, season_points, total_wins, is_bot) VALUES ('u9', 'De Snelle Vleugel', 0, 0, 'normal', 8, 0, 0, 0)").run();
  ok((await lokaalNameFor(db, jan)) === 'De Snelle Vleugel', 'met een hok: de hoknaam');
}

console.log('\nRegels');
{
  ok(cleanMessage('  hallo   daar  ') === 'hallo daar', 'spaties samengevouwen en getrimd');
  ok(cleanMessage('a\r\n\r\n\r\n\r\nb') === 'a\n\nb', 'hoogstens één lege regel na elkaar');
  ok(cleanMessage('regel 1\nregel 2') === 'regel 1\nregel 2', 'een gewone enter blijft');
  ok(validateMessage(cleanMessage('   ')) !== null, 'een leeg bericht wordt geweigerd');
  ok(validateMessage('x'.repeat(LOKAAL.bodyMax)) === null, `${LOKAAL.bodyMax} tekens mag`);
  ok(validateMessage('x'.repeat(LOKAAL.bodyMax + 1)) !== null, 'eentje meer niet');

  const mine = { userId: 'u1', deletedAt: null };
  ok(canDeleteMessage(mine, { id: 'u1', isAdmin: false }), 'je eigen bericht mag je weghalen');
  ok(!canDeleteMessage(mine, { id: 'u2', isAdmin: false }), 'andermans bericht niet');
  ok(canDeleteMessage(mine, { id: 'u2', isAdmin: true }), 'de beheerder wél (moderatie)');
  ok(!canDeleteMessage({ userId: '', deletedAt: null }, { id: '', isAdmin: false }), 'een "Oud-speler"-bericht is van niemand');
  ok(!canDeleteMessage({ userId: 'u1', deletedAt: iso(T0) }, { id: 'u1', isAdmin: true }), 'wat al weg is, kan niet nog eens weg');

  ok(hasLokaalNews(iso(T0), 'u2', 'u1', 0), 'bolletje: een bericht van een ander dat je nog niet zag');
  ok(!hasLokaalNews(iso(T0), 'u1', 'u1', 0), 'geen bolletje voor je eigen bericht');
  ok(!hasLokaalNews(iso(T0), 'u2', 'u1', T0), 'geen bolletje als je al tot daar las');
  ok(!hasLokaalNews('', '', 'u1', 0), 'geen bolletje in een leeg lokaal');
  ok(!hasLokaalNews(iso(T0), 'u2', undefined, 0), 'geen bolletje zolang niet geweten is wie kijkt');
}

console.log('\nMigratie v60: de aankondiging');
{
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const w = store.data;
  const mk = (name: string) => {
    const u: User = { id: newId('usr'), username: name, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: iso(T0) };
    store.mutate((d) => d.users.push(u));
    return createLoftForUser(store, u, name);
  };
  const a = mk('anna');
  const b = mk('bert');
  w.world.dataVersion = 59;
  runDataMigrations(w);
  const intro = (userId: string) => w.notifications.filter((n) => n.id === LOKAAL_INTRO.id(userId));
  ok(intro(a.userId).length === 1 && intro(b.userId).length === 1, 'elke echte speler krijgt één bel');
  const bots = w.lofts.filter((l) => l.isBot);
  ok(bots.length > 0 && bots.every((l) => intro(l.userId).length === 0), 'de bots niet');
  ok((w.world.dataVersion ?? 0) >= 60, 'dataVersion staat op 60');
  const count = w.notifications.length;
  w.world.dataVersion = 59;
  runDataMigrations(w);
  ok(w.notifications.length === count, 'een tweede run schrijft geen extra bel (stabiele id)');
}

console.log('\nGIFs');
{
  const id = 'l0HlBO7eyXzSZkJri';
  const want = `https://media.giphy.com/media/${id}/200.gif`;
  ok(normalizeGifLink(`https://giphy.com/gifs/happy-dance-${id}`) === want, 'giphy-pagina → vaste GIF-link');
  ok(normalizeGifLink(`https://media3.giphy.com/media/v1.Y2lkPTc5/${id}/giphy.gif?cid=abc&rid=giphy.gif`) === want, 'media-link met tracking → vaste GIF-link');
  ok(normalizeGifLink(`https://i.giphy.com/${id}.gif`) === want, 'i.giphy.com → vaste GIF-link');
  ok(normalizeGifLink('https://media.tenor.com/AbC-12/dans.gif?x=1') === 'https://media.tenor.com/AbC-12/dans.gif', 'tenor-media-link zonder query');
  ok(normalizeGifLink(`kijk eens https://giphy.com/gifs/${id}`) === `kijk eens https://giphy.com/gifs/${id}`, 'een zin met een link blijft tekst');
  ok(normalizeGifLink('https://example.com/kat.gif') === 'https://example.com/kat.gif', 'een andere host blijft gewone tekst');
  ok(normalizeGifLink('https://giphy.com/explore/duif') === 'https://giphy.com/explore/duif', 'een giphy-zoekpagina is geen GIF');
}

console.log(fails === 0 ? '\n✅ alles groen' : `\n❌ ${fails} controle(s) gefaald`);
process.exit(fails === 0 ? 0 : 1);
