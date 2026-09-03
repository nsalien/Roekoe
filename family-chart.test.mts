/**
 * Regressietest: het stamboomDIAGRAM klopt geometrisch.
 *
 * De verbindingslijnen worden als PERCENTAGES van de kolomhoogte getekend
 * (`centre(i, n)`), en dat rust op twee dingen die stil kunnen breken:
 *
 *  1. de duif staat DEAD CENTRE van haar eigen kolom — anders komt de lijn van
 *     haar ouders naast haar uit in plaats van op haar;
 *  2. elke verwijzing in een `LinkGroup` wijst naar een cel die ook bestaat en
 *     die een duif bevat.
 *
 * Draai deze test na élke wijziging aan `buildLayout` of aan de kolomopbouw in
 * `client/src/components/Pedigree.tsx`.
 *
 * Run: npx tsx family-chart.test.mts
 */
import { readFileSync } from 'node:fs';
import { buildLayout, centre, type Layout } from './client/src/components/Pedigree.js';
import type { AncestorNode, FamilyMember, FamilyTree } from './client/src/types.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const mem = (name: string, sex: 'doffer' | 'duivin', extra: Partial<FamilyMember> = {}): FamilyMember => ({
  id: name, name, sex, alive: true, ownerName: 'Hok A', ownerId: 'me',
  talent: 70, image: null, quirk: null, ...extra,
});
const anc = (name: string, sex: 'doffer' | 'duivin', sire: AncestorNode | null = null, dam: AncestorNode | null = null): AncestorNode =>
  ({ ...mem(name, sex), sire, dam });

/** Bird with two parents and four grandparents. */
const root = anc('IK', 'duivin',
  anc('PA', 'doffer', anc('OPA1', 'doffer'), anc('OMA1', 'duivin')),
  anc('MA', 'duivin', anc('OPA2', 'doffer'), anc('OMA2', 'duivin')));

const kid = (name: string, partner: FamilyMember | null, children: any[] = []): any =>
  ({ ...mem(name, 'doffer'), partner, children });

const mateA = mem('MATE_A', 'doffer');
const mateB = mem('MATE_B', 'doffer');

const family: FamilyTree = {
  siblings: [
    { ...mem('ZUS', 'duivin'), full: true, sharedSire: true, sharedDam: true },
    { ...mem('HALFBROER', 'doffer'), full: false, sharedSire: true, sharedDam: false },
    { ...mem('HALFZUS', 'duivin'), full: false, sharedSire: false, sharedDam: true },
  ],
  partners: [mateA, mateB],
  children: [
    kid('KIND1', mateA, [kid('KLEIN1', null), kid('KLEIN2', null)]),
    kid('KIND2', mateB),
    kid('KIND3', mateA),
  ],
};

const L: Layout = buildLayout(root, family);
const col = (label: string) => L.columns.findIndex((c) => c.label === label);

console.log('\nKolommen: voorouders links, de duif in het midden, jongen rechts');
{
  const labels = L.columns.map((c) => c.label);
  ok(labels.join(' | ') === 'Grootouders | Ouders | Deze duif | Kinderen | Kleinkinderen',
    `volgorde klopt (${labels.join(' | ')})`);
  ok(L.gaps.length === L.columns.length - 1, `één tussenruimte per paar kolommen (${L.gaps.length})`);
}

console.log('\nDe duif staat exact in het midden van haar kolom');
{
  const c = L.columns[col('Deze duif')];
  const self = c.cells.findIndex((x) => x.self);
  ok(self >= 0, 'de duif zit in haar eigen kolom');
  ok(c.cells.length % 2 === 1, `oneven aantal cellen (${c.cells.length})`);
  ok(self === (c.cells.length - 1) / 2, `en staat op de middelste plaats (${self} van ${c.cells.length})`);
  ok(Math.abs(centre(self, c.cells.length) - 50) < 1e-9,
    `dus haar hart ligt op 50% (${centre(self, c.cells.length)}%)`);
  // Ouders zitten op 25% en 75%; hun bundel ontmoet elkaar dus precies op haar.
  ok(Math.abs((centre(0, 2) + centre(1, 2)) / 2 - 50) < 1e-9,
    'het midden tussen vader (25%) en moeder (75%) ligt op diezelfde 50%');
}

console.log('\nBroers, zussen én partners staan in die kolom');
{
  const c = L.columns[col('Deze duif')];
  const names = c.cells.filter((x) => x.node).map((x) => x.node!.name);
  for (const n of ['ZUS', 'HALFBROER', 'HALFZUS', 'IK', 'MATE_A', 'MATE_B']) {
    ok(names.includes(n), `${n} staat in het diagram`);
  }
  const notes = c.cells.filter((x) => x.node).map((x) => x.note ?? '');
  ok(notes.some((n) => n.startsWith('volle')), 'een volle zus is als vol gelabeld');
  ok(notes.some((n) => n.includes('zelfde vader')), 'een halfbroer noemt de gedeelde ouder');
  ok(notes.filter((n) => n === 'partner').length === 2, 'beide partners zijn als partner gelabeld');
}

console.log('\nDe ouders verbinden met de hele broedergroep, niet met de partners');
{
  const g = L.gaps[col('Deze duif') - 1];
  ok(g.length === 1, `één bundel van de ouders (${g.length})`);
  const c = L.columns[col('Deze duif')];
  const linked = g[0].right.map((i) => c.cells[i].node!.name).sort();
  ok(linked.join(',') === 'HALFBROER,HALFZUS,IK,ZUS', `de vier verwanten hangen eraan (${linked.join(',')})`);
  ok(!g[0].right.some((i) => c.cells[i].note === 'partner'), 'een partner hangt NIET aan haar schoonouders');
  ok(g[0].left.length === 2, 'en er vertrekken twee lijnen: vader en moeder');
}

