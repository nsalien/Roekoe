/**
 * Marktwaarde: correct en stabiel (⚠️ dev — de nieuwe waardering).
 *
 * De eigenaar: "ik wil kunnen baseren op marktwaarde, maar daarvoor moet die eerst
 * correct worden bepaald" — en niet meer fluctueren zoals vroeger. Gedekt:
 *   1. zonder verkopen = de schatting, en die ligt aan de top waar spelers betalen
 *      (een ★80: gewoon ~€16.800, goed ~€25.000);
 *   2. verkopen AAN hun schatting veranderen niets — ook niet voor een goede duif
 *      als er gewone verkocht worden (genen en ervaring tellen niet dubbel);
 *   3. één verkoop verschuift de waarde een derde van het verschil, drie
 *      gelijkgezinde verkopen 85 %;
 *   4. een uitschieter tussen normale verkopen trekt maar beperkt;
 *   5. de prijs blijft staan (dag 1 = dag 40), vervaagt pas op het einde van het
 *      venster en is na 60 dagen weg;
 *   6. een nieuwere verkoop weegt zwaarder dan een oudere;
 *   7. een topverkoop tilt vergelijkbare duiven op, niet de hele club;
 *   8. een betere duif is nooit minder waard.
 *
 * Run: npx tsx tests/market-memory.test.mts
 */
import { emptyDatabase } from '../core/schema.js';
import type { Database, Pigeon, Trade } from '../core/schema.js';
import { estimateValue, generatePigeon } from '../core/game/pigeon.js';
import { saleQuality, valuePigeon } from '../core/game/market.js';
import { MARKET_VALUATION } from '../core/config/gameConfig.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const eur = (n: number) => `€${Math.round(n).toLocaleString('nl-BE')}`;
const near = (a: number, b: number, tol = 0.02) => Math.abs(a / b - 1) <= tol;

const DAY = 86400000;
const T0 = Date.parse('2026-10-01T12:00:00Z');
const WEEK = 400;
const { observationDays, fadeDays } = MARKET_VALUATION;

// One bird, re-scored per check: same age and breed, so only talent/genes/experience move.
const template = generatePigeon({ ownerId: 'usr_x', currentWeek: WEEK, quality: 0.6, birthWeek: WEEK - 100 });
const mk = (t: number, genes = 82, exp = 30): Pigeon =>
  ({ ...template, speed: t, endurance: t, orientation: t, experience: exp, genes: { speed: genes, endurance: genes, orientation: genes }, trait: null } as Pigeon);
const plain = (t: number) => mk(t, 82, 30);
const good = (t: number) => mk(t, 90, 60);
const model = (p: Pigeon) => estimateValue(p, WEEK);

let seq = 0;
/** Bird `p` sold at `mult` × what she is worth per the schatting, `days` after T0. */
function sale(p: Pigeon, mult: number, days: number): Trade {
  seq++;
  return {
    id: `trd_${seq}`, pigeonId: `p${seq}`, pigeonName: `Duif ${seq}`,
    sellerId: 'usr_a', sellerName: 'A', buyerId: 'usr_b', buyerName: 'B',
    price: Math.round(model(p) * mult), at: new Date(T0 + days * DAY).toISOString(),
    talent: (p.speed + p.endurance + p.orientation) / 3, quality: saleQuality(p, WEEK),
  };
}

/** A fresh Database per moment: the curve is cached per Database object (= one request). */
function val(trades: Trade[], p: Pigeon, nowMs: number) {
  const db: Database = { ...emptyDatabase(), trades: [...trades] };
  db.world.currentWeek = WEEK;
  return valuePigeon(db, p, WEEK, nowMs);
}
const v = (trades: Trade[], p: Pigeon, nowMs = T0 + DAY * 12) => val(trades, p, nowMs).value;

console.log('\n=== 1. Zonder verkopen: de schatting, en die klopt aan de top ===');
{
  const r = val([], plain(80), T0);
  ok(r.value === r.modelValue && r.trust === 0, `gewone ★80 zonder verkopen = schatting (${eur(r.value)})`);
  ok(r.value > 14000 && r.value < 20000, `gewone ★80: ${eur(r.value)} (spelers betalen ~€20.000 voor een goede)`);
  const g = v([], good(80), T0);
  ok(g > 20000 && g < 30000, `goede ★80: ${eur(g)}`);
  ok(v([], plain(60), T0) < 2500, `een ★60 blijft betaalbaar: ${eur(v([], plain(60), T0))}`);
}

console.log('\n=== 2. Verkopen aan hun schatting veranderen niets ===');
{
  const fairGood = [sale(good(80), 1, 1), sale(good(79), 1, 4), sale(good(81), 1, 8)];
  const fairPlain = [sale(plain(80), 1, 1), sale(plain(79), 1, 4), sale(plain(81), 1, 8)];
  ok(near(v(fairGood, plain(80)), v([], plain(80))), `goede duiven verkocht aan hun schatting: een gewone ★80 blijft ${eur(v(fairGood, plain(80)))}`);
  ok(near(v(fairPlain, good(80)), v([], good(80))), `gewone duiven verkocht aan hun schatting: een goede ★80 blijft ${eur(v(fairPlain, good(80)))} (geen dubbeltelling)`);
}

