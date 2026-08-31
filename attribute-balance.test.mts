/**
 * Regressietest: snelheid, conditie en oriëntatie zijn ONGEVEER EVEN VEEL WAARD.
 *
 * Waarom deze test bestaat: oriëntatie was ooit een volwaardige term in de
 * snelheidsformule, is daaruit gehaald (terecht — navigeren is niet snel vliegen)
 * en bleef daarna met LOST als enige kanaal achter. Die curve was zo steil dat de
 * eigenschap al was uitgewerkt onder oriëntatie 60, terwijl GENE.floor 70 is:
 * gemeten leverde +10 oriëntatie +0,1pp winkans op tegen +5,3pp voor snelheid.
 * Met andere woorden: een derde van elke duif deed niets, en niemand zag het.
 *
 * Deze test meet de drie eigenschappen tegen de ECHTE engine (startLiveFlight +
 * finalizeFlight, dus inclusief pace-profielen, weer, verdwalen en DNF's) en
 * faalt zodra er één significant uit de pas loopt. Hij bewaakt ook de twee
 * grenzen die de balans leefbaar houden: het plafond op de omweg en het feit dat
 * verdwalen een KANS blijft — een matige navigator moet soms schoon thuiskomen.
 *
 * Gepaard: elke variant draait op dezelfde vlucht-seeds, zodat het verschil uit
 * de eigenschap komt en niet uit toeval.
 *
 * Draai: npx tsx attribute-balance.test.mts
 */
import { startLiveFlight, finalizeFlight, type Entry } from './core/game/flight.js';
import { FLIGHT_TIERS, LOST } from './core/config/gameConfig.js';
import type { Flight, Pigeon, SimEntry } from './core/schema.js';

const WEEK = 400;
const FIELD = 12;
const BASE = 70;   // alle duiven starten hier; ruim binnen elke gen-cap
const DELTA = 10;  // de bonus die we waarderen
const RACES = Number(process.env.RACES ?? 1500);

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
};

const ATTRS = ['speed', 'endurance', 'orientation'] as const;
type Attr = typeof ATTRS[number];
const NL: Record<Attr, string> = { speed: 'snelheid', endurance: 'conditie', orientation: 'oriëntatie' };

const bird = (id: string, over: Partial<Pigeon> = {}): Pigeon => ({
  id, ownerId: `o_${id}`, name: id, sex: 'doffer', birthWeek: WEEK - 60,
  speed: BASE, endurance: BASE, orientation: BASE, libido: 60, form: 88, health: 92,
  experience: 55, sireId: null, damId: null, forSale: false, price: null,
  createdAtWeek: WEEK - 60, ailment: null, inInfirmary: false, races: 20,
  everAiled: false, coached: false, ration: 'normal', compartment: false,
  hungerDays: 0, restDays: 0,
  genes: { speed: 95, endurance: 95, orientation: 95 }, declineRate: 1,
  ...over,
} as unknown as Pigeon);

/** Eén race; de testduif is p0. `attr` = welke eigenschap +DELTA krijgt. */
function race(seed: number, km: number, weather: number, attr: Attr | null, orientationOverride?: number) {
  const pigeons: Pigeon[] = [];
  for (let i = 0; i < FIELD; i++) {
    const over: Partial<Pigeon> = {};
    if (i === 0) {
      if (attr) (over as Record<string, number>)[attr] = BASE + DELTA;
      if (orientationOverride != null) over.orientation = orientationOverride;
    }
    pigeons.push(bird(`p${i}`, over));
  }
  const entries: Entry[] = pigeons.map((p) => ({ pigeon: p, ownerName: p.ownerId }));
  // De vlucht-id draagt de eigenschap NIET, zodat elke variant exact dezelfde
  // trekkingen krijgt (buildPaceProfile seedt op flightId + pigeonId).
  const f = {
    id: `bal_${km}_${seed}`, name: 'balans', type: 'national',
    fromCity: 'A', toCity: 'B', distanceKm: km,
    startAt: new Date().toISOString(), status: 'scheduled',
    entries: [], results: [], sim: [],
  } as unknown as Flight;
  f.entries = entries.map((e) => ({ pigeonId: e.pigeon.id, ownerId: e.pigeon.ownerId })) as never;
  startLiveFlight(f, entries, WEEK, { label: 'test', factor: weather } as never);
  const s = (f.sim as SimEntry[]).find((x) => x.pigeonId === 'p0')!;
  const detourKm = s.lost?.detourKm ?? 0;
  finalizeFlight(f, pigeons);
  const r = (f.results as { pigeonId: string; rank: number; finished: boolean }[])
    .find((x) => x.pigeonId === 'p0')!;
  return { rank: r.finished ? r.rank : FIELD, win: r.finished && r.rank === 1, detourKm, km };
}

