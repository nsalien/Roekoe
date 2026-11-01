/**
 * Diagnose (geen assertie): lonen de vaccins en kuren van de hokinrichting?
 *
 * Alles komt uit de échte code, niets is nagebouwd:
 *  1. OPBRENGST — wat een duif per start verdient, per kwaliteit en bij een
 *     lagere gezondheid: echte vluchten (startLiveFlight + finalizeFlight) in
 *     een veld van 24, gewogen over de weekkalender (3 regio · 3 nat · 2 intl).
 *  2. KANS — hoe vaak elke ziekte toeslaat, per vluchtvorm: de echte
 *     runHealthDay, en of een vaccin ze echt afweert (fendsOff).
 *  3. KOST PER GEVAL — het echte ziekteverloop: tickHealing + applyDayOfCare +
 *     runHealthDay, dag per dag, met of zonder dokter. Telt de zorgkost, de
 *     gemiste starts (energie die niet binnenkomt), de tragere vluchten zolang
 *     de gezondheid terugkomt, en de sterftekans × de waarde van de duif.
 *
 * Draai: npx tsx tests/vaccine-economics.mts   (vanuit de repo-root, ~1 min)
 */
import { startLiveFlight, finalizeFlight, type Entry } from '../core/game/flight.js';
import { applyAilment, runHealthDay, tickHealing } from '../core/game/health.js';
import { applyDayOfCare } from '../core/game/economy.js';
import { estimateValue, talent } from '../core/game/pigeon.js';
import {
  DISEASES, FLIGHT_TIERS, HEALING, HEALTH, ILLNESS, INFIRMARY, VACCINES, diseaseSeverityWeights,
  type VaccineKey,
} from '../core/config/gameConfig.js';
import type { Ailment, Database, Flight, Loft, Pigeon } from '../core/schema.js';

const WEEK = 400;
const DAY = 86400000;
const RACES = Number(process.env.RACES ?? 500);
const euro = (v: number) => `€${Math.round(v).toLocaleString('nl-BE')}`;
const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
const lcg = (seed: number) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

function bird(id: string, t: number, o: Partial<Pigeon> = {}): Pigeon {
  return {
    id, ownerId: `o_${id}`, name: id, sex: 'doffer', birthWeek: WEEK - 100,
    speed: t, endurance: t, orientation: t, libido: 60, form: 80, health: 95, experience: 50,
    sireId: null, damId: null, forSale: false, price: null, createdAtWeek: WEEK - 100,
    ailment: null, inInfirmary: false, races: 20, everAiled: false, coached: false,
    ration: 'herstel', compartment: false, hungerDays: 0, restDays: 0,
    genes: { speed: 90, endurance: 90, orientation: 90 }, declineRate: 1, trait: null,
    ...o,
  } as unknown as Pigeon;
}

// ---------------------------------------------------------------------------
// 1. Wat brengt een duif op per start?
// ---------------------------------------------------------------------------
const FIELD = 24;
const tOf = (i: number) => 84 - (i * 24) / (FIELD - 1); // 84 (beste) … 60 (zwakste)
const TIERS = [
  { tier: 'regional', km: 150, weight: 3 },
  { tier: 'national', km: 380, weight: 3 },
  { tier: 'international', km: 700, weight: 2 },
] as const;

/** Expected prize − entry fee per start for the bird at field index `idx`, at `health`. */
function earningsPerStart(idx: number, health: number): number {
  let total = 0, wsum = 0;
  for (const { tier, km, weight } of TIERS) {
    const rnd = lcg(7 + km);
    let sum = 0;
    for (let r = 0; r < RACES; r++) {
      const ps = Array.from({ length: FIELD }, (_, i) => bird(`b${i}`, tOf(i), i === idx ? { health } : {}));
      const entries: Entry[] = ps.map((p) => ({ pigeon: p, ownerName: p.ownerId }));
      const f = {
        id: `ve_${tier}_${idx}_${health}_${r}`, name: 'v', type: tier, fromCity: 'A', toCity: 'B', distanceKm: km,
        startAt: new Date().toISOString(), status: 'scheduled', entries: [], results: [], sim: [],
      } as unknown as Flight;
      f.entries = entries.map((e) => ({ pigeonId: e.pigeon.id, ownerId: e.pigeon.ownerId })) as never;
      startLiveFlight(f, entries, WEEK, { label: 't', factor: 0.78 + rnd() * 0.34 } as never);
      finalizeFlight(f, ps);
      const res = (f.results as { pigeonId: string; prize: number }[]).find((x) => x.pigeonId === `b${idx}`);
      sum += res?.prize ?? 0;
    }
    total += weight * (sum / RACES - FLIGHT_TIERS[tier].entryFee);
    wsum += weight;
  }
  return total / wsum;
}

