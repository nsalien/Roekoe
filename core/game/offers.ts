/**
 * Private pigeon offers. A player may bid on ANY other player's pigeon — even one
 * that is not listed for sale. The bid is not escrowed; the owner sees it in the
 * Markt and can accept or reject, and it stays valid until then. The bidder can
 * withdraw it. On accept the pigeon changes hands like a normal sale.
 *
 * `db.offers` only ever holds PENDING offers: resolving one (accept/reject/
 * withdraw) removes it (the accepted sale lives on in `db.trades`). Outcomes are
 * relayed to the bidder via a bell notification; the pending offers themselves
 * are surfaced in the Markt (not the bell), with a nav badge.
 */

import type { Database, Loft, Pigeon, PigeonOffer } from '../schema.js';
import { newId } from '../store.js';
import { awardBadge, evaluateBadges } from './badges.js';
import { progressMissions } from './missions.js';
import { talent } from './pigeon.js';

function notify(db: Database, userId: string, title: string, body: string): void {
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

/** Drop pending offers whose pigeon no longer exists or changed owner. */
function pruneStale(db: Database): void {
  db.offers = db.offers.filter((o) => {
    const p = db.pigeons.find((x) => x.id === o.pigeonId);
    return !!p && p.ownerId === o.toUserId;
  });
}

/** Place (or update) a private offer on another player's pigeon. */
export function makeOffer(db: Database, fromUserId: string, pigeonId: string, amount: number): string | null {
  pruneStale(db);
  const bidder = db.lofts.find((l) => l.userId === fromUserId);
  const pigeon = db.pigeons.find((p) => p.id === pigeonId);
  if (!bidder || !pigeon) return 'Duif niet gevonden';
  if (pigeon.ownerId === fromUserId) return 'Dit is al jouw duif';
  const owner = db.lofts.find((l) => l.userId === pigeon.ownerId);
  if (!owner) return 'Eigenaar niet gevonden';
  if (owner.isBot) return 'Je kan enkel op duiven van andere spelers bieden';
  const bid = Math.round(amount);
  if (!(bid > 0)) return 'Ongeldig bod';
  if (bidder.money < bid) return 'Je moet het geld dat je biedt ook echt hebben';
  const owned = db.pigeons.filter((p) => p.ownerId === fromUserId).length;
  if (owned >= bidder.capacity) return 'Je hok zit vol — maak eerst plaats';

  const existing = db.offers.find(
    (o) => o.status === 'pending' && o.pigeonId === pigeonId && o.fromUserId === fromUserId,
  );
  if (existing) {
    existing.amount = bid;
    existing.createdAt = new Date().toISOString();
    return null;
  }
  db.offers.push({
    id: newId('off'), pigeonId, pigeonName: pigeon.name,
    fromUserId, fromUserName: bidder.name, toUserId: owner.userId, toUserName: owner.name,
    amount: bid, status: 'pending', createdAt: new Date().toISOString(), resolvedAt: null,
  });
  return null;
}

/** The bidder withdraws a pending offer (it stops being valid). */
export function withdrawOffer(db: Database, userId: string, offerId: string): string | null {
  const o = db.offers.find((x) => x.id === offerId && x.fromUserId === userId && x.status === 'pending');
  if (!o) return 'Dit bod bestaat niet (meer)';
  db.offers = db.offers.filter((x) => x.id !== offerId);
  return null;
}

function transfer(db: Database, buyer: Loft, seller: Loft, pigeon: Pigeon, price: number): void {
  buyer.money -= price;
  seller.money += price;
  pigeon.ownerId = buyer.userId;
  pigeon.forSale = false;
  pigeon.price = null;
  db.trades.push({
    id: newId('trd'), pigeonId: pigeon.id, pigeonName: pigeon.name,
    sellerId: seller.userId, sellerName: seller.name, buyerId: buyer.userId, buyerName: buyer.name,
    price, at: new Date().toISOString(), talent: talent(pigeon),
  });
  // Bounded by the store (core/d1.ts) — see the note in engine.ts::buyPigeon.
  buyer.stats.buys += 1;
  seller.stats.sells += 1;
  if (price > 1000) awardBadge(db, seller, 'handelaar');
  progressMissions(db, buyer, 'market', 1);
  progressMissions(db, seller, 'market', 1);
  evaluateBadges(db, buyer);
  evaluateBadges(db, seller);
}

/** The owner accepts or rejects a pending offer on one of their pigeons. */
export function respondOffer(db: Database, ownerId: string, offerId: string, accept: boolean): string | null {
  const o = db.offers.find((x) => x.id === offerId && x.toUserId === ownerId && x.status === 'pending');
  if (!o) return 'Dit bod bestaat niet (meer)';
  const remove = () => { db.offers = db.offers.filter((x) => x.id !== o.id); };
  const pigeon = db.pigeons.find((p) => p.id === o.pigeonId);
  if (!pigeon || pigeon.ownerId !== ownerId) { remove(); return 'Deze duif is niet meer van jou'; }

  if (!accept) {
    remove();
    notify(db, o.fromUserId, '🚫 Bod geweigerd', `${o.toUserName} wees je bod van €${o.amount} op ${o.pigeonName} af.`);
    return null;
  }

  const buyer = db.lofts.find((l) => l.userId === o.fromUserId);
  const seller = db.lofts.find((l) => l.userId === ownerId);
  if (!buyer || !seller) { remove(); return 'Speler niet gevonden'; }
  // The pigeon must be free to move.
  const racing = db.flights.some((f) => f.status !== 'completed' && f.entries.some((e) => e.pigeonId === pigeon.id));
  if (racing) return 'Deze duif staat ingeschreven voor een vlucht — schrijf ze eerst uit';
  const breeding = db.breedingPairs.some((bp) => bp.sireId === pigeon.id || bp.damId === pigeon.id);
  if (breeding) return 'Deze duif koppelt momenteel — stop eerst het broeden';
  // The bidder must still be able to pay and house it.
  if (buyer.money < o.amount) {
    remove();
    notify(db, o.fromUserId, '↩️ Bod vervallen', `Je had geen €${o.amount} meer, dus je bod op ${o.pigeonName} kon niet worden afgerond.`);
    return 'De bieder heeft niet genoeg geld meer — bod vervallen';
  }
  if (db.pigeons.filter((p) => p.ownerId === buyer.userId).length >= buyer.capacity) {
    remove();
    notify(db, o.fromUserId, '↩️ Bod vervallen', `Je hok zat vol, dus je bod op ${o.pigeonName} kon niet worden afgerond.`);
    return 'De bieder heeft geen plaats meer — bod vervallen';
  }

  transfer(db, buyer, seller, pigeon, o.amount);
  remove();
  notify(db, o.fromUserId, '✅ Bod aanvaard!', `${seller.name} aanvaardde je bod van €${o.amount}: ${pigeon.name} is nu van jou.`);
  // Any other pending offers on this pigeon lapse — it has moved.
  const others = db.offers.filter((x) => x.pigeonId === pigeon.id);
  for (const x of others) notify(db, x.fromUserId, '🚫 Bod vervallen', `${pigeon.name} ging naar een andere bieder. Je bod van €${x.amount} is vervallen.`);
  db.offers = db.offers.filter((x) => x.pigeonId !== pigeon.id);
  return null;
}

/** DTO for one offer (owner/bidder perspective assembled by the caller). */
export function offerDTO(o: PigeonOffer) {
  return {
    id: o.id, pigeonId: o.pigeonId, pigeonName: o.pigeonName,
    fromUserName: o.fromUserName, toUserName: o.toUserName, amount: o.amount, createdAt: o.createdAt,
  };
}

/** A player's live offers: those they received (to decide on) and those they sent. */
export function offersFor(db: Database, userId: string) {
  const valid = db.offers.filter((o) => {
    if (o.status !== 'pending') return false;
    const p = db.pigeons.find((x) => x.id === o.pigeonId);
    return !!p && p.ownerId === o.toUserId;
  });
  return {
    received: valid.filter((o) => o.toUserId === userId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(offerDTO),
    sent: valid.filter((o) => o.fromUserId === userId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(offerDTO),
  };
}
