/**
 * DE STEM — het ideeënbord.
 *
 * Deze feature omzeilt bewust de per-rij-diff van `persist()`: de drie tabellen
 * staan buiten de wereldload en worden rechtstreeks geschreven. Dat is precies
 * het soort code waar een fout pas bij de volgende paginalading zichtbaar wordt
 * (een stem die "telde" maar nergens landde), dus draait deze test tegen een
 * echte SQLite-engine, net als d1-partial-load en reactions-persist.
 *
 * Wat bewaakt wordt:
 *  - `ensureSchema` maakt de drie tabellen aan;
 *  - het bord zaait zichzelf met de vier startideeën, en doet dat maar één keer;
 *  - stemmen is een toggle en telt per speler, niet per klik;
 *  - de dagrem op nieuwe ideeën telt over 24 uur;
 *  - een reactie belt de indiener, maar niet zichzelf;
 *  - het beheerdersrapport toont wie op wat stemde, inclusief wie zweeg;
 *  - de volgorde van het bord zet "in stemming" boven de rest.
 *
 * Run: npx tsx tests/stem.test.mts (vanuit de repo-root)
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  countStemIdeasSince,
  ensureSchema,
  insertStemComment,
  insertStemIdea,
  loadStemBoard,
  loadStemThread,
  loadStemVotes,
  setStemStatus,
  toggleStemVote,
} from '../core/d1.js';
import {
  SEED_IDEAS,
  buildVoterReport,
  notifyIdeaAuthor,
  sortIdeas,
  validateComment,
  validateIdea,
} from '../core/game/stem.js';
import { STEM } from '../core/config/gameConfig.js';
import { emptyDatabase } from '../core/schema.js';

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
for (let i = 0; i < 20 && !(await ensureSchema(db)); i++) { /* volgend blok */ }

console.log('\nSchema');
{
  const tables = db._raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r: any) => r.name);
  ok(tables.includes('stem_ideas'), 'stem_ideas bestaat na ensureSchema');
  ok(tables.includes('stem_votes'), 'stem_votes bestaat na ensureSchema');
  ok(tables.includes('stem_comments'), 'stem_comments bestaat na ensureSchema');
}

console.log('\nStartideeën');
{
  const board = await loadStemBoard(db, 'u1');
  ok(board.length === SEED_IDEAS.length, `het lege bord zaait ${SEED_IDEAS.length} ideeën`);
  for (const seed of SEED_IDEAS) {
    ok(board.some((i) => i.id === seed.id), `"${seed.title}" staat op het bord`);
  }
  ok(board.every((i) => i.votes === 0 && !i.voted), 'ze starten op nul stemmen');
  ok(board.every((i) => i.authorId === '' && !i.mine), 'ze hebben geen indiener, dus niemand kan ze claimen');

  // Tweemaal laden mag geen tweede set neerzetten — dat is wat INSERT OR IGNORE
  // met een vaste id moet garanderen.
  const again = await loadStemBoard(db, 'u2');
  ok(again.length === SEED_IDEAS.length, 'een tweede bezoek zaait niet opnieuw');
}

console.log('\nStemmen');
{
  const first = await toggleStemVote(db, 'stem_doping', 'u1');
  ok(first.voted && first.votes === 1, 'een eerste klik zet een stem');
  const second = await toggleStemVote(db, 'stem_doping', 'u1');
  ok(!second.voted && second.votes === 0, 'nog eens klikken trekt ze weer in');

  await toggleStemVote(db, 'stem_doping', 'u1');
  await toggleStemVote(db, 'stem_doping', 'u2');
  const third = await toggleStemVote(db, 'stem_doping', 'u3');
  ok(third.votes === 3, 'drie spelers, drie stemmen');

  const mine = (await loadStemBoard(db, 'u2')).find((i) => i.id === 'stem_doping')!;
  const other = (await loadStemBoard(db, 'u9')).find((i) => i.id === 'stem_doping')!;
  ok(mine.voted, 'wie stemde ziet zijn eigen stem terug');
  ok(!other.voted && other.votes === 3, 'wie niet stemde ziet de stand, niet zijn eigen stem');
}

