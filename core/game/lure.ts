/**
 * De duivenlokker (De Stem, "Vrijgelate duifjes zoeken nieuw nest").
 *
 * A player can buy a lokker on the Inrichting page and take it up to level 5
 * (LURE in gameConfig). When ANOTHER real player releases a bird (the button on
 * her page, or "Maak plaats" at Kweek — both are engine.releasePigeon), every
 * lokker in the game gets a chance to catch her: lureChances() weighs the
 * lokkers against the open sky, so a higher level always has the better chance,
 * equal levels have equal chances, she lands at one lokker at most, and she can
 * always vanish for good.
 *
 * A caught bird does not simply move in: she waits on the catcher's
 * `pendingBroods` (origin `lokker`), the queue a clutch in a full loft and an
 * inherited bird already use, so the catcher decides whether to keep her and can
 * free a perch first (NestChoice at Kweek). Letting her go = gone for good; she
 * is not offered to the next lokker. The player who released her hears where she
 * went right away, and again once the catcher has decided (`tellReleaser`).
 *
 * Not lured: a bird sent to the restaurant (that is the soup), a bird the bots
 * cull, a young that flies off from a held nest, and a bird on an open auction
 * (a forced auction must not be dodged by releasing her to a friend).
 */

import { LURE, LURE_MAX_LEVEL, lureChances } from '../config/gameConfig.js';
import type { Database, Loft, PendingBrood, Pigeon } from '../schema.js';
import { newId, type Store } from '../store.js';
import { debtBlock } from './economy.js';
import { equipmentOf } from './hygiene.js';
import { clearOwnerCare } from './inrichting.js';
import { talent } from './pigeon.js';

const loftOf = (db: Database, userId: string) => db.lofts.find((l) => l.userId === userId);

/** Bell for a REAL player (bots read none), kept to the inbox cap like the other modules. */
function notify(db: Database, userId: string, title: string, body: string): void {
  if (loftOf(db, userId)?.isBot ?? true) return;
  db.notifications.push({
    id: newId('ntf'), userId, kind: 'info', title, body,
    flightId: null, createdAt: new Date().toISOString(), read: false,
  });
  const mine = db.notifications.filter((n) => n.userId === userId);
  if (mine.length > 40) {
    const drop = new Set(mine.slice(0, mine.length - 40).map((n) => n.id));
    db.notifications = db.notifications.filter((n) => !drop.has(n.id));
  }
}

/** The loft's lokker level: 0 = none, 1..LURE_MAX_LEVEL. */
export function lureLevel(loft: Loft | undefined): number {
  const level = Math.round(loft?.equipment?.lure ?? 0);
  return Math.min(Math.max(level, 0), LURE_MAX_LEVEL);
}