const lcg = (seed: number) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

interface Tier { label: string; min: number; max: number; weight: number }
const TIERS: Tier[] = [
  { label: 'regionaal', min: FLIGHT_TIERS.regional.minKm, max: FLIGHT_TIERS.regional.maxKm, weight: 3 },
  { label: 'nationaal', min: FLIGHT_TIERS.national.minKm, max: FLIGHT_TIERS.national.maxKm, weight: 2 },
  { label: 'internationaal', min: FLIGHT_TIERS.international.minKm, max: FLIGHT_TIERS.international.maxKm, weight: 2 },
];

function measure(tier: Tier, attr: Attr | null, orientationOverride?: number) {
  const rnd = lcg(20260831);
  let rankSum = 0, wins = 0, detSum = 0, kmSum = 0, clean = 0, worstFrac = 0;
  for (let i = 0; i < RACES; i++) {
    const km = Math.round(tier.min + rnd() * (tier.max - tier.min));
    const weather = 0.78 + rnd() * 0.34;
    const r = race(i, km, weather, attr, orientationOverride);
    rankSum += r.rank;
    if (r.win) wins++;
    detSum += r.detourKm; kmSum += r.km;
    if (r.detourKm === 0) clean++;
    worstFrac = Math.max(worstFrac, r.detourKm / r.km);
  }
  return {
    meanRank: rankSum / RACES, winRate: wins / RACES,
    detourFrac: detSum / kmSum, cleanRate: clean / RACES, worstFrac,
  };
}

console.log(`Balans van de drie eigenschappen — veld van ${FIELD} op ${BASE}/${BASE}/${BASE}, één duif +${DELTA}.`);
console.log(`${RACES} races per meetpunt, gepaard op dezelfde vlucht-seeds.\n`);

// --- 1. Per niveau: wie hoort waar te domineren? ---------------------------
const weighted: Record<Attr, { rank: number; win: number }> = {
  speed: { rank: 0, win: 0 }, endurance: { rank: 0, win: 0 }, orientation: { rank: 0, win: 0 },
};
let baseRankW = 0, baseWinW = 0, totalWeight = 0;

for (const tier of TIERS) {
  const base = measure(tier, null);
  baseRankW += base.meanRank * tier.weight;
  baseWinW += base.winRate * tier.weight;
  totalWeight += tier.weight;

  const gain: Record<Attr, { rank: number; win: number }> = {} as never;
  for (const a of ATTRS) {
    const m = measure(tier, a);
    weighted[a].rank += m.meanRank * tier.weight;
    weighted[a].win += m.winRate * tier.weight;
    gain[a] = { rank: base.meanRank - m.meanRank, win: m.winRate - base.winRate };
  }
  console.log(`${tier.label} (${Math.round(tier.min)}–${Math.round(tier.max)} km) — winst per +${DELTA}: ` +
    ATTRS.map((a) => `${NL[a]} ${(gain[a].win * 100).toFixed(1)}pp`).join(' · '));

  // Elke eigenschap moet OVERAL iets doen — geen dode eigenschap op geen enkel niveau.
  for (const a of ATTRS) {
    ok(`  ${tier.label}: ${NL[a]} levert meetbaar iets op`, gain[a].win > 0.004 && gain[a].rank > 0.05,
      `+${(gain[a].win * 100).toFixed(1)}pp / ${gain[a].rank.toFixed(2)} plaats`);
  }
  // De rolverdeling: sprint hoort van snelheid te zijn, de fond van conditie.
  if (tier.label === 'regionaal') {
    ok('  regionaal: snelheid is de belangrijkste eigenschap', gain.speed.win > gain.endurance.win && gain.speed.win > gain.orientation.win,
      `sn ${(gain.speed.win * 100).toFixed(1)} / co ${(gain.endurance.win * 100).toFixed(1)} / or ${(gain.orientation.win * 100).toFixed(1)}`);
  }
  if (tier.label === 'internationaal') {
    ok('  internationaal: conditie is belangrijker dan snelheid', gain.endurance.win > gain.speed.win,
      `co ${(gain.endurance.win * 100).toFixed(1)} vs sn ${(gain.speed.win * 100).toFixed(1)}`);
    ok('  internationaal: oriëntatie is belangrijker dan snelheid', gain.orientation.win > gain.speed.win,
      `or ${(gain.orientation.win * 100).toFixed(1)} vs sn ${(gain.speed.win * 100).toFixed(1)}`);
  }
}

