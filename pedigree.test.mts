/**
 * Regressietest: stamboom, inteelt en de kweekleeftijd.
 *
 * Bewaakt de dingen die stil kunnen breken:
 *  - de stamboom stopt netjes bij een dode voorouder, maar noemt haar nog wel;
 *  - verwantschap wordt herkend in de juiste graad (en NIET waar ze er niet is);
 *  - een inteeltjong krijgt echt lagere gen-caps en meestal een afwijking;
 *  - een duif jonger dan BREEDING.minAgeWeeks kan niet kweken — speler én bot;
 *  - de stamboom kijkt ook OMLAAG en OPZIJ: kinderen, kleinkinderen, partners
 *    en broers/zussen (vol én half), en niemand komt dubbel of ontbreekt;
 *  - de namenpool is breed genoeg om herhaling te vermijden.
 *
 * Run: npx tsx pedigree.test.mts
 */
import { existsSync } from 'node:fs';
import { BREEDING, INBREEDING, MALE_FIRST_NAMES, FEMALE_FIRST_NAMES, EPITHETS, PIGEON_BREEDS } from './core/config/gameConfig.js';
import { familyOf, kinship, pedigreeOf, ancestorIds } from './core/game/pedigree.js';
import { breed } from './core/game/breeding.js';
import { generatePigeon } from './core/game/pigeon.js';
import { generatePigeonName, nameKey } from './core/game/names.js';
import { emptyDatabase } from './core/schema.js';
import type { Database, Pigeon } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

function world(): Database {
  const db = emptyDatabase();
  db.world.currentWeek = 200;
  db.lofts.push({
    userId: 'usr_a', name: 'Hok A', money: 9999, food: {} as any, feedRation: 'normal', capacity: 20,
    compartments: 0, seasonPoints: 0, totalWins: 0, isBot: false, infirmaryCapacity: 2, medicatedFood: false,
    doctors: 0, physios: 0, xp: 0, level: 1, stats: {} as any, badges: [], missions: [], missionsDay: '',
    streak: 0, pendingEvent: null, sponsorship: {} as any, awards: [],
  } as any);
  return db;
}

/** A bird with fixed parentage, added to the world. */
function bird(db: Database, id: string, sex: 'doffer' | 'duivin', sireId: string | null, damId: string | null): Pigeon {
  const p = generatePigeon({ ownerId: 'usr_a', currentWeek: db.world.currentWeek, quality: 0.6 });
  p.id = id;
  p.name = id;
  p.sex = sex;
  p.sireId = sireId;
  p.damId = damId;
  p.sireName = sireId;
  p.damName = damId;
  p.birthWeek = db.world.currentWeek - 60;
  db.pigeons.push(p);
  return p;
}

// === 1. Verwantschap ========================================================
console.log('\nVerwantschap herkennen');
{
  const db = world();
  const opa = bird(db, 'opa', 'doffer', null, null);
  const oma = bird(db, 'oma', 'duivin', null, null);
  const vader = bird(db, 'vader', 'doffer', opa.id, oma.id);
  const tante = bird(db, 'tante', 'duivin', opa.id, oma.id);      // volle zus van vader
  const halfzus = bird(db, 'halfzus', 'duivin', opa.id, null);     // deelt enkel de vader
  const vreemde = bird(db, 'vreemde', 'duivin', null, null);
  const dochter = bird(db, 'dochter', 'duivin', vader.id, vreemde.id);
  const neef = bird(db, 'neef', 'doffer', null, tante.id);         // kind van tante

  ok(kinship(db, vader, dochter) === 'directe-lijn', 'vader × dochter = directe lijn');
  ok(kinship(db, opa, dochter) === 'directe-lijn', 'grootvader × kleindochter = directe lijn');
  ok(kinship(db, vader, tante) === 'volle', 'volle broer en zus');
  ok(kinship(db, vader, halfzus) === 'half', 'halfbroer en halfzus');
  ok(kinship(db, neef, dochter) === 'familie', 'neef × nicht = familie');
  ok(kinship(db, vader, vreemde) === null, 'twee onverwante duiven zijn géén familie');
  ok(kinship(db, opa, oma) === null, 'de twee stamouders onderling zijn geen familie');

  // Een DODE voorouder telt nog mee: haar id staat op haar levende kind. Pas
  // voorbij haar stopt de lijn, want haar eigen ouders zijn onvindbaar geworden.
  db.pigeons = db.pigeons.filter((p) => p.id !== 'opa' && p.id !== 'oma');
  ok(kinship(db, vader, tante) === 'volle',
    'broer en zus blijven herkenbaar nadat hun ouders gestorven zijn');
  ok(kinship(db, neef, dochter) === 'familie',
    'een gedeelde dode voorouder legt het verband nog steeds');

  // Sterft de levende TUSSENSCHAKEL, dan is het verband echt weg.
  db.pigeons = db.pigeons.filter((p) => p.id !== 'tante');
  ok(kinship(db, neef, dochter) === null,
    'met de tussenschakel dood is verder familie niet meer zichtbaar');
}