console.log('\nEigen ideeën + dagrem');
{
  const now = Date.now();
  const mkIdea = (n: number, atMs: number) => ({
    id: `idea_test_${n}`,
    title: `Testidee ${n}`,
    body: 'Een uitleg die lang genoeg is om door de validatie te raken, met wat extra woorden erbij.',
    authorId: 'u1',
    authorName: 'Hok Een',
    status: 'open' as const,
    createdAt: new Date(atMs).toISOString(),
  });
  // Eentje van gisteren mag de rem van vandaag niet vullen.
  await insertStemIdea(db, mkIdea(0, now - 30 * 3600 * 1000));
  for (let n = 1; n <= STEM.maxIdeasPerDay; n++) await insertStemIdea(db, mkIdea(n, now - n * 1000));

  const since = new Date(now - 86400000).toISOString();
  const count = await countStemIdeasSince(db, 'u1', since);
  ok(count === STEM.maxIdeasPerDay, `de rem telt ${STEM.maxIdeasPerDay} van vandaag, niet die van gisteren`);
  ok((await countStemIdeasSince(db, 'u2', since)) === 0, 'de rem is per speler');

  const board = await loadStemBoard(db, 'u1');
  ok(board.find((i) => i.id === 'idea_test_1')!.mine, 'je eigen idee is als zodanig gemarkeerd');
  ok(!board.find((i) => i.id === 'stem_doping')!.mine, 'een idee van de spelleiding is niet van jou');
}

console.log('\nValidatie');
{
  ok(validateIdea('Idee', 'x'.repeat(STEM.bodyMin)) === null, 'een geldig idee komt door');
  ok(validateIdea('ab', 'x'.repeat(STEM.bodyMin)) !== null, 'een te korte titel wordt geweigerd');
  ok(validateIdea('Prima titel', 'te kort') !== null, 'een te korte uitleg wordt geweigerd');
  ok(validateIdea('Prima titel', 'x'.repeat(STEM.bodyMax + 1)) !== null, 'een te lange uitleg wordt geweigerd');
  ok(validateComment('') !== null, 'een lege reactie wordt geweigerd');
  ok(validateComment('Goed idee!') === null, 'een gewone reactie komt door');
}

console.log('\nReacties + de bel');
{
  const comment = {
    id: 'cmt_1',
    ideaId: 'idea_test_1',
    authorId: 'u2',
    authorName: 'Hok Twee',
    body: 'En wat als je niet kan afbetalen?',
    createdAt: new Date().toISOString(),
  };
  await insertStemComment(db, comment);
  const thread = (await loadStemThread(db, 'idea_test_1', 'u2'))!;
  ok(thread.comments.length === 1, 'de reactie staat in de draad');
  ok(thread.comments[0].body === comment.body, 'de tekst komt ongeschonden terug');
  ok((await loadStemBoard(db, 'u2')).find((i) => i.id === 'idea_test_1')!.comments === 1,
    'het bord telt de reactie mee');

  const world = emptyDatabase();
  notifyIdeaAuthor(world, thread.idea, comment);
  ok(world.notifications.length === 1 && world.notifications[0].userId === 'u1',
    'de indiener krijgt een bel');
  notifyIdeaAuthor(world, thread.idea, comment);
  ok(world.notifications.length === 1, 'dezelfde reactie belt geen tweede keer (stabiele id)');

  const own = { ...comment, id: 'cmt_2', authorId: 'u1', authorName: 'Hok Een' };
  notifyIdeaAuthor(world, thread.idea, own);
  ok(world.notifications.length === 1, 'je eigen reactie belt jezelf niet');

  const seedThread = (await loadStemThread(db, 'stem_lenen', 'u1'))!;
  notifyIdeaAuthor(world, seedThread.idea, { ...comment, id: 'cmt_3', ideaId: 'stem_lenen' });
  ok(world.notifications.length === 1, 'een startidee heeft geen indiener om te bellen');
}