// --- 2. Gewogen over de kalender: de drie zijn gelijkwaardig ---------------
console.log('');
const bR = baseRankW / totalWeight, bW = baseWinW / totalWeight;
const val = ATTRS.map((a) => ({
  a,
  rank: bR - weighted[a].rank / totalWeight,
  win: weighted[a].win / totalWeight - bW,
}));
for (const v of val) {
  console.log(`  gewogen: +${DELTA} ${NL[v.a].padEnd(11)} −${v.rank.toFixed(2)} gemiddelde plaats · ${(v.win * 100).toFixed(1)}pp winkans`);
}

const ranks = val.map((v) => v.rank);
const wins = val.map((v) => v.win);
const spread = (xs: number[]) => Math.max(...xs) / Math.max(1e-9, Math.min(...xs));

ok('geen enkele eigenschap is dood (elk ≥ 1,5pp winkans)', Math.min(...wins) > 0.015,
  wins.map((w, i) => `${NL[val[i].a]} ${(w * 100).toFixed(1)}pp`).join(' / '));
ok('de drie liggen binnen een factor 1,6 op gemiddelde plaats', spread(ranks) < 1.6,
  `factor ${spread(ranks).toFixed(2)}`);
ok('de drie liggen binnen een factor 1,8 op winkans', spread(wins) < 1.8,
  `factor ${spread(wins).toFixed(2)}`);

// --- 3. De grenzen die de balans leefbaar houden ---------------------------
console.log('');
const intl = TIERS[2];
const worstNav = measure(intl, null, 40);
const goodNav = measure(intl, null, 90);

ok('omweg blijft onder het plafond, ook voor een slechte navigator',
  worstNav.worstFrac <= LOST.maxDetourFraction + 0.001,
  `ergste ${(worstNav.worstFrac * 100).toFixed(1)}% vs plafond ${(LOST.maxDetourFraction * 100).toFixed(0)}%`);
ok('een fondvlucht wordt gemiddeld niet meer dan een tiende langer voor een goede navigator',
  goodNav.detourFrac < 0.10,
  `${(goodNav.detourFrac * 100).toFixed(1)}%`);
ok('verdwalen blijft een KANS: een matige navigator vliegt soms schoon',
  measure(intl, null, 60).cleanRate > 0.03,
  `${(measure(intl, null, 60).cleanRate * 100).toFixed(1)}% schone vluchten`);
ok('een goede navigator raakt geregeld ook eens van koers (geen immuniteit)',
  goodNav.cleanRate < 0.95,
  `${(goodNav.cleanRate * 100).toFixed(1)}% schoon`);
ok('betere oriëntatie is altijd beter (monotoon over het bereik)',
  (() => {
    const levels = [40, 60, 75, 90];
    const rk = levels.map((o) => measure(intl, null, o).meanRank);
    return rk.every((r, i) => i === 0 || r <= rk[i - 1] + 0.05);
  })(), 'gemeten op 40/60/75/90');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