// === X. De familie in alle richtingen =======================================
console.log('\nFamilie in alle richtingen (familyOf)');
{
  const db = world();
  const opa = bird(db, 'opa', 'doffer', null, null);
  const oma = bird(db, 'oma', 'duivin', null, null);
  // Onze duif, plus een volle zus en twee halfbroers via elk één ouder.
  const ik = bird(db, 'ik', 'duivin', opa.id, oma.id);
  bird(db, 'vollezus', 'duivin', opa.id, oma.id);
  bird(db, 'halfbroer_v', 'doffer', opa.id, 'andere_moeder');
  bird(db, 'halfbroer_m', 'doffer', 'andere_vader', oma.id);
  bird(db, 'vreemde2', 'doffer', null, null);
  // Twee partners, twee nesten, en één kleinkind.
  const partnerA = bird(db, 'partnerA', 'doffer', null, null);
  const partnerB = bird(db, 'partnerB', 'doffer', null, null);
  const kind1 = bird(db, 'kind1', 'duivin', partnerA.id, ik.id);
  bird(db, 'kind2', 'doffer', partnerA.id, ik.id);
  bird(db, 'kind3', 'duivin', partnerB.id, ik.id);
  bird(db, 'kleinkind', 'doffer', 'schoonzoon', kind1.id);

  const fam = familyOf(db, ik, 3);

  const sibNames = fam.siblings.map((x) => x.name).sort();
  ok(sibNames.join(',') === 'halfbroer_m,halfbroer_v,vollezus',
    `drie broers/zussen gevonden (${sibNames.join(',')})`);
  ok(fam.siblings.find((x) => x.name === 'vollezus')!.full === true, 'de volle zus is als vol gemarkeerd');
  const hv = fam.siblings.find((x) => x.name === 'halfbroer_v')!;
  ok(hv.full === false && hv.sharedSire && !hv.sharedDam, 'halfbroer via de vader: enkel de vader gedeeld');
  const hm = fam.siblings.find((x) => x.name === 'halfbroer_m')!;
  ok(hm.full === false && hm.sharedDam && !hm.sharedSire, 'halfbroer via de moeder: enkel de moeder gedeeld');
  ok(!fam.siblings.some((x) => x.name === 'vreemde2'), 'een onverwante duif is geen broer of zus');
  ok(fam.siblings.filter((x) => !x.full).length === 2, 'béide halfbroers tellen mee, niet enkel de volle zus');
  ok(!fam.siblings.some((x) => x.name === 'ik'), 'de duif is haar eigen zus niet');
  ok(fam.siblings[0].full, 'volle broers/zussen staan vooraan');

  const kids = fam.children.map((x) => x.name).sort();
  ok(kids.join(',') === 'kind1,kind2,kind3', `drie kinderen gevonden (${kids.join(',')})`);
  ok(fam.children.every((k) => k.partner !== null), 'elk kind kent de ándere ouder');
  ok(fam.children.find((k) => k.name === 'kind1')!.partner!.name === 'partnerA',
    'de partner is de andere ouder, niet de duif zelf');
  const partners = fam.partners.map((x) => x.name).sort();
  ok(partners.join(',') === 'partnerA,partnerB', `twee partners (${partners.join(',')})`);

  const k1 = fam.children.find((k) => k.name === 'kind1')!;
  ok(k1.children.length === 1 && k1.children[0].name === 'kleinkind', 'het kleinkind hangt onder het juiste kind');
  ok(fam.children.find((k) => k.name === 'kind2')!.children.length === 0, 'een kind zonder jongen heeft een lege tak');

  // De diepte is begrensd, en de andere richting blijft werken.
  const shallow = familyOf(db, ik, 1);
  ok(shallow.children.length === 3 && shallow.children.every((k) => k.children.length === 0),
    'met diepte 1 stoppen we bij de kinderen');
  ok(familyOf(db, partnerA, 3).children.length === 2, 'de partner ziet zijn eigen twee jongen');
  ok(familyOf(db, opa, 3).children.length === 3,
    'de kant van de grootvader werkt net zo goed: opa ziet ik + vollezus + halfbroer_v');
}

