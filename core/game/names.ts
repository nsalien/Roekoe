/**
 * Funny Dutch/Flemish pigeon names. The epithet is usually derived from the
 * pigeon's most extreme genetic trait, so the name hints at what the bird is
 * (good or bad) at — e.g. a low-endurance bird tends to become "Betsy de Fatsy",
 * a fast one "Harry de Hete".
 */

import { EPITHETS, PIGEON_FIRST_NAMES, PIGEON_NAMES } from '../config/gameConfig.js';
import { pick } from './util.js';

interface Traitish {
  speed: number;
  endurance: number;
  orientation: number;
}

/** Choose an epithet that fits the pigeon's standout (or standout-bad) trait. */
function epithetForTraits(t: Traitish): string {
  // Find the most extreme trait (furthest from the average of ~50).
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

/**
 * Generate a full funny name. Roughly: 30% pitch-black humour, otherwise
 * ~45% trait-based (so the name hints at the bird's standout trait) and the
 * rest a neutral epithet.
 */
export function generatePigeonName(traits?: Traitish): string {
  const first = pick(PIGEON_FIRST_NAMES);
  const r = Math.random();
  let epithet: string;
  if (r < 0.3) epithet = pick(EPITHETS.dark);
  else if (traits && r < 0.75) epithet = epithetForTraits(traits);
  else epithet = pick(EPITHETS.neutral);
  return `${first} ${epithet}`;
}

/** True for the old single-word names, so a migration can rename them. */
export function isLegacyName(name: string): boolean {
  return !name.includes(' ') || (PIGEON_NAMES as readonly string[]).includes(name);
}