const pct = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString('nl-BE')} %`;

/**
 * What the Inrichting page needs: the price of every level and what each level
 * gives, in the shape of the ⓘ table (inrichtingEffects) — `values[i]` = level i+1.
 */
export function lureCatalogue(): {
  label: string; max: number; prices: number[];
  effects: { label: string; none: string; values: string[] }[];
} {
  const levels = LURE.prices.map((_, i) => i + 1);
  return {
    label: LURE.label,
    max: LURE_MAX_LEVEL,
    prices: [...LURE.prices],
    effects: [
      { label: 'Kans als enige lokker', none: '—', values: levels.map((l) => pct(lureChances([l]).each[0])) },
      { label: 'Naast één lokker van hetzelfde niveau', none: '—', values: levels.map((l) => pct(lureChances([l, l]).each[0])) },
    ],
  };
}

/** Buy the lokker (level 1) or take it one level up. One-off; cannot be sold back. */
export function buyLure(store: Store, userId: string): string | null {
  return store.mutate((db) => {
    const loft = loftOf(db, userId);
    if (!loft) return 'Geen hok gevonden';
    if (loft.isBot) return 'Computermelkers kopen geen duivenlokker';
    const level = lureLevel(loft);
    if (level >= LURE_MAX_LEVEL) return 'Je duivenlokker staat al op het hoogste niveau';
    const debt = debtBlock(loft); if (debt) return debt;
    const price = LURE.prices[level];
    if (loft.money < price) {
      return level === 0
        ? 'Niet genoeg geld voor een duivenlokker'
        : `Niet genoeg geld voor niveau ${level + 1} (€${price.toLocaleString('nl-BE')})`;
    }
    loft.money -= price;
    loft.equipment = { ...equipmentOf(loft), lure: level + 1 };
    return null;
  });
}

/**
 * Every lokker that could catch a bird `releaserId` lets go: the other real
 * players with a lokker, in a fixed order (by id) so a seeded roll is stable.
 */
export function lureRivals(db: Database, releaserId: string): { loft: Loft; level: number }[] {
  return db.lofts
    .filter((l) => !l.isBot && l.userId !== releaserId && lureLevel(l) > 0)
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    .map((loft) => ({ loft, level: lureLevel(loft) }));
}

/** Where a released bird lands: at one of the lokkers, or nowhere (null). */
export function pickLure(rivals: { loft: Loft; level: number }[], rng: () => number = Math.random): Loft | null {
  if (rivals.length === 0) return null;
  const { each } = lureChances(rivals.map((r) => r.level));
  let x = rng();
  for (let i = 0; i < rivals.length; i++) {
    if (x < each[i]) return rivals[i].loft;
    x -= each[i];
  }
  return null;
}

/**
 * Make a caught bird ready for her new loft, the way a sale does (settlePigeonSale):
 * off the market, the old owner's policy and kweekaanbod gone, and nothing the old
 * loft paid for or housed her in comes along — no coach, apart hok, ziekenboegbed
 * or rustkuur. Her vaccines, skills, pedigree and history stay: they are hers.
 */
function adopt(p: Pigeon, to: Loft): void {
  clearOwnerCare(p);
  p.ownerId = to.userId;
  p.forSale = false;
  p.price = null;
  p.minBid = null;
  p.listedAt = null;
  p.boostedAt = null;
  p.inInfirmary = false;
  p.careAssigned = false;
  p.coached = false;
  p.compartment = false;
  p.hungerDays = 0;
  p.restDays = 0;
  p.cureUntil = null;
  p.ration = to.feedRation;
  delete p.pendingLog;
}

/**
 * A real player just released `bird` (she is already out of `db.pigeons`, see
 * engine.releasePigeon). Roll the lokkers; on a catch she waits on the catcher's
 * queue and the catcher gets a bell. Returns the catching loft, or null when she
 * is gone for good. The release message itself is the caller's.
 */
export function catchReleased(db: Database, from: Loft | undefined, bird: Pigeon, rng: () => number = Math.random): Loft | null {
  if (!from || from.isBot) return null;
  if (db.auctions.some((a) => a.status === 'open' && a.pigeonId === bird.id)) return null;
  const to = pickLure(lureRivals(db, from.userId), rng);
  if (!to) return null;
  adopt(bird, to);
  const entry: PendingBrood = {
    id: newId('brood'),
    sireId: '', damId: '', sireName: '', damName: '',
    young: [bird],
    dynasty: false,
    origin: 'lokker',
    from: { userId: from.userId, name: from.name },
    createdAt: new Date().toISOString(),
    createdAtWeek: db.world.currentWeek,
  };
  to.pendingBroods = [...(to.pendingBroods ?? []), entry];
  notify(
    db, to.userId, '🧲 Je duivenlokker ving een duif',
    `${bird.name} (★${talent(bird)}) werd vrijgelaten door ${from.name} en streek neer bij jouw hok. ` +
      'Ga naar Kweek en kies of je haar houdt — zit je hok vol, maak dan eerst plaats. ' +
      'Laat je haar gaan, dan is ze voorgoed weg.',
  );
  return to;
}

/**
 * The catcher decided (engine.resolveBrood): tell the player who released her
 * what became of the bird. Nothing if that player is gone from the game.
 */
export function tellReleaser(db: Database, brood: PendingBrood, keeper: Loft, kept: boolean): void {
  const from = brood.from;
  if (!from || !loftOf(db, from.userId)) return;
  const name = brood.young[0]?.name ?? 'De duif';
  if (kept) {
    notify(db, from.userId, `🧲 ${name} blijft bij ${keeper.name}`,
      `${keeper.name} hield ${name}, de duif die je vrijliet. Ze vliegt voortaan voor ${keeper.name}.`);
  } else {
    notify(db, from.userId, `🕊️ ${name} is voorgoed weg`,
      `${keeper.name} liet ${name} gaan, de duif die je vrijliet. Ze is definitief uit het spel.`);
  }
}