// === P. De juiste foto reist mee met elke duif in de stamboom ===============
/*
 * De stamboom tekende vroeger zijn eigen <img> op een bestandsnaam, los van de
 * `PigeonAvatar` die de rest van het spel gebruikt. Daardoor negeerde hij de
 * regel dat een duif met een AFWIJKING de getekende duif krijgt in plaats van
 * haar rasfoto — geen enkele stockfoto heeft drie vleugels — en toonde hij
 * stilletjes de verkeerde duif. Daarom draagt elke tak nu het VOLLEDIGE ras én
 * de afwijking, in dezelfde vorm als `pigeonDTO`.
 */
console.log('\nElke duif in de stamboom draagt haar ras én haar afwijking');
{
  const db = world();
  const pa = bird(db, 'pa_f', 'doffer', null, null);
  const ma = bird(db, 'ma_f', 'duivin', null, null);
  const ik3 = bird(db, 'ik3', 'duivin', pa.id, ma.id);
  const zus = bird(db, 'zus_f', 'duivin', pa.id, ma.id);
  const mate = bird(db, 'mate_f', 'doffer', null, null);
  const jong = bird(db, 'jong_f', 'doffer', mate.id, ik3.id);
  // Eén duif met een afwijking, één met een uitgesproken ras.
  zus.quirk = 'driewiek';
  pa.breed = 'meulemans';
  jong.breed = 'golden-ace';

  const tree = pedigreeOf(db, ik3, 3)!;
  const fam = familyOf(db, ik3, 2);
  const boxes = [tree, tree.sire!, tree.dam!, ...fam.siblings, ...fam.partners, ...fam.children];

  ok(boxes.every((b) => b.breed !== null), 'elke levende duif in het diagram draagt een ras');
  ok(boxes.every((b) => typeof b.breed?.image === 'string' && b.breed!.image.endsWith('.png')),
    'en dat ras wijst naar een echte foto');
  ok(tree.sire!.breed!.id === 'meulemans' && tree.sire!.breed!.rarity === 'zeldzaam',
    'de vader draagt zijn eigen ras, niet dat van de duif');
  ok(fam.children[0].breed!.id === 'golden-ace', 'het jong draagt zijn eigen ras');

  const zusNode = fam.siblings.find((x) => x.name === 'zus_f')!;
  ok(zusNode.quirk?.id === 'driewiek', 'de zus met een afwijking draagt die mee');
  ok(typeof zusNode.quirk?.name === 'string' && typeof zusNode.quirk?.emoji === 'string',
    'volledig genoeg voor de avatar (naam + emoji), niet enkel een id');
  ok(fam.children[0].quirk === null, 'een duif zonder afwijking draagt er geen');

  // Een duif die er niet meer is heeft geen rij, dus ook geen ras — dan valt de
  // stamboom terug op haar onthouden naam en een 🕊️/†, niet op een vreemde foto.
  const dood = bird(db, 'dood_f', 'doffer', null, null);
  const weeskind = bird(db, 'wees_f', 'duivin', dood.id, ma.id);
  db.pigeons = db.pigeons.filter((x) => x.id !== dood.id);
  const wt = pedigreeOf(db, weeskind, 2)!;
  ok(wt.sire!.breed === null && wt.sire!.alive === false,
    'een overleden voorouder draagt geen ras — geen foto die niet van haar is');
  ok(wt.sire!.name === 'dood_f', 'wel nog haar onthouden naam');

  // ⚠️ En de foto's moeten ook ECHT bestaan. Een ras dat naar een ontbrekend
  // bestand wijst geeft een leeg rondje in plaats van een duif, en dat is precies
  // het soort fout dat niemand opmerkt tot een speler het meldt.
  for (const b of PIGEON_BREEDS) {
    ok(existsSync(`./client/public/pigeon-images/${b.image}`),
      `de foto van ${b.name} bestaat (${b.image})`);
  }
}

// === Y0. Halfbroers/-zussen in de lastige gevallen ==========================
/*
 * Een halfbroer deelt maar ÉÉN ouder, dus hij hangt aan één draadje — en dat
 * draadje kan op twee manieren onzichtbaar lijken: hij zit in het hok van een
 * andere speler, of de ouder die ze delen is intussen gestorven. Allebei moeten
 * ze gewoon opduiken; de band wordt van de LEVENDE jongen gelezen, niet van de
 * ouder.
 */