console.log('\nBeheerder: wie stemde op wat');
{
  // Stand uit de vorige blokken: u1/u2/u3 stemden op doping, u1 bovendien op
  // zijn eigen ideeën (die krijgen automatisch de stem van de indiener niet in
  // deze test — die zit in de API-laag — dus we zetten er hier zelf een bij).
  await toggleStemVote(db, 'stem_lenen', 'u1');

  const votes = await loadStemVotes(db);
  const ideas = await loadStemBoard(db, 'u1');
  const players = [
    { userId: 'u1', name: 'Hok Een' },
    { userId: 'u2', name: 'Hok Twee' },
    { userId: 'u3', name: 'Hok Drie' },
    { userId: 'u4', name: 'Hok Vier' }, // stemde nog niet
  ];
  const report = buildVoterReport(votes, ideas, players);

  const doping = report.perIdea.find((r) => r.ideaId === 'stem_doping')!;
  ok(doping.voters.length === 3, 'per idee: doping telt drie stemmers');
  ok(
    ['Hok Een', 'Hok Twee', 'Hok Drie'].every((n) => doping.voters.some((v) => v.name === n)),
    'per idee: de drie hokken staan er met naam bij',
  );
  ok(doping.voters.every((v, i, a) => i === 0 || a[i - 1].at >= v.at), 'per idee: nieuwste stem eerst');

  const leeg = report.perIdea.find((r) => r.ideaId === 'stem_unieke_attributen')!;
  ok(leeg.voters.length === 0, 'een idee zonder stemmen staat er ook in (met nul)');
  ok(report.perIdea.length === ideas.length, 'élk idee van het bord staat in het rapport');

  const u1 = report.perPlayer.find((p) => p.userId === 'u1')!;
  ok(u1.ideas.length === 2, 'per speler: u1 stemde op twee ideeën');
  ok(u1.ideas.every((i) => i.title.length > 0), 'per speler: de ideeën staan er met titel bij');
  const u4 = report.perPlayer.find((p) => p.userId === 'u4')!;
  ok(u4 !== undefined && u4.ideas.length === 0, 'een speler die niet stemde staat er óók in');
  ok(report.perPlayer[report.perPlayer.length - 1].ideas.length === 0, 'de stille spelers staan onderaan');
  ok(report.voted === 3 && report.players === 4, 'de teller zegt 3 van de 4 spelers');

  // Een stem van een hok dat intussen gewist is mag het aantal niet stilletjes
  // veranderen — anders klopt het rapport niet meer met de teller op het bord.
  const weg = buildVoterReport(votes, ideas, players.filter((p) => p.userId !== 'u3'));
  const dopingWeg = weg.perIdea.find((r) => r.ideaId === 'stem_doping')!;
  ok(dopingWeg.voters.length === 3, 'een verdwenen speler telt nog mee in het aantal');
  ok(dopingWeg.voters.some((v) => v.name === 'u3'), 'en valt op, want zijn id staat er als naam');
}

console.log('\nStatus & volgorde');
{
  ok(await setStemStatus(db, 'stem_lenen', 'gepland'), 'de beheerder kan een status verzetten');
  ok(!(await setStemStatus(db, 'bestaat_niet', 'gepland')), 'een onbekend idee meldt zich als onvindbaar');
  const board = await loadStemBoard(db, 'u1');
  ok(board.find((i) => i.id === 'stem_lenen')!.status === 'gepland', 'de nieuwe status staat op het bord');

  const order = sortIdeas([
    { id: 'a', status: 'uitgevoerd', votes: 99, createdAt: '2026-01-01' } as any,
    { id: 'b', status: 'open', votes: 1, createdAt: '2026-01-01' } as any,
    { id: 'c', status: 'open', votes: 5, createdAt: '2026-01-01' } as any,
    { id: 'd', status: 'afgewezen', votes: 50, createdAt: '2026-01-01' } as any,
  ]).map((i) => i.id);
  ok(order.join('') === 'cbad', 'in stemming bovenaan (meeste stemmen eerst), afgewezen onderaan');
}

console.log(fails === 0 ? '\n✅ alles groen' : `\n❌ ${fails} controle(s) gefaald`);
process.exit(fails === 0 ? 0 : 1);