const ARCHETYPES = [
  { key: 'top', label: 'topduif (beste van 24)', idx: 0 },
  { key: 'goed', label: 'goede duif (5e van 24)', idx: 4 },
  { key: 'gewoon', label: 'gewone duif (12e van 24)', idx: 11 },
] as const;
const HEALTH_LEVELS = [95, 85, 75, 65, 55];

console.log(`\n=== 1. Opbrengst per start (veld van ${FIELD}, ${RACES} vluchten per niveau, na inschrijfgeld) ===`);
const earn: Record<string, number[]> = {};
for (const a of ARCHETYPES) {
  earn[a.key] = HEALTH_LEVELS.map((h) => earningsPerStart(a.idx, h));
  const t = Math.round(tOf(a.idx));
  console.log(`  ${a.label.padEnd(26)} ★${t}: ` + HEALTH_LEVELS.map((h, i) => `gez. ${h} ${euro(earn[a.key][i])}`).join(' · '));
}
/** Interpolated earnings per start at a given health. */
function eAt(key: string, h: number): number {
  const xs = HEALTH_LEVELS, ys = earn[key];
  if (h >= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (h >= xs[i]) return ys[i] + ((ys[i - 1] - ys[i]) * (h - xs[i])) / (xs[i - 1] - xs[i]);
  return Math.max(0, ys[ys.length - 1]);
}

// Energy-limited racing: a bird on Herstelvoer (ervaring 50) earns this much
// energie a day and spends ~ENERGY_PER_START on a start (calendar mix).
const ENERGY_PER_DAY = (42 / 7) * (1 + 50 / 200);
const ENERGY_PER_START = 32; // spelregels §3: regio ~21 · nat ~29–36 · intl ~44 → week-mix ~32
const STARTS_PER_DAY = ENERGY_PER_DAY / ENERGY_PER_START;
console.log(`  Starts: energie-begrensd, ${ENERGY_PER_DAY.toFixed(1)} energie/dag ÷ ${ENERGY_PER_START} per start = ${(STARTS_PER_DAY * 7).toFixed(2)} starts/week`);
for (const a of ARCHETYPES) {
  console.log(`  → ${a.label}: ${euro(eAt(a.key, 95) * STARTS_PER_DAY)} per dag, ${euro(eAt(a.key, 95) * STARTS_PER_DAY * 7)} per week`);
}

// ---------------------------------------------------------------------------
// 2. Hoe vaak slaat elke ziekte toe? (echte runHealthDay)
// ---------------------------------------------------------------------------
function makeDb(birdsPerLoft: number, lofts: number, vorm: number, vaccinated?: VaccineKey, nowMs = Date.now()): Database {
  const db = { lofts: [] as Loft[], pigeons: [] as Pigeon[], notifications: [], breedingPairs: [], flights: [], world: { currentWeek: WEEK } } as unknown as Database;
  for (let l = 0; l < lofts; l++) {
    db.lofts.push({ userId: `u${l}`, isBot: true, stats: {}, doctors: 0, physios: 0 } as unknown as Loft);
    for (let i = 0; i < birdsPerLoft; i++) {
      const p = bird(`p${l}_${i}`, 72, { ownerId: `u${l}`, form: vorm, health: vorm });
      if (vaccinated) p.care = { vaccines: { [vaccinated]: new Date(nowMs + 365 * DAY).toISOString() } };
      db.pigeons.push(p);
    }
  }
  return db;
}

/** Cases per disease per bird-day at a vluchtvorm (spontaan; elke zieke duif meteen apart gezet). */
function incidence(vorm: number, days: number, vaccinated?: VaccineKey): Record<string, number> {
  const nowMs = Date.now();
  const db = makeDb(30, 100, vorm, vaccinated, nowMs);
  const counts: Record<string, number> = Object.fromEntries(DISEASES.map((d) => [d.name, 0]));
  for (let d = 0; d < days; d++) {
    for (const p of db.pigeons) { p.ailment = null; p.form = vorm; p.health = vorm; }
    runHealthDay(db, WEEK, nowMs + d * DAY);
    for (const p of db.pigeons) if (p.ailment) counts[p.ailment.name] += 1;
  }
  const n = db.pigeons.length * days;
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / n]));
}

/** The same thing from the formulas in runHealthDay, for a check. */
function incidenceFormula(vorm: number): Record<string, number> {
  const frailty = Math.pow(Math.max(0, (100 - vorm) / 100), ILLNESS.curve);
  const daily = 1 - Math.pow(1 - (ILLNESS.floor + ILLNESS.max * frailty), 1 / 7);
  const w = diseaseSeverityWeights(vorm);
  const tot = w.licht + w.matig + w.ernstig;
  return Object.fromEntries(DISEASES.map((d) => {
    const same = DISEASES.filter((x) => x.severity === d.severity).length;
    return [d.name, (daily * w[d.severity]) / tot / same];
  }));
}

