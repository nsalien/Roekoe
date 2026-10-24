/**
 * Vluchtreacties: welke een speler heeft, hoe hij er een koopt, en hoe hij er
 * een in de chatbox van een live vlucht gooit.
 *
 * De catalogus en het waarom van de ontgrendelroutes staan in
 * config/reactions.ts. Dit bestand doet drie dingen:
 *
 *  - `reactionsFor` — wat deze speler nu kan sturen en wat er nog achter een
 *    level of een prijs zit (voedt de kiezer én de winkel);
 *  - `buyReaction` — een aankoop, met de muntcontrole;
 *  - `postReaction` — een regel in de chatbox, met cooldown, samenvouwen van
 *    herhalingen, en de bel voor wie hij geraakt.
 */

import {
  FLIGHT_CHAT,
  REACTIONS,
  REACTION_MAP,
  REACTION_CATS,
  type ReactionTemplate,
} from '../config/reactions.js';
import type { ChatLine, Database, Flight, Loft } from '../schema.js';
import { newId, type Store } from '../store.js';
import { BADGE_MAP } from './badges.js';

/** Badge keys this loft has earned, as a set (badges are stored as objects). */
function badgeKeys(loft: Loft): Set<string> {
  return new Set((loft.badges ?? []).map((b) => b.key));
}

/**
 * Can this loft send this reaction right now?
 *
 * The four routes are OR'd, deliberately: a template stays usable through the
 * cheapest route that applies, so a bought one keeps working after a level reset
 * and a badge-bound one never asks for money.
 */
export function hasReaction(loft: Loft, t: ReactionTemplate, badges = badgeKeys(loft)): boolean {
  if (t.gift) return true;
  if (t.milestone != null && loft.level >= t.milestone) return true;
  if (t.badge && badges.has(t.badge)) return true;
  if (loft.level < t.minLevel) return false;
  return t.price === 0 || !!loft.unlockedReactions?.includes(t.id);
}

/**
 * Why a template is still out of reach — what the picker prints under the lock.
 *
 * The badge route comes first on purpose. Printing only "vanaf level 9" on a
 * template that is also handed over by a badge hides the cheaper, more
 * interesting road to it, and that road is the whole point of the badge route.
 */
function lockReason(loft: Loft, t: ReactionTemplate): string {
  if (t.badge) {
    const def = BADGE_MAP.get(t.badge);
    if (def) return `badge ${def.icon} ${def.label}`;
  }
  if (loft.level < t.minLevel) return `vanaf level ${t.minLevel}`;
  return `${t.price} munten`;
}

export interface ReactionView {
  id: string;
  text: string;
  cat: string;
  channel: 'vlucht' | 'speler';
  owned: boolean;
  /** Only on a locked one: what stands between the player and the template. */
  lock?: string;
  /** Only on a locked one that the level already allows — the shop price. */
  price?: number;
  /** How it was (or would be) obtained, for the badge in the picker. */
  route: 'gift' | 'milestone' | 'badge' | 'gratis' | 'winkel';
}

function routeOf(t: ReactionTemplate): ReactionView['route'] {
  if (t.gift) return 'gift';
  if (t.milestone != null) return 'milestone';
  if (t.badge) return 'badge';
  return t.price === 0 ? 'gratis' : 'winkel';
}

/**
 * The whole catalogue as this player sees it: owned first, then what is locked
 * and why. The client renders owned items in the grid and folds the rest into
 * one "nog N vanaf level X" line per category, so it ships both in one go rather
 * than making the picker ask twice.
 */
export function reactionsFor(loft: Loft): {
  cats: typeof REACTION_CATS;
  items: ReactionView[];
  ownedCount: number;
} {
  const badges = badgeKeys(loft);
  const items = REACTIONS.map((t) => {
    const owned = hasReaction(loft, t, badges);
    const view: ReactionView = {
      id: t.id,
      text: t.text,
      cat: t.cat,
      channel: t.channel,
      owned,
      route: routeOf(t),
    };
    if (!owned) {
      view.lock = lockReason(loft, t);
      if (loft.level >= t.minLevel && t.price > 0) view.price = t.price;
    }
    return view;
  });
  return { cats: REACTION_CATS, items, ownedCount: items.filter((i) => i.owned).length };
}

/** Buy one reaction. Returns an error message, or null on success. */
export function buyReaction(store: Store, userId: string, templateId: string): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Hok niet gevonden';
    const t = REACTION_MAP.get(templateId);
    if (!t) return 'Onbekende reactie';
    if (hasReaction(loft, t)) return 'Je hebt deze reactie al';
    if (loft.level < t.minLevel) return `Deze reactie komt vrij vanaf level ${t.minLevel}`;
    if (t.price <= 0) return 'Deze reactie is niet te koop';
    if (loft.money < t.price) return `Te weinig munten — je hebt er ${t.price} nodig`;
    loft.money -= t.price;
    (loft.unlockedReactions ??= []).push(t.id);
    return null;
  });
}