console.log('\n=== 3. Eén verkoop een derde, drie verkopen 85 % ===');
{
  const base = v([], plain(80));
  const one = v([sale(plain(80), 2, 1)], plain(80));
  ok(near(one / base, 1 + 1 / 3, 0.03), `één verkoop aan 2×: ×${(one / base).toFixed(2)} (een derde van het verschil)`);
  const three = v([sale(plain(80), 1.3, 1), sale(good(80), 1.3, 5), sale(plain(79), 1.3, 9)], plain(80));
  ok(near(three / base, 0.15 + 0.85 * 1.3, 0.03), `drie verkopen aan 1,3×: ×${(three / base).toFixed(2)} (85 % markt)`);
}

console.log('\n=== 4. Een uitschieter trekt maar beperkt ===');
{
  const base = v([], plain(80));
  const withOutlier = v([sale(plain(80), 1, 4), sale(good(80), 1, 8), sale(plain(80), 3, 10)], plain(80));
  ok(withOutlier / base < 1.35, `twee normale verkopen + één aan 3×: ×${(withOutlier / base).toFixed(2)} (gewoon gemiddeld was ×1,49)`);
  const dump = v([sale(plain(80), 1, 4), sale(good(80), 1, 8), sale(plain(80), 0.2, 10)], plain(80));
  ok(dump / base > 0.75, `twee normale verkopen + één aan 1/5: ×${(dump / base).toFixed(2)}`);
}

console.log('\n=== 5. De prijs blijft staan tot het einde van het venster ===');
{
  const record = [sale(plain(80), 2, 0)];
  const d1 = v(record, plain(80), T0 + DAY);
  const d7 = v(record, plain(80), T0 + 7 * DAY), d20 = v(record, plain(80), T0 + 20 * DAY), d40 = v(record, plain(80), T0 + 40 * DAY);
  ok(d1 > v([], plain(80)) && d7 === d1 && d20 === d1 && d40 === d1, `dag 1 / 7 / 20 / 40: ${eur(d1)} / ${eur(d7)} / ${eur(d20)} / ${eur(d40)} — onveranderd`);
  const fading = v(record, plain(80), T0 + (observationDays - fadeDays / 2) * DAY);
  ok(fading < d1 && fading > v([], plain(80)), `dag ${observationDays - fadeDays / 2}: ${eur(fading)} — vervaagt pas op het einde`);
  const gone = val(record, plain(80), T0 + (observationDays + 1) * DAY);
  ok(gone.value === gone.modelValue, `dag ${observationDays + 1}: ${eur(gone.value)} — weer de schatting`);
}

console.log('\n=== 6. Een nieuwere verkoop weegt zwaarder ===');
{
  const older = sale(plain(80), 1.6, 0), newer = sale(plain(80), 0.8, 20);
  const now = T0 + 21 * DAY;
  const both = v([older, newer], plain(80), now), onlyOld = v([older], plain(80), now), onlyNew = v([newer], plain(80), now);
  ok(Math.abs(both - onlyNew) < Math.abs(both - onlyOld), `1,6× (dag 0) + 0,8× (dag 20) → ${eur(both)}: dichter bij de nieuwe (${eur(onlyNew)}) dan de oude (${eur(onlyOld)})`);
}

console.log('\n=== 7. Een topverkoop tilt vergelijkbare duiven op, niet de hele club ===');
{
  const record = [sale(plain(80), 2, 0)];
  const rise = (t: number) => v(record, plain(t), T0 + DAY) / v([], plain(t), T0 + DAY);
  ok(rise(78) > 1.2, `★78: ×${rise(78).toFixed(2)} — vergelijkbaar, dus mee omhoog`);
  ok(rise(66) < 1.06, `★66: ×${rise(66).toFixed(2)} — haast niets`);
}

console.log('\n=== 8. Een betere duif is nooit minder waard ===');
{
  const mixed = [sale(plain(80), 2, 0), sale(plain(70), 1.4, 2), sale(good(76), 0.4, 3), sale(plain(84), 0.7, 4)];
  // The model rounds to €10, so on a flat stretch a better bird can land a tenner lower.
  let prev = 0, worst = 0;
  for (let t = 40; t <= 95; t++) {
    const x = v(mixed, plain(t), T0 + 5 * DAY);
    if (prev > 0) worst = Math.max(worst, (prev - x) / prev);
    prev = x;
  }
  ok(worst < 0.005, `score 40 → 95: de waarde daalt nergens (hoogstens afronding: ${(worst * 100).toFixed(2)} %), ook met een koopje ertussen`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald\n`);
process.exit(fail === 0 ? 0 : 1);
