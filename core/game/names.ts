/**
 * Funny Flemish pigeon names. Doffers get male first names, duivinnen female
 * ones. The epithet is a mix of trait-based, neutral and pitch-black humour;
 * where possible it alliterates with the first name (e.g. "Stevie de Snelle",
 * "Dirk de Doodgraver").
 */

import {
  EPITHETS,
  FEMALE_FIRST_NAMES,
  MALE_FIRST_NAMES,
  PIGEON_FIRST_NAMES,
  PIGEON_NAMES,
} from '../config/gameConfig.js';
import type { Sex } from '../schema.js';
import { pick } from './util.js';

interface Traitish {
  speed: number;
  endurance: number;
  orientation: number;
}

/** Choose an epithet that fits the pigeon's standout (or standout-bad) trait. */
function epithetForTraits(t: Traitish): string {
  const traits: { key: 'speed' | 'endurance' | 'orientation'; v: number }[] = [
    { key: 'speed', v: t.speed },
    { key: 'endurance', v: t.endurance },
    { key: 'orientation', v: t.orientation },
  ];
  let extreme = traits[0];
  for (const tr of traits) if (Math.abs(tr.v - 50) > Math.abs(extreme.v - 50)) extreme = tr;

  const high = extreme.v >= 50;
  if (extreme.key === 'speed') return pick(high ? EPITHETS.fastSpeed : EPITHETS.slowSpeed);
  if (extreme.key === 'endurance') return pick(high ? EPITHETS.highEndurance : EPITHETS.lowEndurance);
  return pick(high ? EPITHETS.highOrientation : EPITHETS.lowOrientation);
}

const SMALL_WORDS = new Set([
  'de', 'den', 'het', 'met', 'op', 'van', 'uit', 'zonder', 't', "'t", 'een', 'la',
]);

/** The initial letter of an epithet's key (memorable) word, uppercased. */
function epithetInitial(epithet: string): string {
  for (const word of epithet.split(/[\s-]+/)) {
    if (!word) continue;
    if (SMALL_WORDS.has(word.toLowerCase())) continue;
    return word[0].toUpperCase();
  }
  return epithet[0]?.toUpperCase() ?? '';
}

/** One attempt at a name, before any uniqueness check. */
function draftName(sex: Sex, traits?: Traitish): string {
  const first = pick(sex === 'doffer' ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES);

  // Build the candidate epithet pool for this bird.
  const r = Math.random();
  let pool: readonly string[];
  if (r < 0.08) pool = EPITHETS.legend; // a rare nod to the real greats
  else if (r < 0.32) pool = EPITHETS.dark;
  else if (traits && r < 0.72) pool = [epithetForTraits(traits)]; // already a single fit
  else pool = EPITHETS.neutral;

  // Prefer an alliterating epithet from the broadest sensible set.
  const initial = first[0]?.toUpperCase() ?? '';
  const wide = [...pool, ...EPITHETS.neutral, ...EPITHETS.dark, ...EPITHETS.legend];
  const alliterating = wide.filter((e) => epithetInitial(e) === initial);
  const epithet =
    alliterating.length > 0 && Math.random() < 0.7 ? pick(alliterating) : pick(pool);

  return `${first} ${epithet}`;
}

/** Roman numerals for the fallback suffix — a dynasty reads better than "#2". */
const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Case-insensitive key, so "Rita de Rappe" and "rita de rappe" are the same name. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Every name currently in use, ready to pass to `generatePigeonName`. */
export function namesInUse(pigeons: readonly { name: string }[]): Set<string> {
  return new Set(pigeons.map((p) => nameKey(p.name)));
}

/**
 * Generate a full name for a pigeon of the given sex. Roughly a quarter of the
 * names lean into pitch-black humour, a few honour real racing legends, the rest
 * are trait-based or neutral. When an alliterating epithet exists it's preferred,
 * giving names like "Stevie de Snelle".
 *
 * **Every first name + epithet combination is unique.** Pass the names already in
 * the world (`namesInUse`) and this keeps drawing until it finds a free one; if the
 * pools are genuinely exhausted it starts a dynasty instead ("Rita de Rappe III").
 * The caller is responsible for adding the returned name to the set when it
 * generates several birds in a row.
 */
export function generatePigeonName(sex: Sex, traits?: Traitish, taken?: ReadonlySet<string>): string {
  if (!taken || taken.size === 0) return draftName(sex, traits);

  for (let attempt = 0; attempt < 80; attempt++) {
    const candidate = draftName(sex, traits);
    if (!taken.has(nameKey(candidate))) return candidate;
  }
  // Pools exhausted for this sex (or very unlucky): number the newcomer.
  const base = draftName(sex, traits);
  for (const numeral of ROMAN) {
    const candidate = `${base} ${numeral}`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
  return `${base} ${Date.now().toString(36).slice(-4)}`;
}

/** True for old single-word names or a wrong-gender first name, so a migration
 *  can rename them. */
export function isLegacyName(name: string): boolean {
  if (!name.includes(' ')) return true;
  if ((PIGEON_NAMES as readonly string[]).includes(name)) return true;
  return false;
}

/** True when a name's first word doesn't match the pigeon's sex. */
export function isWrongGenderName(name: string, sex: Sex): boolean {
  const first = name.split(' ')[0];
  const list = sex === 'doffer' ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES;
  const other = sex === 'doffer' ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES;
  // Only flag names we recognise as belonging to the other sex.
  return !(list as readonly string[]).includes(first) && (other as readonly string[]).includes(first);
}

// Keep PIGEON_FIRST_NAMES referenced so its export stays used.
void PIGEON_FIRST_NAMES;