/**
 * Everyone who may be addressed on this flight: the lofts with a bird in it,
 * minus the sender and minus the bots (a bot never reads its bell).
 *
 * Read off `sim` when the flight is live — that carries owner id and name
 * already — and off `entries` before the start.
 */
export function chatTargets(db: Database, f: Flight, meId: string): { userId: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const s of f.sim ?? []) if (s.ownerId !== meId) seen.set(s.ownerId, s.ownerName);
  if (seen.size === 0) {
    for (const e of f.entries ?? []) {
      const p = db.pigeons.find((x) => x.id === e.pigeonId);
      if (!p || p.ownerId === meId) continue;
      seen.set(p.ownerId, db.lofts.find((l) => l.userId === p.ownerId)?.name ?? 'Onbekend');
    }
  }
  return [...seen]
    .filter(([id]) => !db.lofts.find((l) => l.userId === id)?.isBot)
    .map(([userId, name]) => ({ userId, name }));
}

/**
 * Post a reaction to a flight's chatbox.
 *
 * Returns an error message, or null on success. The rules that keep the box
 * readable live here rather than in the UI, because the UI is not the only thing
 * that can call this route.
 */
export function postReaction(
  store: Store,
  userId: string,
  flightId: string,
  templateId: string,
  targetId: string | null,
  nowMs: number = Date.now(),
): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Hok niet gevonden';
    const f = db.flights.find((x) => x.id === flightId);
    if (!f) return 'Vlucht niet gevonden';
    // Scheduled flights have no chatbox: there is nothing to react to yet, and a
    // taunt sent hours before the lossing is just a notification with no context.
    if (f.status !== 'live' && f.status !== 'completed') return 'Deze vlucht is nog niet begonnen';
    const t = REACTION_MAP.get(templateId);
    if (!t) return 'Onbekende reactie';
    if (!hasReaction(loft, t)) return 'Deze reactie heb je nog niet';

    let target: { userId: string; name: string } | null = null;
    if (t.channel === 'speler') {
      if (!targetId) return 'Kies eerst naar wie deze reactie gaat';
      if (targetId === userId) return 'Naar jezelf roepen mag, maar niet hier';
      const found = chatTargets(db, f, userId).find((x) => x.userId === targetId);
      if (!found) return 'Die speler doet niet mee aan deze vlucht';
      target = found;
    }

    const chat = (f.chat ??= []);
    const mine = chat.filter((c) => c.userId === userId);
    // Nobody owns the whole stand: at most a share of what is up there may come
    // from one loft (see FLIGHT_CHAT.maxShareOfBox for why this is a share and
    // not a counter).
    if (chat.length >= 4 && mine.length >= Math.ceil(FLIGHT_CHAT.keep * FLIGHT_CHAT.maxShareOfBox)) {
      return 'Laat de anderen ook eens aan het woord';
    }
    const last = mine[mine.length - 1];
    if (last && nowMs - Date.parse(last.at) < FLIGHT_CHAT.cooldownSeconds * 1000) {
      const wait = Math.ceil((FLIGHT_CHAT.cooldownSeconds * 1000 - (nowMs - Date.parse(last.at))) / 1000);
      return `Nog even wachten (${wait}s)`;
    }

    // Repeating yourself collapses into a ×N counter instead of filling the box.
    // Only against the LAST line overall, so it never rewrites history someone
    // else has already answered to.
    const tail = chat[chat.length - 1];
    if (
      tail &&
      tail.userId === userId &&
      tail.templateId === templateId &&
      (tail.targetId ?? null) === (target?.userId ?? null) &&
      nowMs - Date.parse(tail.at) < FLIGHT_CHAT.collapseSeconds * 1000
    ) {
      tail.repeat = (tail.repeat ?? 1) + 1;
      tail.at = new Date(nowMs).toISOString();
      return null;
    }

    chat.push({
      id: newId('chat'),
      at: new Date(nowMs).toISOString(),
      userId,
      userName: loft.name,
      templateId: t.id,
      text: t.text,
      cat: t.cat,
      targetId: target?.userId ?? null,
      targetName: target?.name ?? null,
    });
    // Bounded on write: the flight row is read on every live poll, so the box
    // must never grow past what one screen of scrollback needs.
    if (chat.length > FLIGHT_CHAT.keep) f.chat = chat.slice(chat.length - FLIGHT_CHAT.keep);

    // A targeted line is public AND personal: everyone reads it in the box, the
    // one it names also gets a bell.
    if (target) {
      db.notifications.push({
        id: newId('ntf'),
        userId: target.userId,
        kind: 'taunt',
        title: `💬 ${loft.name} richt zich tot jou`,
        body: `${t.text} — tijdens ${f.name}`,
        flightId: f.id,
        createdAt: new Date(nowMs).toISOString(),
        read: false,
      });
      const inbox = db.notifications.filter((n) => n.userId === target!.userId);
      if (inbox.length > 40) {
        const drop = new Set(inbox.slice(0, inbox.length - 40).map((n) => n.id));
        db.notifications = db.notifications.filter((n) => !drop.has(n.id));
      }
    }
    return null;
  });
}