console.log('\nHalfbroers en halfzussen: ander hok, en een dode gedeelde ouder');
{
  const db = world();
  const pa = bird(db, 'pa', 'doffer', null, null);
  const ma = bird(db, 'ma', 'duivin', null, null);
  const ma2 = bird(db, 'ma2', 'duivin', null, null);
  const dode = bird(db, 'dode_vader', 'doffer', null, null);

  const ik2 = bird(db, 'ik2', 'duivin', pa.id, ma.id);
  bird(db, 'half_zelfde_vader', 'doffer', pa.id, ma2.id);
  const elders = bird(db, 'half_ander_hok', 'duivin', pa.id, ma2.id);
  elders.ownerId = 'usr_b'; // andermans duif
  const wees = bird(db, 'wees', 'duivin', dode.id, ma2.id);
  bird(db, 'half_via_dode', 'doffer', dode.id, null);
  db.pigeons = db.pigeons.filter((x) => x.id !== dode.id); // de gedeelde vader sterft

  const f = familyOf(db, ik2, 2);
  ok(f.siblings.some((x) => x.name === 'half_ander_hok'),
    'een halfzus in het hok van een andere speler wordt gewoon getoond');
  ok(f.siblings.every((x) => !x.full), 'ze zijn allemaal half — enkel de vader is gedeeld');

  const fw = familyOf(db, wees, 2);
  const viaDode = fw.siblings.find((x) => x.name === 'half_via_dode');
  ok(!!viaDode, 'een halfbroer via een GESTORVEN gedeelde vader wordt nog gevonden');
  ok(viaDode?.sharedSire === true && viaDode?.sharedDam === false,
    'en de band loopt herkenbaar via de vader');
  ok(fw.siblings.length === 3, `wees heeft drie half-verwanten (${fw.siblings.map((x) => x.name).join(',')})`);
}

// === Y. Een dode ouder verbergt geen kinderen ===============================
console.log('\nEen dode ouder verbergt geen kinderen');
{
  const db = world();
  const moeder = bird(db, 'moeder', 'duivin', null, null);
  const vader = bird(db, 'vader2', 'doffer', null, null);
  bird(db, 'kindA', 'duivin', vader.id, moeder.id);
  bird(db, 'kindB', 'doffer', vader.id, moeder.id);
  // De vader sterft: zijn rij verdwijnt uit de wereld.
  db.pigeons = db.pigeons.filter((x) => x.id !== vader.id);

  const fam = familyOf(db, moeder, 2);
  ok(fam.children.length === 2, 'de moeder ziet haar twee jongen nog steeds');
  ok(fam.children.every((k) => k.partner !== null && !k.partner!.alive),
    'de overleden partner blijft zichtbaar, via de naam die het jong onthoudt');
  ok(fam.partners.length === 1 && fam.partners[0].id === null,
    'hij staat één keer in de partnerlijst, zonder eigen pagina');
  const kindA = db.pigeons.find((x) => x.id === 'kindA')!;
  const famA = familyOf(db, kindA, 2);
  ok(famA.siblings.length === 1 && famA.siblings[0].name === 'kindB',
    'broer en zus vinden elkaar nog via de gedeelde moeder');
  // ⚠️ De band via de dode vader BLIJFT zichtbaar: zijn id staat nog op beide
  // levende jongen. Enkel zijn eigen ouders zijn met hem verdwenen (zie kinship).
  ok(famA.siblings[0].full === true && famA.siblings[0].sharedSire,
    'ze blijven volle broer en zus — de dode vader is nog steeds herkenbaar aan zijn id');
}

// === Z. Een lijn die op zichzelf terugvalt loopt niet oneindig door =========
console.log('\nEen lus in de afstamming');
{
  const db = world();
  const a = bird(db, 'lus_a', 'doffer', null, null);
  const b = bird(db, 'lus_b', 'duivin', null, null);
  const c = bird(db, 'lus_c', 'duivin', a.id, b.id);
  // c wordt met haar eigen vader gekoppeld — inteelt, maar het mág.
  bird(db, 'lus_d', 'doffer', a.id, c.id);
  const fam = familyOf(db, a, 3);
  ok(fam.children.length === 2, 'de doffer ziet beide jongen (ook dat uit zijn eigen dochter)');
  ok(countDown(fam.children) < 50, 'de recursie loopt niet op hol');
}
function countDown(nodes: { children: any[] }[]): number {
  return nodes.reduce((t, n) => t + 1 + countDown(n.children), 0);
}