console.log('\nElk nest hangt aan de duif én aan de juiste partner');
{
  const g = L.gaps[col('Kinderen') - 1];
  const mid = L.columns[col('Deze duif')];
  const kids = L.columns[col('Kinderen')];
  const selfIdx = mid.cells.findIndex((x) => x.self);
  ok(g.length === 2, `twee nesten, twee bundels (${g.length})`);
  for (const grp of g) {
    ok(grp.left.includes(selfIdx), 'de duif zelf staat aan de linkerkant van de bundel');
    ok(grp.left.length === 2, 'en de andere ouder erbij');
    const mate = mid.cells[grp.left.find((i) => i !== selfIdx)!].node!.name;
    const viaKids = grp.right.map((i) => (kids.cells[i].node as any).partner.name);
    ok(viaKids.every((v) => v === mate), `alle jongen in deze bundel komen uit ${mate}`);
  }
  const runs = g.map((x) => x.right);
  ok(runs.every((r) => r.every((v, i) => i === 0 || v === r[i - 1] + 1)),
    'elk nest ligt aaneengesloten, dus de haak is één ononderbroken span');
}

console.log('\nKleinkinderen hangen aan hun eigen ouder');
{
  const g = L.gaps[col('Kleinkinderen') - 1];
  const kids = L.columns[col('Kinderen')];
  ok(g.length === 1, 'één kind heeft jongen, dus één bundel');
  ok(kids.cells[g[0].left[0]].node!.name === 'KIND1', 'en die bundel vertrekt bij KIND1');
  ok(g[0].right.length === 2, 'met twee kleinkinderen eraan');
}

console.log('\nElke verwijzing wijst naar een bestaande, gevulde cel');
{
  let bad = 0;
  L.gaps.forEach((groups, gi) => {
    const left = L.columns[gi].cells;
    const right = L.columns[gi + 1].cells;
    for (const g of groups) {
      for (const i of g.left) if (!left[i]?.node) bad++;
      for (const i of g.right) if (!right[i]?.node) bad++;
    }
  });
  ok(bad === 0, `geen enkele lijn wijst naar een lege of onbestaande cel (${bad})`);
}

console.log('\nEen duif zonder familie levert geen kapot diagram op');
{
  const solo = buildLayout(anc('SOLO', 'duivin'), { siblings: [], partners: [], children: [] });
  ok(solo.columns.length === 1 && solo.columns[0].label === 'Deze duif', 'enkel haar eigen kolom');
  ok(solo.columns[0].cells.length === 1, 'met één cel');
  ok(solo.gaps.length === 0, 'en geen enkele lijn');
}

console.log('\nOneven aantal broers/zussen tegenover partners blijft gecentreerd');
{
  for (const [nSib, nMate] of [[0, 3], [5, 1], [1, 0], [4, 4]]) {
    const f: FamilyTree = {
      siblings: Array.from({ length: nSib }, (_, i) => ({ ...mem(`S${i}`, 'duivin'), full: true, sharedSire: true, sharedDam: true })),
      partners: Array.from({ length: nMate }, (_, i) => mem(`M${i}`, 'doffer')),
      children: [],
    };
    const lay = buildLayout(root, f);
    const c = lay.columns[lay.columns.findIndex((x) => x.label === 'Deze duif')];
    const self = c.cells.findIndex((x) => x.self);
    ok(self === (c.cells.length - 1) / 2, `${nSib} broers/zussen + ${nMate} partners → duif blijft in het midden`);
  }
}

// === De avatar mag zichzelf niet wegcijferen ================================
/*
 * ⚠️ Een echte, lang onopgemerkte bug: `PigeonAvatar` zette `padding: '10%'` op
 * het ronde kader. Procentuele padding rekent tegen de breedte van het
 * CONTAINING BLOCK, niet tegen het kader zelf — dus naast een rij van 340 px
 * werd dat 34 px padding op een avatar van 44 px. De inhoudsdoos klapte samen
 * tot nul en de foto werd op 0×0 gelegd. De afbeelding LAADDE gewoon, dus er
 * kwam geen enkele fout: enkel een leeg rondje.
 *
 * Gemeten in de browser, vóór → na:
 *   44px → 0 (onzichtbaar) → 32   ·   54px → 0 → 40   ·   64px → 0 → 48
 *   112px → 42 (halve grootte) → 86  ·  120px → 50 → 92
 *
 * Dit raakte élke avatar onder ~100 px in het hele spel, niet enkel de
 * stamboom. Een browsertest hoort hier niet thuis, maar de regel wel: de
 * padding moet uit de `size`-prop komen, nooit uit een percentage.
 */
console.log('\nDe avatar rekent zijn padding in pixels, niet in procenten');
{
  const src = readFileSync('./client/src/components/PigeonAvatar.tsx', 'utf8');
  const pad = src.match(/padding:\s*([^,\n]+)/g) ?? [];
  ok(pad.length > 0, `er staat padding op het kader (${pad.length}×)`);
  ok(!pad.some((l) => l.includes('%')),
    `geen enkele padding in procenten (${pad.join(' | ')})`);
  ok(pad.some((l) => l.includes('size')),
    'de padding wordt uit de size-prop berekend');
}

console.log(fail === 0 ? `\n✅ ${pass} geslaagd, 0 gefaald\n` : `\n❌ ${pass} geslaagd, ${fail} gefaald\n`);
if (fail > 0) process.exitCode = 1;
