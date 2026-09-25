/**
 * De prijsuitreiking: wat reset, wat níet, en wat de ceremonie te zien krijgt.
 *
 * Twee dingen die makkelijk stilletjes fout gaan:
 *  1. **`totalWins` mag NIET met het seizoen mee resetten.** Sponsordrempels zijn
 *     erop gegateerd (`req.totalWins` 1/5/8/12) en hij weegt in hun aanbod, dus
 *     nullen zou die tiers elke vier weken opnieuw dichtgooien. De ranglijst toont
 *     daarom `seasonWins`, en díe reset wel.
 *  2. **De ceremonie mag enkel de prijzen van het NET afgelopen seizoen tonen** —
 *     anders viert een verse browser een overwinning van maanden terug opnieuw.
 *
 * Run: npx tsx season-prizes.test.mts
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import { runSeasonEnd } from '../core/game/season.js';
import { loftDTO, rankingRows } from '../core/presenters.js';
import { SEASON_AWARDS } from '../core/config/gameConfig.js';
import type { User } from '../core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const store = new MemoryStore(emptyDatabase());
seedWorld(store);
const db = store.data;
const lofts = [];
for (let i = 0; i < 3; i++) {
  const u: User = { id: newId('usr'), username: `s${i}`, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
  store.mutate((d) => d.users.push(u));
  lofts.push(createLoftForUser(store, u, `Hok ${i}`));
}

// ---------------------------------------------------------------------------
console.log('\n1. De ranglijst toont de winst van DIT seizoen');
{
  lofts[0].seasonPoints = 400; lofts[0].totalWins = 37; lofts[0].seasonWins = 5;
  lofts[1].seasonPoints = 250; lofts[1].totalWins = 4; lofts[1].seasonWins = 3;
  const rows = rankingRows(db);
  const first = rows.find((r) => r.userId === lofts[0].userId)!;
  ok(first.totalWins === 5, `de kolom toont de seizoenswinst (5), niet de 37 van altijd`);
  ok(rows[0].userId === lofts[0].userId, 'de rangschikking zelf blijft op seizoenspunten staan');
}

// ---------------------------------------------------------------------------
console.log('\n2. De seizoenswissel reset de juiste teller');
{
  const seasonBefore = db.world.seasonYear;
  runSeasonEnd(db, seasonBefore, Date.now());
  db.world.seasonYear += 1;
  ok(lofts[0].seasonWins === 0, 'seasonWins staat op 0');
  ok(lofts[1].seasonWins === 0, 'bij elk hok');
  ok(lofts[0].totalWins === 37, 'totalWins blijft ONgemoeid (sponsordrempels)');
  ok(lofts[0].seasonPoints === 0, 'seizoenspunten zijn wel gereset');
  ok(rankingRows(db).every((r) => r.totalWins === 0), 'de ranglijstkolom staat dus overal op 0');
}

// ---------------------------------------------------------------------------
console.log('\n3. De ceremonie krijgt precies de prijzen van dat seizoen');
{
  const won = lofts[0].awards ?? [];
  ok(won.length > 0, `de winnaar heeft ${won.length} prijs/prijzen gekregen`);
  const dto = loftDTO(db, lofts[0]) as any;
  ok(!!dto.ceremony, 'de loft-DTO draagt een ceremonie');
  ok(dto.ceremony.season === db.world.seasonYear - 1, 'ze wijst naar het net afgelopen seizoen');
  ok(dto.ceremony.awards.length === won.filter((a) => a.season === dto.ceremony.season).length,
     `met alle ${dto.ceremony.awards.length} prijzen van dat seizoen`);
  ok(dto.ceremony.awards.every((a: any) => a.reward > 0), 'elke prijs draagt haar eigen bedrag');
  const roekoe = dto.ceremony.awards.find((a: any) => a.kind === 'roekoe');
  ok(!!roekoe && roekoe.reward === SEASON_AWARDS.roekoe[roekoe.rank - 1],
     `de Roekoe betaalt €${roekoe?.reward} voor plaats ${roekoe?.rank}`);

  // Een ouder seizoen mag de ceremonie niet opnieuw openen.
  const older = loftDTO(db, lofts[2]) as any;
  ok(older.ceremony === null || older.ceremony.awards.length > 0,
     'een hok zonder prijzen krijgt geen lege ceremonie');
}

// ---------------------------------------------------------------------------
console.log('\n4. Een tweede seizoen laat de oude prijzen liggen');
{
  const stale = db.world.seasonYear;
  runSeasonEnd(db, stale, Date.now());
  db.world.seasonYear += 1;
  const dto = loftDTO(db, lofts[0]) as any;
  // Hok 0 heeft dit seizoen 0 punten, dus wint niets: de ceremonie wijst nog naar
  // het oude seizoen, en de client toont ze dan niet (season !== seasonYear - 1).
  ok(dto.ceremony === null || dto.ceremony.season < db.world.seasonYear - 1,
     'de ceremonie is verouderd en wordt door de client niet meer getoond');
}

// ---------------------------------------------------------------------------
console.log('\n5. Roekoes voor de top 3, een seizoenspremie voor de rest');
{
  const season = db.world.seasonYear;
  for (const l of db.lofts) { l.seasonPoints = 0; l.seasonWins = 0; }
  // Six player lofts, so places 4–6 exist. Points chosen so the ÷3 is exact
  // (1200 → 400), rounds down (100 → 33) and rounds to nothing (2 → 0).
  const extra = [];
  for (let i = 0; i < 3; i++) {
    const u: User = { id: newId('usr'), username: `p${i}`, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
    store.mutate((d) => d.users.push(u));
    extra.push(createLoftForUser(store, u, `Premiehok ${i}`));
  }
  const bot = db.lofts.find((l) => l.isBot)!;
  const [a, b, c] = lofts;
  a.seasonPoints = 3000; b.seasonPoints = 2500; c.seasonPoints = 2000;
  extra[0].seasonPoints = 1200; extra[1].seasonPoints = 100; extra[2].seasonPoints = 2;
  bot.seasonPoints = 600;
  const before = new Map(db.lofts.map((l) => [l.userId, l.money]));
  const paid = (l: typeof a) => l.money - before.get(l.userId)!;
  const ofSeason = (l: typeof a) => (l.awards ?? []).filter((x) => x.season === season);

  runSeasonEnd(db, season, Date.now());
  db.world.seasonYear += 1;

  ok(SEASON_AWARDS.roekoe.join('/') === '2000/1700/1400', 'de Roekoes betalen €2.000 / €1.700 / €1.400');
  ok(ofSeason(a).some((x) => x.kind === 'roekoe' && x.rank === 1 && x.reward === 2000), '1e: de Gouden Roekoe, €2.000');
  ok(ofSeason(b).some((x) => x.kind === 'roekoe' && x.rank === 2 && x.reward === 1700), '2e: de Zilveren Roekoe, €1.700');
  ok(ofSeason(c).some((x) => x.kind === 'roekoe' && x.rank === 3 && x.reward === 1400), '3e: de Bronzen Roekoe, €1.400');
  ok([a, b, c].every((l) => !ofSeason(l).some((x) => x.kind === 'premie')), 'de top 3 krijgt geen premie bovenop de Roekoe');

  const p1200 = ofSeason(extra[0]).find((x) => x.kind === 'premie');
  ok(!!p1200 && p1200.reward === 400 && paid(extra[0]) === 400, '1.200 punten → €400 premie, en dat bedrag staat op de rekening');
  ok(!!p1200 && p1200.rank === 4 && p1200.value === 1200, 'de premie draagt de plaats (4e) en de punten');
  const p100 = ofSeason(extra[1]).find((x) => x.kind === 'premie');
  ok(!!p100 && p100.reward === 33, '100 punten → €33 (naar beneden afgerond)');
  ok(ofSeason(extra[2]).length === 0 && paid(extra[2]) === 0, '2 punten → niets (geen premie van €0)');
  const pBot = ofSeason(bot).find((x) => x.kind === 'premie');
  ok(!!pBot && pBot.reward === 200, 'een bot krijgt ook zijn premie (600 → €200)');
  ok(!db.notifications.some((n) => n.userId === bot.userId && n.id === `ntf:season:${season}:${bot.userId}`),
     'maar een bot krijgt geen melding');

  const note = db.notifications.find((n) => n.id === `ntf:season:${season}:${extra[0].userId}`);
  ok(!!note && /Seizoenspremie/.test(note.body) && /€400/.test(note.body), 'de speler krijgt één melding met zijn premie');
  const dto = loftDTO(db, extra[0]) as any;
  ok(!!dto.ceremony && dto.ceremony.awards.some((x: any) => x.kind === 'premie'),
     'en de premie verschijnt in de prijsuitreiking op het scherm');
  ok(extra.every((l) => l.seasonPoints === 0), 'de seizoenspunten staan daarna op nul');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