console.log('\n=== 2. Kans per ziekte, per duif per 91 dagen (echte runHealthDay, 3.000 duiven × 91 dagen) ===');
const VORMS = [50, 65, 80, 90];
const inc: Record<number, Record<string, number>> = {};
for (const v of VORMS) {
  inc[v] = incidence(v, 91);
  const f = incidenceFormula(v);
  console.log(`  vorm ${v}: ` + DISEASES.map((d) => `${d.name.split(' ')[0]} ${pct(inc[v][d.name] * 91)} (formule ${pct(f[d.name] * 91)})`).join(' · '));
}
{
  const base = incidence(65, 91).Paramyxovirose;
  const vac = incidence(65, 91, 'pmv').Paramyxovirose;
  console.log(`  controle fendsOff: PMV bij vorm 65 zonder vaccin ${pct(base * 91)}, mét ${pct(vac * 91)} → ${Math.round((1 - vac / base) * 100)} % afgeweerd (config: ${VACCINES.pmv.protect * 100} %)`);
}

// ---------------------------------------------------------------------------
// 3. Wat kost één geval? (echt ziekteverloop, dag per dag)
// ---------------------------------------------------------------------------
type Care = 'dokter' | 'boeg' | 'thuis';
interface CaseCost { days: number; careCost: number; lostStarts: number; slowLoss: number; death: number; total: number }

/** One disease case for archetype `key`, followed with the real ticks until she is back to her old health. */
function caseCost(key: string, idx: number, diseaseName: string, care: Care, trials = 400): CaseCost {
  const tmpl = DISEASES.find((d) => d.name === diseaseName)!;
  const value = estimateValue(bird('v', tOf(idx)), WEEK);
  let days = 0, careCost = 0, lostStarts = 0, slowLoss = 0, deathP = 0, survivors = 0;
  for (let k = 0; k < trials; k++) {
    const t0 = Date.parse('2026-10-01T00:00:00Z');
    const p = bird('x', tOf(idx), { ownerId: 'u', health: 95, form: 80 });
    const twin = bird('y', tOf(idx), { ownerId: 'u2', health: 95, form: 80 }); // the same bird, never ill
    const loft = {
      userId: 'u', isBot: true, stats: { cures: 0, curesSevere: 0 }, badges: [], doctors: care === 'dokter' ? 1 : 0, physios: 0,
      medicatedFood: care !== 'thuis', food: { normal: 0, premium: 0, libido: 0, herstel: 999 }, feedRation: 'herstel', infirmaryCapacity: 2,
    } as unknown as Loft;
    const twinLoft = { ...loft, userId: 'u2', food: { normal: 0, premium: 0, libido: 0, herstel: 999 } } as unknown as Loft;
    const db = { lofts: [loft], pigeons: [p], notifications: [], breedingPairs: [], flights: [], world: { currentWeek: WEEK } } as unknown as Database;
    applyAilment(p, { kind: 'ziekte', name: tmpl.name, severity: tmpl.severity, description: '', sinceWeek: WEEK } as Ailment);
    p.inInfirmary = care !== 'thuis';
    tickHealing(db, t0); // start the clocks
    let d = 0, dead = false, survive = 1, spent = 0;
    while (p.ailment && d < 60) {
      d += 1;
      const now = t0 + d * DAY;
      tickHealing(db, now);
      // Expected mortality, exactly: the daily chance runHealthDay uses (no counting
      // noise), on the midnights she is still ill.
      const table = p.inInfirmary ? HEALTH.ailmentMortalityInfirmary : HEALTH.ailmentMortalityOutside;
      if (p.ailment) survive *= Math.pow(1 - table[tmpl.severity], 1 / 7);
      const covered = new Set(p.inInfirmary && loft.doctors > 0 && p.ailment ? [p.id] : []);
      if (p.ailment) spent += (loft.doctors * INFIRMARY.doctorSalary) + (p.inInfirmary ? INFIRMARY.medicatedFoodPerBird : 0);
      applyDayOfCare(loft, [p], new Set(), covered);
      applyDayOfCare(twinLoft, [twin], new Set(), new Set());
      runHealthDay(db, WEEK, now);
      if (!db.pigeons.includes(p)) { dead = true; break; }
    }
    deathP += 1 - survive;
    if (dead) continue; // the rest is averaged over the birds that pulled through
    survivors += 1;
    days += d;
    careCost += spent;
    p.inInfirmary = false;
    // Gemiste starts: een gezonde duif had in die d dagen d × ENERGY_PER_DAY
    // energie binnengekregen (en verreden); de zieke kreeg enkel wat haar tank nu
    // boven haar beginstand (80) zit — in de boeg zonder dokter niets, mét dokter
    // de helft, min de klap bij het uitbreken. Starten is energie-begrensd, dus
    // wat niet binnenkwam, wordt nooit meer gevlogen.
    lostStarts += (d * ENERGY_PER_DAY - (p.form - 80)) / ENERGY_PER_START;
    // Trager zolang de gezondheid terugkomt (Herstelvoer, met rebound).
    let h = p.health, guard = 0;
    while (h < twin.health - 0.5 && guard++ < 120) {
      slowLoss += STARTS_PER_DAY * (eAt(key, twin.health) - eAt(key, h));
      applyDayOfCare(loft, [p], new Set(), new Set());
      h = p.health;
    }
  }
  const n = survivors;
  const death = (deathP / trials) * value;
  const lost = (lostStarts / n) * eAt(key, 95);
  return {
    days: days / n, careCost: careCost / n, lostStarts: lostStarts / n, slowLoss: slowLoss / n, death,
    total: careCost / n + lost + slowLoss / n + death,
  };
}

