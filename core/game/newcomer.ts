/**
 * The starter package for a newly registered loft (see NEWCOMER in gameConfig).
 *
 * Everything that makes a newcomer competitive lives here so there is ONE place
 * to reason about "is this player still on training wheels". The perks split in
 * two kinds:
 *
 *  - a WALLET (`expPoints`, `attrPoints`) the player spends where they want. It
 *    never expires — unspent points stay spendable, they are simply a head start
 *    the player still has to aim.
 *  - TIME-BOXED perks (free coach, doubled winnings) that stop at `endsAt`.
 *
 * When the time-boxed half runs out the player is told, once (`endNotified`).
 * A coach silently starting to cost €80/day would be a nasty surprise.
 */

import { COACH, NEWCOMER } from '../config/gameConfig.js';
import type { RacingAttr } from '../config/gameConfig.js';
import type { Database, Loft, NewcomerPerks, Pigeon } from '../schema.js';

import { geneCap, noteAttrChange } from './pigeon.js';
import { clamp, round1 } from './util.js';

const RACING_ATTRS: RacingAttr[] = ['speed', 'endurance', 'orientation'];

/** A fresh starter package, stamped at registration. */
export function newNewcomerPerks(nowMs: number): NewcomerPerks {
  return {
    startedAt: new Date(nowMs).toISOString(),
    endsAt: new Date(nowMs + NEWCOMER.days * 86400000).toISOString(),
    expPoints: NEWCOMER.expPoints,
    attrPoints: NEWCOMER.attrPoints,
    expPigeonId: null,
    endNotified: false,
  };
}

/** Is this loft still inside its first season (time-boxed perks running)? */
export function newcomerActive(loft: Loft, nowMs: number): boolean {
  const n = loft.newcomer;
  if (!n) return false;
  const end = Date.parse(n.endsAt);
  return !Number.isNaN(end) && nowMs < end;
}

/** Whole days left on the time-boxed perks (0 once they are over). */
export function newcomerDaysLeft(loft: Loft, nowMs: number): number {
  const n = loft.newcomer;
  if (!n) return 0;
  const end = Date.parse(n.endsAt);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.ceil((end - nowMs) / 86400000));
}

/**
 * How much of a flight's winnings this loft actually banks. Applies to prize
 * money AND ranking points, on competition flights only (a titan/estafette pays
 * no points anyway, and a practice flight pays nothing at all).
 *
 * `atMs` should be the flight's START: a race begun inside the window pays
 * double even if the stragglers only land after it closed. Losing the bonus
 * mid-flight would be arbitrary from the player's side.
 */
export function winningsMultiplier(loft: Loft, atMs: number): number {
  return newcomerActive(loft, atMs) ? NEWCOMER.winningsMultiplier : 1;
}

/**
 * Coached birds this loft is NOT billed for. The free coach is not pinned to a
 * particular bird: the player may move it around, and simply pays for coach
 * number two onwards.
 */
export function freeCoachCount(loft: Loft, nowMs: number): number {
  return newcomerActive(loft, nowMs) ? NEWCOMER.freeCoaches : 0;
}

/** Coached birds the loft actually pays for, after the free one. */
export function billableCoachedCount(loft: Loft, coachedCount: number, nowMs: number): number {
  return Math.max(0, coachedCount - freeCoachCount(loft, nowMs));
}

/**
 * Spend ervaring points on ONE bird. The whole allowance goes to a single
 * pigeon (that is the point — it makes one real contender rather than six
 * slightly-less-hopeless birds), so the first bird it is spent on is locked in.
 *
 * Deliberately NOT run through `experienceGain`: this is a head start handed to
 * the player, not ervaring earned by flying, so the diminishing-returns curve
 * (§3.7 spelregels) does not apply — 30 points means 30 points.
 */
