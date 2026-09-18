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
import { startLiveFlight, finalizeFlight, pigeonVelocity, weightsForDistance, type Entry } from '../core/game/flight.js';
import { DISTANCE_WEIGHTING, FLIGHT_TIERS, LOST } from '../core/config/gameConfig.js';
import type { Flight, Pigeon, SimEntry } from '../core/schema.js';

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

/**
 * ⚠️ DE WEGING VOLGT DE ECHTE KALENDER, en stond hier jarenlang scheef.
 *
 * Dit was 3 / 2 / 2. Dat klopte niet meer op twee punten: de vrijdagnationale
 * kwam erbij (nationaal is 3 per week, niet 2), en criterium, titan en estafette
 * — samen 10 van de 26 wedstrijd-startplaatsen per twee weken — zaten er
 * helemaal niet in. Omdat §8 zijn balansconclusies op dít gemiddelde baseert,
 * betekende dat: conclusies trekken over een kalender die niet bestaat.
 *
 * Geteld over de volle cyclus van twee weken (week A draagt het sprintcriterium
 * + de titan, week B het fondcriterium + de estafette), ingedeeld op het
 * afstandsvenster waarin elk slot valt:
 *
 *   kort  (100–300)  regio 6  + criterium sprint 4 + estafette-etappe 1  = 11
 *   midden(200–600)  nationaal 6 + titan 1                              =  7
 *   lang  (400–1200) internationaal 4 + criterium fond 4                 =  8
 *
 * Oefenvluchten tellen niet mee (geen geld, geen punten).
 */
