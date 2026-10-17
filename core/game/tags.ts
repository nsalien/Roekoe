/**
 * Tags op je duiven: free text an owner puts on a bird — "sprint", "mid-fond",
 * "lange-fond", whatever helps them pick the right bird for a flight. They are
 * private (only the owner ever gets them in a DTO, see presenters.pigeonDTO),
 * have no effect on the game, and stay with the old loft when the bird changes
 * hands: they live on `Pigeon.care`, which clearOwnerCare (inrichting.ts) wipes
 * on every sale, accepted offer, auction and duivenlokker catch.
 *
 * Stored in the existing `care` JSON column, so no schema step and no extra
 * query; an untagged bird writes nothing new.
 */

import { PIGEON_TAGS } from '../config/gameConfig.js';
import type { Pigeon } from '../schema.js';
import type { Store } from '../store.js';

/** Invisible and control characters a tag must not carry (zero-width, bidi overrides, …). */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤﻿]/g;

/**
 * Clean what the player typed: a comma-separated string or a list. Every tag is
 * trimmed, its inner whitespace collapsed and a leading '#' dropped; empty ones
 * go, and a tag that is already there (whatever its case) is not added twice.
 * Too many or too long is an error rather than a silent cut, so the player sees
 * exactly what was saved.
 */
export function normalizeTags(input: unknown): { tags: string[] } | { error: string } {
  const pieces = Array.isArray(input)
    ? input.flatMap((x) => (typeof x === 'string' ? x.split(',') : []))
    : typeof input === 'string' ? input.split(',') : [];
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of pieces) {
    const tag = raw.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '');
    if (!tag) continue;
    if (Array.from(tag).length > PIGEON_TAGS.maxLength) {
      return { error: `Een tag is hoogstens ${PIGEON_TAGS.maxLength} tekens ("${Array.from(tag).slice(0, PIGEON_TAGS.maxLength).join('')}…")` };
    }
    const key = tag.toLocaleLowerCase('nl-BE');
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > PIGEON_TAGS.max) return { error: `Hoogstens ${PIGEON_TAGS.max} tags per duif` };
  return { tags };
}

/** The owner's tags on this bird (empty if none). */
export function pigeonTags(p: Pigeon): string[] {
  return p.care?.tags ?? [];
}

/** Put the owner's tags on one of their birds; an empty list removes them. */
export function setPigeonTags(store: Store, userId: string, pigeonId: string, input: unknown): string | null {
  const clean = normalizeTags(input);
  if ('error' in clean) return clean.error;
  return store.mutate((db) => {
    const p = db.pigeons.find((x) => x.id === pigeonId && x.ownerId === userId);
    if (!p) return 'Duif niet gevonden';
    if (clean.tags.length > 0) {
      p.care = { ...(p.care ?? {}), tags: clean.tags };
    } else if (p.care) {
      // Leave no empty shell behind: an untouched bird writes '' (see pigeonRow).
      delete p.care.tags;
      if (Object.keys(p.care).length === 0) delete p.care;
    }
    return null;
  });
}