export function spendExperience(loft: Loft, pigeon: Pigeon, amount: number): string {
  const n = loft.newcomer;
  if (!n) return 'Je hebt geen starterspakket';
  const want = Math.floor(amount);
  if (!(want > 0)) return 'Kies een aantal punten';
  if (want > n.expPoints) return `Je hebt nog maar ${n.expPoints} ervaringspunten`;
  if (n.expPigeonId && n.expPigeonId !== pigeon.id) {
    return 'Je ervaringspunten gaan allemaal naar dezelfde duif — je koos er al een';
  }
  const before = pigeon.experience;
  pigeon.experience = round1(clamp(pigeon.experience + want, 0, 100));
  const gained = round1(pigeon.experience - before);
  if (gained <= 0) return 'Deze duif zit al op ervaring 100';
  // Only charge for what actually landed (a bird near 100 cannot absorb it all).
  n.expPoints -= Math.min(want, Math.ceil(gained));
  n.expPigeonId = pigeon.id;
  return '';
}

/**
 * Spend attribute points on one racing skill. Free to spread: +5 on snelheid, or
 * +3 snelheid and +2 conditie, across any birds the player owns.
 *
 * The gene cap still holds — these points cannot lift a bird past what it was
 * born able to reach, exactly like every other source of growth.
 */
export function spendAttribute(loft: Loft, pigeon: Pigeon, attr: RacingAttr, amount: number): string {
  const n = loft.newcomer;
  if (!n) return 'Je hebt geen starterspakket';
  if (!RACING_ATTRS.includes(attr)) return 'Onbekende eigenschap';
  const want = Math.floor(amount);
  if (!(want > 0)) return 'Kies een aantal punten';
  if (want > n.attrPoints) return `Je hebt nog maar ${n.attrPoints} eigenschapspunten`;
  const cap = geneCap(pigeon, attr);
  if (pigeon[attr] >= cap) {
    return `${pigeon.name} zit al op haar genetisch plafond voor deze eigenschap (${cap})`;
  }
  const before = pigeon[attr];
  pigeon[attr] = round1(Math.min(cap, pigeon[attr] + want));
  const gained = round1(pigeon[attr] - before);
  if (gained <= 0) return 'Deze eigenschap kan niet verder omhoog';
  noteAttrChange(pigeon, attr, before, 'starterspakket');
  n.attrPoints -= Math.min(want, Math.ceil(gained));
  return '';
}

/**
 * Tell the player, exactly once, that the time-boxed half of the package is over
 * — their coach now costs €80/day and their winnings are back to normal. Any
 * points they never spent stay spendable, so we say that too.
 *
 * Called from the daily tick; `notify` is injected so this module stays free of
 * the notification plumbing (and testable on its own).
 */
export function tickNewcomerExpiry(
  db: Database,
  nowMs: number,
  notify: (db: Database, userId: string, title: string, body: string, stableId: string) => void,
): void {
  for (const loft of db.lofts) {
    const n = loft.newcomer;
    if (!n || loft.isBot || n.endNotified) continue;
    const end = Date.parse(n.endsAt);
    if (Number.isNaN(end) || nowMs < end) continue;
    n.endNotified = true;
    const leftovers: string[] = [];
    if (n.expPoints > 0) leftovers.push(`${n.expPoints} ervaringspunt${n.expPoints === 1 ? '' : 'en'}`);
    if (n.attrPoints > 0) leftovers.push(`${n.attrPoints} eigenschapspunt${n.attrPoints === 1 ? '' : 'en'}`);
    const tail = leftovers.length
      ? ` Je hebt nog ${leftovers.join(' en ')} liggen — die blijven gewoon geldig, dus geef ze nog uit.`
      : '';
    notify(
      db,
      loft.userId,
      '🎓 Je starterspakket is afgelopen',
      `Je eerste seizoen zit erop. Vanaf nu speel je op dezelfde voet als iedereen: ` +
        `je privécoach kost weer €${COACH.dailySalary}/dag per duif, en je prijzengeld en ranglijstpunten ` +
        `tellen weer enkelvoudig in plaats van dubbel.${tail}`,
      `ntf:newcomer:end:${loft.userId}`,
    );
  }
}
