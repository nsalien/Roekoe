/**
 * Regressietest: ouderdomssterfte treft geen jonge duiven.
 *
 * Gemelde bug: een duif van 2 jaar stierf met de melding dat ze "op hoge
 * leeftijd vredig insliep". ⚠️ De oorzaak was de VORM van `MORTALITY_CURVE`, niet
 * de code eromheen: de eerste twee ankers waren `{0, 0}` en `{208, 0.001}`, en
 * `interpolate` trekt daar een rechte lijn tussen. Een duif droeg dus vanaf haar
 * geboorte een ouderdomsrisico dat gestaag opliep. Gemeten op de oude curve:
 * 2,5 % stierf van "ouderdom" vóór haar 2e en 9,8 % vóór haar 4e verjaardag,
 * terwijl de spelregels beloven dat jonge duiven zo goed als nooit vanzelf
 * sterven.
 *
 * De curve is nu expliciet nul tot `AGING.peakEndWeeks` — dezelfde grens waarop
 * de vaardigheden beginnen te zakken, zodat "ouderdom" op één plek begint.
 *
 * Run: npx tsx mortality.test.mts
 */
import { AGING, GAME_WEEKS_PER_REAL_WEEK, MORTALITY_CURVE } from './core/config/gameConfig.js';
import { ageMortality, generatePigeon } from './core/game/pigeon.js';
import { runAgeMortality } from './core/game/health.js';
import { emptyDatabase } from './core/schema.js';
import type { Database } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const PEAK = AGING.peakEndWeeks; // 208 wk = 4 duivenjaar
const at = (weeks: number) => ageMortality({ birthWeek: 0 } as any, weeks);

console.log('\nGeen ouderdomssterfte zolang een duif in haar piek zit');
{
  let worst = 0;
  for (let w = 0; w <= PEAK; w++) worst = Math.max(worst, at(w));
  ok(worst === 0, `elke week van 0 t/m ${PEAK} staat op exact 0 (hoogste: ${worst})`);
  ok(at(104) === 0, 'een duif van 2 jaar — het gemelde geval — loopt geen enkel risico');
  ok(at(PEAK) === 0, `en op de grens zelf (${PEAK} wk) nog steeds niet`);
}

console.log('\nMaar daarna telt ouderdom wél, en oplopend');
{
  ok(at(PEAK + 26) > 0, 'een half duivenjaar voorbij de piek is de kans niet meer nul');
  let prev = -1, monotoon = true;
  for (let w = PEAK; w <= 780; w += 13) { const p = at(w); if (p < prev - 1e-12) monotoon = false; prev = p; }
  ok(monotoon, 'de curve loopt vanaf de piek alleen maar op');
  // De ijkpunten uit de spelregels moeten blijven kloppen.
  for (const [jaar, p] of [[6, 0.006], [8, 0.025], [10, 0.07], [12, 0.16], [15, 0.4]] as const) {
    ok(Math.abs(at(jaar * 52) - p) < 1e-9, `${jaar} jaar staat nog op ${p} per gameweek`);
  }
}

console.log('\nCumulatief: een duif haalt haar piek zonder ouderdomsrisico');
{
  let dood = 0;
  for (let w = 0; w < PEAK; w++) dood += at(w); // bovengrens op 1−Π(1−p)
  ok(dood === 0, `kans om vóór ${PEAK / 52} jaar aan ouderdom te sterven: ${(dood * 100).toFixed(2)}%`);
}

console.log('\nEn de echte engine doodt geen jonge duiven van "hoge leeftijd"');
{
  const db: Database = emptyDatabase();
  db.lofts.push({
    userId: 'usr_a', name: 'Hok A', money: 0, food: {} as any, feedRation: 'normal', capacity: 200,
    compartments: 0, seasonPoints: 0, totalWins: 0, isBot: false, infirmaryCapacity: 2, medicatedFood: false,
    doctors: 0, physios: 0, xp: 0, level: 1, stats: {} as any, badges: [], missions: [], missionsDay: '',
    streak: 0, pendingEvent: null, sponsorship: {} as any, awards: [],
  } as any);
  // 200 duiven, allemaal jonger dan de piek, en dan een heel duivenleven lang
  // elke gameweek de sterfteworp — precies wat `tickDailyCare` doet.
  const week0 = 1000;
  for (let i = 0; i < 200; i++) {
    const p = generatePigeon({ ownerId: 'usr_a', currentWeek: week0, quality: 0.6 });
    p.id = `p${i}`;
    p.birthWeek = week0 - (i % PEAK); // 0 t/m 207 weken oud
    db.pigeons.push(p);
  }
  const before = db.pigeons.length;
  // Rol tot net vóór de jongste duif de piek uit groeit.
  for (let w = 0; w < PEAK - 1; w++) runAgeMortality(db, week0 + w);
  const jong = db.pigeons.filter((p) => (week0 + PEAK - 2) - p.birthWeek < PEAK).length;
  const notes = db.notifications.filter((n) => n.title.includes('is niet meer'));
  ok(db.pigeons.length >= jong, 'geen enkele duif binnen haar piek is gestorven');
  // Elke sterfmelding moet over een duif gaan die de piek écht voorbij was. De
  // leeftijd staat in de tekst, dus die is te controleren zonder de rij te kennen.
  const jaren = notes.map((n) => Number(/\((\d+) jaar\)/.exec(n.body ?? '')?.[1] ?? -1));
  ok(jaren.length > 0, `er ZIJN oude duiven gestorven (${jaren.length}) — anders meet deze test niets`);
  ok(jaren.every((j) => j >= PEAK / 52), `en allemaal ≥ ${PEAK / 52} jaar (jongste: ${Math.min(...jaren)}) — startte met ${before} duiven`);
}

console.log('\nDe curve zelf blijft goed gevormd');
{
  ok(MORTALITY_CURVE[0].weeks === 0 && MORTALITY_CURVE[0].p === 0, 'begint op nul bij de geboorte');
  const peakAnchor = MORTALITY_CURVE.find((x) => x.weeks === PEAK);
  ok(!!peakAnchor && peakAnchor.p === 0,
    `⚠️ er staat een NUL-anker op ${PEAK} wk — zonder dat interpoleert de curve weer vanaf de geboorte`);
  ok(MORTALITY_CURVE.every((x, i) => i === 0 || x.weeks > MORTALITY_CURVE[i - 1].weeks), 'de ankers lopen op in leeftijd');
  ok(GAME_WEEKS_PER_REAL_WEEK === 4, 'duiven verouderen 4× real-time (drijft hoe vaak de worp valt)');
}

console.log(fail === 0 ? `\n✅ ${pass} geslaagd, 0 gefaald\n` : `\n❌ ${pass} geslaagd, ${fail} gefaald\n`);
if (fail > 0) process.exitCode = 1;