// === 2. Stamboom ============================================================
console.log('\nStamboom');
{
  const db = world();
  const opa = bird(db, 'opa', 'doffer', null, null);
  const oma = bird(db, 'oma', 'duivin', null, null);
  const vader = bird(db, 'vader', 'doffer', opa.id, oma.id);
  const moeder = bird(db, 'moeder', 'duivin', null, null);
  const kind = bird(db, 'kind', 'duivin', vader.id, moeder.id);

  const tree = pedigreeOf(db, kind, 3)!;
  ok(tree.sire?.name === 'vader', 'vader hangt onder het kind');
  ok(tree.sire?.sire?.name === 'opa', 'grootvader hangt onder de vader');
  ok(tree.sire?.sire?.alive === true, 'een levende voorouder is als levend gemarkeerd');
  ok(tree.sire?.sire?.ownerName === 'Hok A', 'en draagt de naam van het hok waar ze zit');
  ok(tree.dam?.name === 'moeder' && tree.dam?.sire === null, 'een grondduif heeft geen ouders');
  ok(typeof tree.sire?.talent === 'number', 'talent is publiek en wordt meegestuurd');

  // Dode grootvader: naam blijft, maar de tak stopt.
  db.pigeons = db.pigeons.filter((p) => p.id !== 'opa');
  const after = pedigreeOf(db, kind, 3)!;
  ok(after.sire?.sire?.name === 'opa', 'een dode voorouder wordt nog steeds bij naam genoemd');
  ok(after.sire?.sire?.alive === false, 'maar staat als overleden');
  ok(after.sire?.sire?.ownerId === null, 'en heeft geen eigenaar meer');
  ok(after.sire?.sire?.sire === null, 'de tak stopt daar — haar ouders zijn met haar verdwenen');
}

// === 3. Een lus in de stamboom laat niets vastlopen =========================
console.log('\nEen lijn die op zichzelf terugvalt');
{
  const db = world();
  const a = bird(db, 'a', 'doffer', null, null);
  const b = bird(db, 'b', 'duivin', null, null);
  const kind = bird(db, 'kind', 'duivin', a.id, b.id);
  // Vader × dochter: het kind daarvan heeft 'a' twee keer in de boom.
  const kleinkind = bird(db, 'kleinkind', 'duivin', a.id, kind.id);
  const tree = pedigreeOf(db, kleinkind, 3);
  ok(tree !== null, 'de boom wordt gebouwd zonder vast te lopen');
  ok(ancestorIds(db, kleinkind, 3).has('a'), 'de dubbele voorouder zit één keer in de verzameling');
}

// === 4. Inteelt heeft echte gevolgen ========================================
console.log('\nInteelt: lagere plafonds en een afwijking');
{
  const db = world();
  const opa = bird(db, 'opa', 'doffer', null, null);
  const oma = bird(db, 'oma', 'duivin', null, null);
  const broer = bird(db, 'broer', 'doffer', opa.id, oma.id);
  const zus = bird(db, 'zus', 'duivin', opa.id, oma.id);
  for (const p of [broer, zus]) { p.libido = 100; p.form = 100; }

  // Genoeg worpen om de kans betrouwbaar te meten.
  let normaalCaps = 0, normaalN = 0, inteeltCaps = 0, inteeltN = 0, metQuirk = 0;
  for (let i = 0; i < 400; i++) {
    for (const y of breed(broer, zus, 'usr_a', 200, undefined, undefined, null)) {
      normaalCaps += y.genes!.speed; normaalN++;
    }
    for (const y of breed(broer, zus, 'usr_a', 200, undefined, undefined, 'volle')) {
      inteeltCaps += y.genes!.speed; inteeltN++;
      if (y.quirk) metQuirk++;
    }
  }
  const gemNormaal = normaalCaps / normaalN;
  const gemInteelt = inteeltCaps / inteeltN;
  const quirkRatio = metQuirk / inteeltN;
  ok(inteeltN > 0 && normaalN > 0, `worpen gemeten (${normaalN} normaal, ${inteeltN} inteelt)`);
  ok(gemInteelt < gemNormaal - 10,
    `inteeltjongen hebben lagere gen-caps (${gemNormaal.toFixed(1)} → ${gemInteelt.toFixed(1)})`);
  ok(Math.abs(quirkRatio - INBREEDING.quirkChance.volle) < 0.08,
    `afwijkingskans klopt (${(quirkRatio * 100).toFixed(0)}% vs ${INBREEDING.quirkChance.volle * 100}%)`);
  ok(gemInteelt >= INBREEDING.minGeneCap, `nooit onder de bodem van ${INBREEDING.minGeneCap}`);

  // Een gewone worp mag NOOIT een afwijking krijgen.
  let normaalQuirks = 0;
  for (let i = 0; i < 300; i++) {
    for (const y of breed(broer, zus, 'usr_a', 200, undefined, undefined, null)) if (y.quirk) normaalQuirks++;
  }
  ok(normaalQuirks === 0, 'een niet-verwant koppel levert nooit een afwijking op');

  // De ergste graad moet harder aankomen dan de mildste.
  const capFor = (kin: any) => {
    let sum = 0, n = 0;
    for (let i = 0; i < 300; i++) {
      for (const y of breed(broer, zus, 'usr_a', 200, undefined, undefined, kin)) { sum += y.genes!.endurance; n++; }
    }
    return sum / n;
  };
  ok(capFor('directe-lijn') < capFor('familie'),
    'hoe nauwer de verwantschap, hoe lager de plafonds');
}

