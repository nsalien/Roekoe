/**
 * Marktwaarde houdt stand.
 *
 * Een verkoop zet de prijs voor vergelijkbare duiven, en die prijs BLIJFT staan tot
 * een nieuwere verkoop iets anders zegt. Vroeger zakte hij elke dag terug naar het
 * model (dat de top veel te laag schat): het vertrouwen in de markt halveerde mee
 * met het gewicht van de verkoop. Een duif van score 80 ging zo in een week van
 * €20.000 naar €12.000 zonder dat er iets goedkopers verkocht werd.
 *
 * Gedekt:
 *   1. zonder verkopen = het model, zoals altijd;
 *   2. na een topverkoop blijft de waarde staan (dag 1 = dag 7 = dag 20 = dag 40),
 *      vervaagt pas in de laatste 14 dagen van het venster en is na 60 dagen weg;
 *   3. de markt beweegt nog wél: een goedkopere vergelijkbare verkoop drukt de prijs;
 *   4. een nieuwere verkoop weegt zwaarder dan een oudere;
 *   5. een topverkoop tilt vergelijkbare duiven op, niet de hele club;
 *   6. een betere duif is nooit minder waard.
 *
 * Run: npx tsx tests/market-memory.test.mts
 */
import { emptyDatabase } from '../core/schema.js';
import type { Database, Pigeon, Trade } from '../core/schema.js';
import { generatePigeon } from '../core/game/pigeon.js';
import { valuePigeon } from '../core/game/market.js';
import { MARKET_VALUATION } from '../core/config/gameConfig.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const eur = (n: number) => `€${n.toLocaleString('nl-BE')}`;

const DAY = 86400000;
const T0 = Date.parse('2026-10-01T12:00:00Z');
const WEEK = 40;
const { observationDays, fadeDays } = MARKET_VALUATION;

// One bird, re-scored per check: same genes, age and breed, so only the talent moves.
const template = generatePigeon({ ownerId: 'usr_x', currentWeek: WEEK, quality: 0.5, birthWeek: WEEK - 60 });
const bird = (t: number): Pigeon => ({ ...template, speed: t, endurance: t, orientation: t });

let seq = 0;
function sale(t: number, price: number, at: number): Trade {
  seq++;
  return {
    id: `trd_${seq}`, pigeonId: `p${seq}`, pigeonName: `Duif ${seq}`,
    sellerId: 'usr_a', sellerName: 'A', buyerId: 'usr_b', buyerName: 'B',
    price, at: new Date(at).toISOString(), talent: t,
  };
}

/** A fresh Database per moment: the curve is cached per Database object (= one request). */
function val(trades: Trade[], t: number, nowMs: number) {
  const db: Database = { ...emptyDatabase(), trades: [...trades] };
  db.world.currentWeek = WEEK;
  return valuePigeon(db, bird(t), WEEK, nowMs);
}
const v = (trades: Trade[], t: number, nowMs: number) => val(trades, t, nowMs).value;

console.log('\n=== 1. Zonder verkopen: het model ===');
{
  const r = val([], 80, T0);
  ok(r.value === r.modelValue && r.trust === 0, `score 80 zonder verkopen = model (${eur(r.modelValue)})`);
}

console.log('\n=== 2. Na een topverkoop blijft de prijs staan ===');
const record = [sale(80, 18000, T0)];
const model80 = val([], 80, T0).modelValue;
const d1 = v(record, 80, T0 + DAY);
{
  ok(d1 >= model80 * 4, `dag 1: ${eur(d1)} — ver boven het model (${eur(model80)})`);
  const d7 = v(record, 80, T0 + 7 * DAY), d20 = v(record, 80, T0 + 20 * DAY), d40 = v(record, 80, T0 + 40 * DAY);
  ok(d7 === d1 && d20 === d1 && d40 === d1, `dag 7 / 20 / 40: ${eur(d7)} / ${eur(d20)} / ${eur(d40)} — onveranderd`);
  const fading = v(record, 80, T0 + (observationDays - fadeDays / 2) * DAY);
  ok(fading < d1 && fading > model80, `dag ${observationDays - fadeDays / 2}: ${eur(fading)} — vervaagt pas op het einde van het venster`);
  const gone = val(record, 80, T0 + (observationDays + 1) * DAY);
  ok(gone.value === gone.modelValue, `dag ${observationDays + 1}: ${eur(gone.value)} — weer het model, de verkoop telt niet meer`);
}

console.log('\n=== 3. De markt beweegt nog: een goedkopere vergelijkbare verkoop drukt de prijs ===');
{
  const after = v([...record, sale(80, 6000, T0 + 10 * DAY)], 80, T0 + 11 * DAY);
  ok(after < d1 * 0.8, `score 80 voor €6.000 op dag 10 → ${eur(after)} (was ${eur(d1)})`);
}

console.log('\n=== 4. Een nieuwere verkoop weegt zwaarder dan een oudere ===');
{
  const older = sale(80, 18000, T0), newer = sale(80, 9000, T0 + 20 * DAY);
  const now = T0 + 21 * DAY;
  const both = v([older, newer], 80, now), onlyOld = v([older], 80, now), onlyNew = v([newer], 80, now);
  ok(Math.abs(both - onlyNew) < Math.abs(both - onlyOld),
    `€18.000 (dag 0) + €9.000 (dag 20) → ${eur(both)}: dichter bij de nieuwe (${eur(onlyNew)}) dan de oude (${eur(onlyOld)})`);
}

console.log('\n=== 5. Een topverkoop tilt vergelijkbare duiven op, niet de hele club ===');
{
  const rise = (t: number) => v(record, t, T0 + DAY) / v([], t, T0 + DAY);
  ok(rise(60) < 1.05, `score 60: ×${rise(60).toFixed(2)} — haast niets`);
  ok(rise(65) < 1.3, `score 65: ×${rise(65).toFixed(2)} — weinig`);
  ok(rise(76) > 2.5, `score 76: ×${rise(76).toFixed(2)} — vergelijkbaar, dus mee omhoog`);
}

console.log('\n=== 6. Een betere duif is nooit minder waard ===');
{
  const mixed = [...record, sale(70, 9000, T0 + 2 * DAY), sale(76, 2500, T0 + 3 * DAY), sale(84, 6000, T0 + 4 * DAY)];
  // The model rounds to €10, so on a flat stretch of the curve a better bird can
  // land a tenner lower — rounding, not a dip (< 0,5 %).
  let prev = 0, worst = 0;
  for (let t = 40; t <= 95; t++) {
    const x = v(mixed, t, T0 + 5 * DAY);
    if (prev > 0) worst = Math.max(worst, (prev - x) / prev);
    prev = x;
  }
  ok(worst < 0.005, `score 40 → 95: de waarde daalt nergens (hoogstens afronding: ${(worst * 100).toFixed(2)} %), ook met een koopje ertussen`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald\n`);
process.exit(fail === 0 ? 0 : 1);
