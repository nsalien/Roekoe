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

/**
 * Generate a full name for a pigeon of the given sex. Roughly a quarter of the
 * names lean into pitch-black humour, the rest are trait-based or neutral. When
 * an alliterating epithet exists it's preferred, giving names like
 * "Stevie de Snelle".
 */
export function generatePigeonName(sex: Sex, traits?: Traitish): string {
  const first = pick(sex === 'doffer' ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES);

  // Build the candidate epithet pool for this bird.
  const r = Math.random();
  let pool: readonly string[];
  if (r < 0.28) pool = EPITHETS.dark;
  else if (traits && r < 0.7) pool = [epithetForTraits(traits)]; // already a single fit
  else pool = EPITHETS.neutral;

  // Prefer an alliterating epithet from the broadest sensible set.
  const initial = first[0]?.toUpperCase() ?? '';
  const wide = [...pool, ...EPITHETS.neutral, ...EPITHETS.dark];
  const alliterating = wide.filter((e) => epithetInitial(e) === initial);
  const epithet =
    alliterating.length > 0 && Math.random() < 0.7 ? pick(alliterating) : pick(pool);

  return `${first} ${epithet}`;
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
