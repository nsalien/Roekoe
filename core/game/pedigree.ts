/**
 * Afstamming: walking a pigeon's family tree, and deciding whether two birds are
 * too closely related to pair.
 *
 * ⚠️ The tree is only walkable through birds that are STILL ALIVE. A dead pigeon
 * leaves no row, so its own parent ids are gone with it and the branch stops
 * there. `Pigeon.sireName`/`damName` let us still NAME that last ancestor, which
 * is why they are denormalised onto the child (see schema.ts) — but they carry no
 * ids, so they are a leaf, never a step.
 *
 * That truncation shapes the kinship check too, though less than it looks. A dead
 * ancestor is still IDENTIFIABLE — its id sits on its living child — so a shared
 * dead parent or grandparent still ties two birds together. What is lost is
 * everything BEYOND that bird: with no row, its own parent ids are gone.
 *
 * So the check only goes blind when every path to the common ancestor runs through
 * a bird that has also died. That fails open on purpose: a tie nobody can trace is
 * one that generations have already diluted, and refusing a pairing on evidence we
 * cannot show the player would only be confusing.
 */

import { INBREEDING, type KinshipDegree } from '../config/gameConfig.js';
import type { Database, Pigeon } from '../schema.js';
import { breedInfo, talent } from './pigeon.js';

/** One box in the tree. `alive` false means we only know it from a parent's name. */
export interface AncestorNode {
  id: string | null; // null once we only have a remembered name
  name: string;
  sex: 'doffer' | 'duivin';
  /** Still in the world (so it has an owner and a page of its own). */
  alive: boolean;
  ownerName: string | null;
  ownerId: string | null;
  talent: number | null;
  /** Breed image filename, so the tree can show the same little portrait. */
  image: string | null;
  quirk: string | null;
  sire: AncestorNode | null;
  dam: AncestorNode | null;
}

/**
 * Every ancestor id of `pigeon`, up to `depth` generations, EXCLUDING the bird
 * itself. Only ids are collected, so this stops at a dead ancestor by nature.
 */
export function ancestorIds(db: Database, pigeon: Pigeon, depth: number): Set<string> {
  const seen = new Set<string>();
  let frontier: string[] = [pigeon.sireId, pigeon.damId].filter((x): x is string => !!x);
  for (let gen = 0; gen < depth && frontier.length > 0; gen++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue; // a line that folds back on itself
      seen.add(id);
      const bird = db.pigeons.find((p) => p.id === id);
      if (!bird) continue; // dead: the branch ends here
      if (bird.sireId) next.push(bird.sireId);
      if (bird.damId) next.push(bird.damId);
    }
    frontier = next;
  }
  return seen;
}

/**
 * How two birds are related, or `null` when nothing links them within
 * `INBREEDING.lookbackGenerations`.
 *
 * Checked worst-first, because the labels are not exclusive: full siblings also
 * share grandparents, and we want to report the closest truth.
 */
export function kinship(db: Database, a: Pigeon, b: Pigeon): KinshipDegree | null {
  if (a.id === b.id) return 'directe-lijn';
  const depth = INBREEDING.lookbackGenerations;
  const aUp = ancestorIds(db, a, depth);
  const bUp = ancestorIds(db, b, depth);

  // Direct line: one is an ancestor of the other (parent, grandparent, …).
  if (aUp.has(b.id) || bUp.has(a.id)) return 'directe-lijn';

  // Siblings: compare the parents themselves, not the whole ancestor set.
  const shareSire = !!a.sireId && a.sireId === b.sireId;
  const shareDam = !!a.damId && a.damId === b.damId;
  if (shareSire && shareDam) return 'volle';
  if (shareSire || shareDam) return 'half';

  // Anything else with a common ancestor: cousins, aunt/nephew, and so on.
  for (const id of aUp) if (bUp.has(id)) return 'familie';
  return null;
}

/** Build the tree for the pigeon page, `generations` levels of ancestors deep. */
export function pedigreeOf(db: Database, pigeon: Pigeon, generations: number): AncestorNode | null {
  const ownerOf = (p: Pigeon) => db.lofts.find((l) => l.userId === p.ownerId) ?? null;

  /**
   * `rememberedName` is used only when the bird itself is gone: the child's
   * `sireName`/`damName` is then all that is left of it.
   */
  const build = (
    id: string | null,
    rememberedName: string | null,
    sex: 'doffer' | 'duivin',
    left: number,
    guard: Set<string>,
  ): AncestorNode | null => {
    if (!id && !rememberedName) return null;
    const bird = id ? db.pigeons.find((p) => p.id === id) ?? null : null;
    if (!bird) {
      // Known by name only — a leaf, because its own parents died with it.
      return rememberedName
        ? { id: null, name: rememberedName, sex, alive: false, ownerName: null, ownerId: null, talent: null, image: null, quirk: null, sire: null, dam: null }
        : null;
    }
    const node = (b: Pigeon, sire: AncestorNode | null, dam: AncestorNode | null): AncestorNode => ({
      id: b.id,
      name: b.name,
      sex: b.sex,
      alive: true,
      ownerName: ownerOf(b)?.name ?? null,
      ownerId: b.ownerId,
      // Only what is PUBLIC about someone else's bird: the general score and the
      // breed portrait. The individual attributes stay hidden here exactly as
      // they do everywhere else (see presenters.ts info-hiding).
      talent: talent(b),
      image: breedInfo(b.breed).image,
      quirk: b.quirk ?? null,
      sire,
      dam,
    });

    // A line that folds back on itself (inteelt!) would otherwise recurse forever.
    if (guard.has(bird.id)) return node(bird, null, null);
    const nextGuard = new Set(guard).add(bird.id);
    return {
      ...node(bird, null, null),
      sire: left > 0 ? build(bird.sireId, bird.sireName ?? null, 'doffer', left - 1, nextGuard) : null,
      dam: left > 0 ? build(bird.damId, bird.damName ?? null, 'duivin', left - 1, nextGuard) : null,
    };
  };

  const root = build(pigeon.id, pigeon.name, pigeon.sex, generations, new Set());
  return root;
}