console.log('\n=== 3. Kost van één geval (Herstelvoer, ziekenboeg + medicatievoer, met of zonder dokter) ===');
const severities = [
  { sev: 'licht', disease: 'Het Geel' },
  { sev: 'matig', disease: 'Duivenpokken' },
  { sev: 'ernstig', disease: 'Paramyxovirose' },
] as const;
const best: Record<string, Record<string, number>> = {};
for (const a of ARCHETYPES) {
  best[a.key] = {};
  const value = estimateValue(bird('v', tOf(a.idx)), WEEK);
  console.log(`  ${a.label} (★${Math.round(tOf(a.idx))}, waarde ~${euro(value)}, ${euro(eAt(a.key, 95))}/start):`);
  for (const s of severities) {
    const opts = (['dokter', 'boeg'] as Care[]).map((c) => ({ c, r: caseCost(a.key, a.idx, s.disease, c) }));
    for (const { c, r } of opts) {
      console.log(`    ${s.sev.padEnd(7)} ${c.padEnd(6)}: ${r.days.toFixed(1)} d ziek · zorg ${euro(r.careCost)} · ${r.lostStarts.toFixed(2)} starts gemist · trager nadien ${euro(r.slowLoss)} · sterfte ${euro(r.death)} → ${euro(r.total)}`);
    }
    best[a.key][s.sev] = Math.min(...opts.map((o) => o.r.total));
  }
}

// ---------------------------------------------------------------------------
// 4. Wat levert een kuur/vaccin op tegenover de prijs?
// ---------------------------------------------------------------------------
console.log('\n=== 4. Opbrengst van één vaccin/kuur (vermeden schade over de looptijd) vs. prijs ===');
const sevOf = (name: string) => DISEASES.find((d) => d.name === name)!.severity;
// The formula, not the noisy count: section 2 shows they agree.
for (const v of [50, 65, 80]) {
  const f = incidenceFormula(v);
  console.log(`  vluchtvorm ${v}:`);
  for (const [key, vac] of Object.entries(VACCINES)) {
    const casesPrevented = f[vac.disease] * vac.days * vac.protect;
    const row = ARCHETYPES.map((a) => euro(casesPrevented * best[a.key][sevOf(vac.disease)])).join(' / ');
    console.log(`    ${vac.label.padEnd(18)} ${euro(vac.price).padStart(5)} · ${vac.days} d · ${(casesPrevented * 100).toFixed(2)} gevallen vermeden per 100 · waard ${row} (top/goed/gewoon)`);
    void key;
  }
}

// ---------------------------------------------------------------------------
// 5. De vaste prijs tegenover wat het middel elke duif oplevert
// ---------------------------------------------------------------------------
console.log('\n=== 5. Vaste prijs (VACCINES.price) vs. wat het middel oplevert (gesimuleerd) ===');
{
  const vorms = [60, 65, 70, 75, 80];
  for (const a of ARCHETYPES) {
    console.log(`  ${a.label} (waarde ~${euro(estimateValue(bird('v', tOf(a.idx)), WEEK))}):`);
    for (const [key, vac] of Object.entries(VACCINES) as [VaccineKey, (typeof VACCINES)[VaccineKey]][]) {
      const worth = vorms.map((v) => incidenceFormula(v)[vac.disease] * vac.days * vac.protect * best[a.key][sevOf(vac.disease)]);
      console.log(`    ${vac.label.padEnd(18)} €${vac.price} · oplevert ×prijs bij vorm ${vorms.map((v, i) => `${v}: ${(worth[i] / vac.price).toFixed(1)}`).join(' · ')}`);
      void key;
    }
  }
}
