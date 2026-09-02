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

/** What every box in the family view shows — public facts only. */
export interface FamilyMember {
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
}

/** One box in the ancestor chart. `alive` false = known only by a remembered name. */
export interface AncestorNode extends FamilyMember {
  sire: AncestorNode | null;
  dam: AncestorNode | null;
}

/**
 * One box on the descendant side. `partner` is the OTHER parent of this bird —
 * the bird our subject was paired with to produce it — which is what makes a
 * clutch readable ("these three are all out of Kim").
 */
export interface DescendantNode extends FamilyMember {
  partner: FamilyMember | null;
  children: DescendantNode[];
}

/** A brother or sister: `full` when BOTH parents are shared, else a half sibling. */
export interface SiblingNode extends FamilyMember {
  full: boolean;
  sharedSire: boolean;
  sharedDam: boolean;
}

/**
 * Everything around a bird that is not an ancestor: the brothers and sisters she
 * grew up with, the birds she was paired with, and the line she started.
 *
 * ⚠️ This side of the family survives death BETTER than the ancestor side, and
 * for the same reason it is bounded by it: a child, a sibling and a partner are
 * all found by reading ids OFF A LIVING ROW, so a dead parent does not hide them.
 * What is lost is the reverse: a dead CHILD leaves no row, so neither she nor the
 * grandchildren behind her can be reached — we never learn her id to link them
 * with. Same truncation as `pedigreeOf`, mirrored.
 */
export interface FamilyTree {
  siblings: SiblingNode[];
  partners: FamilyMember[];
  children: DescendantNode[];
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

/**
 * The other half of the family: siblings, partners and the line a bird started.
 *
 * ONE pass over `db.pigeons` builds a parent → children index, and that index
 * answers all three questions: a bird's children are what it maps to, and her
 * siblings are what her PARENTS map to. This runs on `GET /pigeons/:id`, a route
 * a player opens on purpose and never polls, and it adds no query — the world is
 * already in memory (see §Performance in context.md before making it do more).
 *
 * `generations` counts DOWNWARD levels (1 = children, 2 = + grandchildren, …).
 */
export function familyOf(db: Database, pigeon: Pigeon, generations: number): FamilyTree {
  const ownerOf = (p: Pigeon) => db.lofts.find((l) => l.userId === p.ownerId) ?? null;
  const member = (b: Pigeon): FamilyMember => ({
    id: b.id,
    name: b.name,
    sex: b.sex,
    alive: true, // it has a row, so it is in the world
    ownerName: ownerOf(b)?.name ?? null,
    ownerId: b.ownerId,
    // Only what is PUBLIC about someone else's bird — the general score and the
    // breed portrait. Individual attributes stay hidden, exactly as everywhere
    // else (see presenters.ts info-hiding).
    talent: talent(b),
    image: breedInfo(b.breed).image,
    quirk: b.quirk ?? null,
  });

  // Parent id → its young. Both parents are indexed, so one map serves children
  // AND siblings.
  const byParent = new Map<string, Pigeon[]>();
  const index = (parentId: string | null | undefined, child: Pigeon) => {
    if (!parentId) return;
    const list = byParent.get(parentId);
    if (list) list.push(child);
    else byParent.set(parentId, [child]);
  };
  for (const b of db.pigeons) {
    index(b.sireId, b);
    index(b.damId, b);
  }
  const byId = new Map(db.pigeons.map((b) => [b.id, b] as const));

  // --- Brothers and sisters -------------------------------------------------
  // Read off the SIBLINGS' own rows, so a dead parent hides nobody.
  const sibs = new Map<string, SiblingNode>();
  for (const parentId of [pigeon.sireId, pigeon.damId]) {
    if (!parentId) continue;
    for (const b of byParent.get(parentId) ?? []) {
      if (b.id === pigeon.id || sibs.has(b.id)) continue;
      const sharedSire = !!pigeon.sireId && b.sireId === pigeon.sireId;
      const sharedDam = !!pigeon.damId && b.damId === pigeon.damId;
      sibs.set(b.id, { ...member(b), full: sharedSire && sharedDam, sharedSire, sharedDam });
    }
  }
  // Full siblings first, then the strongest link, then by talent — the order a
  // breeder reads them in.
  const siblings = [...sibs.values()].sort(
    (a, b) => Number(b.full) - Number(a.full) || (b.talent ?? 0) - (a.talent ?? 0),
  );

  // --- The line she started -------------------------------------------------
  const partners = new Map<string, FamilyMember>();
  const build = (parent: Pigeon, left: number, guard: Set<string>): DescendantNode[] => {
    if (left <= 0) return [];
    const out: DescendantNode[] = [];
    for (const child of byParent.get(parent.id) ?? []) {
      // A line that folds back on itself (inteelt!) would otherwise recurse forever.
      if (guard.has(child.id)) continue;
      const viaSire = child.sireId === parent.id;
      const otherId = viaSire ? child.damId : child.sireId;
      const living = otherId ? byId.get(otherId) ?? null : null;
      // The other parent may be dead — no row, so no id and no stats. The child
      // still REMEMBERS the name (sireName/damName is denormalised onto it for
      // exactly this), so the mate stays visible instead of becoming "onbekend".
      const remembered = viaSire ? child.damName : child.sireName;
      const other: FamilyMember | null = living
        ? member(living)
        : remembered
          ? {
            id: null, name: remembered, sex: viaSire ? 'duivin' : 'doffer', alive: false,
            ownerName: null, ownerId: null, talent: null, image: null, quirk: null,
          }
          : null;
      if (other && parent.id === pigeon.id) {
        // A dead mate has no id, so key on the name instead.
        const key = other.id ?? `†${other.name}`;
        if (!partners.has(key)) partners.set(key, other);
      }
      out.push({
        ...member(child),
        partner: other,
        children: build(child, left - 1, new Set(guard).add(child.id)),
      });
    }
    // Strongest first: a clutch reads as a line, not as a shuffled bag.
    return out.sort((a, b) => (b.talent ?? 0) - (a.talent ?? 0));
  };

  // ⚠️ `build` FILLS `partners`, so it has to run before the object is assembled —
  // a literal evaluates its properties top to bottom and would spread an empty map.
  const children = build(pigeon, generations, new Set([pigeon.id]));
  return { siblings, partners: [...partners.values()], children };
}