interface Tier { label: string; min: number; max: number; weight: number }
const TIERS: Tier[] = [
  { label: 'regionaal', min: FLIGHT_TIERS.regional.minKm, max: FLIGHT_TIERS.regional.maxKm, weight: 11 },
  { label: 'nationaal', min: FLIGHT_TIERS.national.minKm, max: FLIGHT_TIERS.national.maxKm, weight: 7 },
  { label: 'internationaal', min: FLIGHT_TIERS.international.minKm, max: FLIGHT_TIERS.international.maxKm, weight: 8 },
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
const perTier: Record<string, Record<Attr, { rank: number; win: number }>> = {};

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
  // ⚠️ Oriëntatie heeft een LAGERE vloer dan de andere twee, en dat is bewust:
  // sinds de herijking op vraag van de eigenaar is ze een afstandseigenschap die
  // op een sprint bijna niets meer hoort te doen. Ze mag daar klein zijn, maar
  // niet nul — een derde van elke duif die niets doet, is precies waarvoor deze
  // test ooit geschreven is.
  for (const a of ATTRS) {
    const floor = a === 'orientation' && tier.label === 'regionaal' ? 0.002 : 0.004;
    ok(`  ${tier.label}: ${NL[a]} levert meetbaar iets op`, gain[a].win > floor && gain[a].rank > 0.02,
      `+${(gain[a].win * 100).toFixed(1)}pp / ${gain[a].rank.toFixed(2)} plaats`);
  }
  // De rolverdeling die de eigenaar gevraagd heeft: snelheid op de sprint,
  // conditie op de fond, oriëntatie als afstandseigenschap.
  if (tier.label === 'regionaal') {
    ok('  regionaal: snelheid is de belangrijkste eigenschap', gain.speed.win > gain.endurance.win && gain.speed.win > gain.orientation.win,
      `sn ${(gain.speed.win * 100).toFixed(1)} / co ${(gain.endurance.win * 100).toFixed(1)} / or ${(gain.orientation.win * 100).toFixed(1)}`);
  }
  if (tier.label === 'internationaal') {
    ok('  internationaal: conditie is belangrijker dan snelheid', gain.endurance.win > gain.speed.win,
      `co ${(gain.endurance.win * 100).toFixed(1)} vs sn ${(gain.speed.win * 100).toFixed(1)}`);
  }
  perTier[tier.label] = gain;
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

const wins = val.map((v) => v.win);

/*
 * ⚠️ HET ONTWERPDOEL IS VERANDERD — lees dit vóór je hier iets aanpast.
 *
 * Deze test bewaakte jarenlang "de drie eigenschappen zijn ONGEVEER EVEN VEEL
 * WAARD" (een factor 1,8 op winkans, 2,1 op gemiddelde plaats). Dat doel is op
 * expliciete vraag van de eigenaar vervangen door een ROLVERDELING:
 *
 *   snelheid    — de sterkste op de sprint, en overal meetbaar aanwezig
 *   conditie    — groeit met de afstand en neemt het over vanaf ±300–500 km
 *   oriëntatie  — een afstandseigenschap: klein op de sprint, echt op de fond
 *
 * De oude gelijkheidsgrenzen zijn dus WEG, niet losser gezet: ze toetsten een
 * bedoeling die niet meer geldt. Wat ervoor in de plaats komt is strenger op de
 * dingen die nu wél de bedoeling zijn (de rangorde per afstand, de kruising, en
 * dat niets dood is). Zet de gelijkheidsgrenzen niet terug zonder de eigenaar.
 */
ok('geen enkele eigenschap is dood over de kalender (elk ≥ 1,5pp winkans)', Math.min(...wins) > 0.015,
  wins.map((w, i) => `${NL[val[i].a]} ${(w * 100).toFixed(1)}pp`).join(' / '));

const reg = perTier['regionaal'], intlT = perTier['internationaal'];

// Snelheid moet OVERAL iets betekenen — dat was de vraag ("iets meer impact op
// eender welk type vlucht"), en het is precies wat een sprinteigenschap normaal
// verliest zodra je conditie een eigen kanaal geeft.
ok('snelheid blijft ook op de fond een echte eigenschap (≥ 2,5pp)',
  intlT.speed.win > 0.025, `internationaal ${(intlT.speed.win * 100).toFixed(1)}pp`);

// De kruising: conditie hoort de sprint te verliezen en de fond te winnen.
ok('conditie wint duidelijk bij naarmate de vlucht langer wordt',
  intlT.endurance.win > reg.endurance.win * 1.5,
  `regionaal ${(reg.endurance.win * 100).toFixed(1)}pp → internationaal ${(intlT.endurance.win * 100).toFixed(1)}pp`);
ok('snelheid weegt op de sprint zwaarder dan conditie',
  reg.speed.win > reg.endurance.win,
  `sn ${(reg.speed.win * 100).toFixed(1)} vs co ${(reg.endurance.win * 100).toFixed(1)}`);

// Oriëntatie is een AFSTANDSeigenschap: ze mag op een sprint klein zijn, maar
// moet op de fond echt meetellen. Deze verhouding is wat de eigenaar bedoelde
// met "minder impact, zelfs op korte vluchten".
ok('oriëntatie telt op de fond veel zwaarder dan op de sprint',
  intlT.orientation.win > reg.orientation.win * 2,
  `regionaal ${(reg.orientation.win * 100).toFixed(1)}pp → internationaal ${(intlT.orientation.win * 100).toFixed(1)}pp`);

// --- 3. De grenzen die de balans leefbaar houden ---------------------------
console.log('');
const intl = TIERS[2];
const worstNav = measure(intl, null, 40);
const goodNav = measure(intl, null, 90);

// Het plafond is sinds de zwerm-update afstandsafhankelijk: kort strenger dan
// fond, zodat een omweg een sprint niet meteen beslist (zie LOST).
const intlCeil = LOST.maxDetourFractionLong;
ok('omweg blijft onder het plafond, ook voor een slechte navigator',
  worstNav.worstFrac <= intlCeil + 0.001,
  `ergste ${(worstNav.worstFrac * 100).toFixed(1)}% vs plafond ${(intlCeil * 100).toFixed(0)}%`);
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

// --- 4. De grote fond weegt zwaarder dan de gewone fond -------------------
/*
 * De afstandsblend liep vroeger vol op DISTANCE_WEIGHTING.longKm (700) terwijl
 * de kalender tot 1200 km reikt: een Barcelona van 1100 km woog exact als een
 * vlucht van 700, dus de laatste 500 km kochten conditie NIETS. Gemeten vóór de
 * derde anker: +10 conditie was zowel op 800 als op 1100 km precies +4,42 km/u.
 *
 * Deze controles bewaken de twee helften van de fix: de curve loopt door TOT
 * ultraKm, en alles ERONDER is niet bewogen (anders herbalanceer je stilletjes
 * de hele kalender mee).
 */
console.log('\nDe grote fond: conditie blijft zwaarder wegen voorbij longKm');
{
  const { shortKm, longKm, ultraKm, short, long } = DISTANCE_WEIGHTING;
  const w = (km: number) => weightsForDistance(km);

  const marks = [longKm, 800, 900, 1000, 1100, ultraKm];
  const ends = marks.map((km) => w(km).endurance);
  ok('conditie blijft stijgen van longKm tot ultraKm',
    ends.every((e, i) => i === 0 || e > ends[i - 1]),
    marks.map((km, i) => `${km}:${ends[i].toFixed(2)}`).join(' '));
  ok('snelheid zakt navenant, en de drie blijven samen 1',
    marks.every((km) => Math.abs(w(km).speed + w(km).endurance + w(km).orientation - 1) < 1e-9),
    'som van de gewichten');
  ok('op ultraKm weegt conditie duidelijk zwaarder dan op longKm',
    w(ultraKm).endurance - w(longKm).endurance > 0.05,
    `${w(longKm).endurance.toFixed(2)} → ${w(ultraKm).endurance.toFixed(2)}`);

  // ⚠️ Dit is de belangrijkste van de vier: de rest van de kalender mag NIET
  // meebewegen. De oude formule is hier letterlijk herhaald als referentie.
  const oud = (km: number) => {
    const t = Math.min(1, Math.max(0, (km - shortKm) / (longKm - shortKm)));
    return short.endurance + (long.endurance - short.endurance) * t;
  };
  const onder = [100, 150, 200, 300, 400, 500, 600, 700];
  ok('geen enkele afstand ONDER longKm is bewogen',
    onder.every((km) => Math.abs(w(km).endurance - oud(km)) < 1e-9),
    onder.map((km) => `${km}:${w(km).endurance.toFixed(3)}`).join(' '));

  // En het effect waar het de speler om gaat, in km/u.
  const p = (en: number): Pigeon => bird('u', { endurance: en });
  const kmh = (b: Pigeon, km: number) => pigeonVelocity(b, km, WEEK, 1, 1) * 60 / 1000;
  const winst = (km: number) => kmh(p(BASE + DELTA), km) - kmh(p(BASE), km);
  ok('+10 conditie levert op 1100 km meetbaar meer op dan op 800 km',
    winst(1100) > winst(800) + 0.1,
    `800 km +${winst(800).toFixed(2)} km/u · 1100 km +${winst(1100).toFixed(2)} km/u`);
}

// --- 5. CONDITIE = tempo aanhouden (de SUSTAIN-mechaniek) ------------------
/*
 * De statistiek hierboven zegt DAT conditie meer waard wordt met de afstand;
 * dit blok toetst WAARDOOR. Vóór SUSTAIN bestond er geen enkel mechanisme dat
 * een duif liet verzwakken: een conditie-40 en een conditie-90 duif zakten
 * identiek weg, namelijk niet. Daardoor was conditie een tweede snelheid, en
 * loog `spelregels.md` §1 ("laat een duif haar snelheid aanhouden").
 *
 * Gemeten op het BEVROREN profiel: het gemiddelde tempo in het laatste derde van
 * de route, gedeeld door dat in het eerste derde. 1,0 = ze houdt haar tempo,
 * lager = ze zakt weg.
 */
console.log('\nConditie: houdt ze haar tempo aan?');
{
  const tail = (endurance: number, km: number, seed: number): number => {
    const p = bird('s', { endurance });
    const others = Array.from({ length: 11 }, (_, i) => bird(`o${i}`));
    const all = [p, ...others];
    const entries: Entry[] = all.map((x) => ({ pigeon: x, ownerName: x.ownerId }));
    const f = {
      id: `sus_${km}_${endurance}_${seed}`, name: 's', type: 'national',
      fromCity: 'A', toCity: 'B', distanceKm: km,
      startAt: new Date().toISOString(), status: 'scheduled', entries: [], results: [], sim: [],
    } as unknown as Flight;
    f.entries = entries.map((e) => ({ pigeonId: e.pigeon.id, ownerId: e.pigeon.ownerId })) as never;
    startLiveFlight(f, entries, WEEK, { label: 't', factor: 1 } as never);
    const seg = (f.sim as SimEntry[]).find((x) => x.pigeonId === 's')!.segMult ?? [];
    if (seg.length < 6) return 1;
    const third = Math.floor(seg.length / 3);
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    return avg(seg.slice(-third)) / avg(seg.slice(0, third));
  };
  const mean = (endurance: number, km: number) =>
    Array.from({ length: 220 }, (_, i) => tail(endurance, km, i)).reduce((s, x) => s + x, 0) / 220;

  const lowLong = mean(45, 700), highLong = mean(92, 700);
  const lowShort = mean(45, 150), highShort = mean(92, 150);
  console.log(`  150 km: conditie 45 → ${lowShort.toFixed(3)} · conditie 92 → ${highShort.toFixed(3)}`);
  console.log(`  700 km: conditie 45 → ${lowLong.toFixed(3)} · conditie 92 → ${highLong.toFixed(3)}`);

  ok('een duif met wéinig conditie zakt weg in de staart van een fondvlucht',
    lowLong < 0.97, `${lowLong.toFixed(3)}`);
  ok('een duif met véél conditie houdt haar tempo op de fond veel beter vast',
    highLong > lowLong + 0.03, `${lowLong.toFixed(3)} vs ${highLong.toFixed(3)}`);
  // ⚠️ Dit is de vraag van de eigenaar ("vooral op middenlange, 300 km+"): het
  // verschil MOET met de afstand groeien, anders is conditie weer een vlakke
  // tweede snelheid en had de hele mechaniek geen zin.
  ok('het verschil groeit met de afstand (300 km+ is waar conditie telt)',
    (highLong - lowLong) > (highShort - lowShort) * 1.8,
    `150 km ${(highShort - lowShort).toFixed(3)} → 700 km ${(highLong - lowLong).toFixed(3)}`);
  // ⚠️ Toetst het VERSCHIL, niet het absolute verval. Een duif zakt op een sprint
  // ook wat weg (gemeten 0,969 bij conditie 45) en dat mag — dat is gewoon een
  // duif die haar laatste kilometers voelt. Wat een sprint níet mag worden is een
  // conditiewedstrijd, en dát is deze grens: het verschil tussen een zwakke en een
  // sterke conditie blijft daar onder 2,5 % tempo (gemeten 1,4 %), tegen 5,4 % op
  // de fond.
  ok('op een sprint blijft het een nuance, geen conditiewedstrijd',
    (highShort - lowShort) < 0.025,
    `verschil op 150 km ${((highShort - lowShort) * 100).toFixed(1)}%`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
