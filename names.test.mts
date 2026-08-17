/**
 * Names must be unique: every first name + epithet combination in the world is
 * one of a kind, however the bird got there (start loft, breeding, auction,
 * shelter, dilemma). A duplicate name is confusing in the rankings, the market
 * and the live board, where the name is all you see.
 *
 * Run: npx tsx names.test.mts
 */
import { emptyDatabase } from './core/schema.js';
import { generatePigeon } from './core/game/pigeon.js';
import { generatePigeonName, nameKey, namesInUse } from './core/game/names.js';
import { breed } from './core/game/breeding.js';
import { MALE_FIRST_NAMES, FEMALE_FIRST_NAMES, EPITHETS } from './core/config/gameConfig.js';

let failures = 0;
const ok = (c: boolean, m: string) => { if (!c) failures++; console.log(`${c ? '  ✓' : '  ✗'} ${m}`); };

console.log('\nGrote toevloed van nieuwe duiven');
const db = emptyDatabase();
db.world.currentWeek = 100;
const taken = namesInUse(db.pigeons);
for (let i = 0; i < 400; i++) {
  const p = generatePigeon({ ownerId: 'u1', currentWeek: 100, quality: Math.random(), taken });
  taken.add(nameKey(p.name));
  db.pigeons.push(p);
}
const keys = db.pigeons.map((p) => nameKey(p.name));
ok(new Set(keys).size === keys.length,
  `${db.pigeons.length} duiven, ${new Set(keys).size} unieke namen`);
ok(db.pigeons.every((p) => p.name.includes(' ')), 'elke naam heeft een voornaam en een bijnaam');

console.log('\nGekweekte jongen (ook een tweeling onderling)');
const sire = db.pigeons.find((p) => p.sex === 'doffer')!;
const dam = db.pigeons.find((p) => p.sex === 'duivin')!;
const before = db.pigeons.length;
for (let i = 0; i < 40; i++) {
  const young = breed(sire, dam, 'u1', 100, namesInUse(db.pigeons));
  db.pigeons.push(...young);
}
const keys2 = db.pigeons.map((p) => nameKey(p.name));
ok(new Set(keys2).size === keys2.length,
  `na ${db.pigeons.length - before} jongen nog steeds ${new Set(keys2).size} unieke namen op ${keys2.length}`);

console.log('\nAls de pool op is, begint een dynastie');
const small = new Set<string>();
const combos = (MALE_FIRST_NAMES.length) * (EPITHETS.neutral.length + EPITHETS.dark.length + EPITHETS.legend.length + 12);
for (let i = 0; i < 60; i++) small.add(nameKey(generatePigeonName('doffer', undefined, small) ?? ''));
// Vul kunstmatig alle namen op zodat het achtervoegsel moet ingrijpen.
const exhausted = new Set<string>();
for (const f of MALE_FIRST_NAMES) {
  for (const e of [...EPITHETS.neutral, ...EPITHETS.dark, ...EPITHETS.legend,
                   ...EPITHETS.fastSpeed, ...EPITHETS.slowSpeed, ...EPITHETS.highEndurance,
                   ...EPITHETS.lowEndurance, ...EPITHETS.highOrientation, ...EPITHETS.lowOrientation]) {
    exhausted.add(nameKey(`${f} ${e}`));
  }
}
const fallback = generatePigeonName('doffer', undefined, exhausted);
ok(!exhausted.has(nameKey(fallback)), `uitgeputte pool (${exhausted.size} combinaties) geeft toch een vrije naam: "${fallback}"`);
ok(/\s(II|III|IV|V|VI|VII|VIII|IX|X)$/.test(fallback), 'met een romeins nummer als achtervoegsel');

console.log('\nEchte kampioenen zitten in de pool');
const legendish = ['de Kannibaal', 'de Nieuwe Kim', 'de Armando', 'de Barcelona-Kampioen'];
ok(legendish.every((l) => (EPITHETS.legend as readonly string[]).includes(l)), 'legendarische bijnamen aanwezig');
ok((MALE_FIRST_NAMES as readonly string[]).includes('Armando') && (FEMALE_FIRST_NAMES as readonly string[]).includes('Kim'),
   'voornamen van echte kampioenen aanwezig');
console.log(failures ? `\nFAILED — ${failures} controle(s) mislukt` : '\nAlles OK');
if (failures) process.exitCode = 1;