// === 5. Oudernamen worden onthouden =========================================
console.log('\nOudernamen bij de geboorte');
{
  const db = world();
  const v = bird(db, 'v', 'doffer', null, null);
  const m = bird(db, 'm', 'duivin', null, null);
  v.name = 'Karel de Kale';
  m.name = 'Rita de Rappe';
  v.libido = 100; m.libido = 100; v.form = 100; m.form = 100;
  const young = breed(v, m, 'usr_a', 200, undefined, undefined, null);
  ok(young.length > 0 && young[0].sireName === 'Karel de Kale', 'de naam van de vader rijdt mee');
  ok(young.length > 0 && young[0].damName === 'Rita de Rappe', 'de naam van de moeder rijdt mee');
}

// === 6. Kweekleeftijd =======================================================
console.log(`\nKweekleeftijd (${BREEDING.minAgeWeeks} weken)`);
ok(BREEDING.minAgeWeeks === 8, `de grens staat op ${BREEDING.minAgeWeeks} weken`);

// === 7. Namenpool ===========================================================
console.log('\nVariatie in de namen');
{
  const totalEpithets = new Set(
    Object.values(EPITHETS).flatMap((v) => [...(v as readonly string[])]),
  ).size;
  ok(MALE_FIRST_NAMES.length >= 100, `mannelijke voornamen: ${MALE_FIRST_NAMES.length}`);
  ok(FEMALE_FIRST_NAMES.length >= 100, `vrouwelijke voornamen: ${FEMALE_FIRST_NAMES.length}`);
  ok(totalEpithets >= 150, `unieke bijnamen: ${totalEpithets}`);

  // Geen duplicaten binnen een lijst — een dubbele naam verlaagt de variatie stil.
  const dupes = (xs: readonly string[]) => xs.length - new Set(xs).size;
  ok(dupes(MALE_FIRST_NAMES) === 0, `geen dubbele mannennamen (${dupes(MALE_FIRST_NAMES)})`);
  ok(dupes(FEMALE_FIRST_NAMES) === 0, `geen dubbele vrouwennamen (${dupes(FEMALE_FIRST_NAMES)})`);

  // Hoeveel VERSCHILLENDE namen levert een realistische wereld op?
  const taken = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const n = generatePigeonName(i % 2 ? 'doffer' : 'duivin', { speed: 70, endurance: 70, orientation: 70 }, taken);
    taken.add(nameKey(n));
  }
  ok(taken.size === 300, `300 duiven, 300 verschillende namen (${taken.size})`);

  // En hoe vaak komt dezelfde BIJNAAM terug over een clubgrootte?
  const epithetCounts = new Map<string, number>();
  for (let i = 0; i < 300; i++) {
    const n = generatePigeonName(i % 2 ? 'doffer' : 'duivin', { speed: 70, endurance: 70, orientation: 70 });
    const ep = n.split(' ').slice(1).join(' ');
    epithetCounts.set(ep, (epithetCounts.get(ep) ?? 0) + 1);
  }
  const worst = Math.max(...epithetCounts.values());
  console.log(`     → ${epithetCounts.size} verschillende bijnamen op 300 duiven, drukste komt ${worst}× voor`);
  ok(epithetCounts.size >= 80, `ruim voldoende verschillende bijnamen (${epithetCounts.size})`);
  ok(worst <= 30, `geen enkele bijnaam domineert (drukste: ${worst}×)`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald\n`);
if (fail > 0) process.exitCode = 1;
