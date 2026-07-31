/**
 * Auctions.
 *
 *  - Sunday auction: every Sunday from 11:00 to 20:00 (Brussels) a special top
 *    pigeon goes under the hammer.
 *  - Rescue-centre ("opvangcentrum") auctions: at random but regular moments a
 *    low-quality bird from a shelter is put up, opening at €25. It is no racer,
 *    but a patient owner can train it up and resell it.
 *
 * Players bid; the highest bid is held in escrow (refunded when outbid). At
 * close the winner keeps the bird. Multiple auctions can run at once.
 */

import type { Auction, Database, Loft } from '../schema.js';
import { newId } from '../store.js';
import { AUCTION } from '../config/gameConfig.js';
import { awardBadge } from './badges.js';
import { estimateValue, generatePigeon, talent } from './pigeon.js';
import { randFloat } from './util.js';

export const AUCTION_HOUSE_ID = 'auction_house';
export const SHELTER_ID = 'shelter_center';
const TZ = 'Europe/Brussels';
const OPEN_HOUR = 11;
const WINDOW_HOURS = 9; // 11:00 → 20:00

export type AuctionKind = 'sunday' | 'shelter';

/** Which flavour of auction this is, derived from the template key. */
export function auctionKind(a: Auction): AuctionKind {
  return a.templateKey.startsWith('shelter:') ? 'shelter' : 'sunday';
}

// --- Time-zone helpers (Brussels) ------------------------------------------
function tzOffsetMs(atMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(atMs))) map[p.type] = p.value;
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  return asUTC - atMs;
}
function tzParts(atMs: number): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(atMs))) map[p.type] = p.value;
  return { y: +map.year, m: +map.month, d: +map.day };
}
function wallToUtcMs(y: number, m: number, d: number, hh: number): number {
  const guess = Date.UTC(y, m - 1, d, hh, 0, 0);
  return guess - tzOffsetMs(guess);
}
function brusselsWeekday(ms: number): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(ms));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

function notify(db: Database, loft: Loft, title: string, body: string): void {
  db.notifications.push({
    id: newId('ntf'), userId: loft.userId, kind: 'info', title, body,
    flightId: null, createdAt: new Date().toISOString(), read: false,
  });
}

/** Put a top pigeon under the Sunday hammer and tell every player. */
function createSundayAuction(db: Database, key: string, startMs: number, endMs: number): void {
  const week = db.world.currentWeek;
  const p = generatePigeon({ ownerId: AUCTION_HOUSE_ID, currentWeek: week, quality: randFloat(0.82, 0.98) });
  p.forSale = false;
  db.pigeons.push(p);
  const val = estimateValue(p, week);
  const minBid = Math.max(300, Math.round((val * 0.5) / 10) * 10);
  db.auctions.push({
    id: newId('auc'), templateKey: key, pigeonId: p.id,
    startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString(),
    minBid, minIncrement: Math.max(25, Math.round((minBid * 0.05) / 5) * 5),
    currentBid: 0, currentBidderId: null, currentBidderName: null, bids: [], status: 'open',
  });
  for (const loft of db.lofts) {
    if (!loft.isBot) {
      notify(db, loft, '🔨 Zondagveiling geopend!',
        `Topduif ${p.name} (talent ${talent(p)}) gaat onder de hamer tot 20u. Bied mee op de markt!`);
    }
  }
}

/** Put a low-quality rescue bird up for auction, opening at €25. */
function createShelterAuction(db: Database, nowMs: number): void {
  const week = db.world.currentWeek;
  const p = generatePigeon({
    ownerId: SHELTER_ID, currentWeek: week,
    quality: randFloat(AUCTION.shelterQualityMin, AUCTION.shelterQualityMax),
  });
  p.forSale = false;
  db.pigeons.push(p);
  db.auctions.push({
    id: newId('auc'), templateKey: `shelter:${nowMs}`, pigeonId: p.id,
    startAt: new Date(nowMs).toISOString(),
    endAt: new Date(nowMs + AUCTION.shelterWindowHours * 3600000).toISOString(),
    minBid: AUCTION.shelterStartBid, minIncrement: 5,
    currentBid: 0, currentBidderId: null, currentBidderName: null, bids: [], status: 'open',
  });
}

function closeAuction(db: Database, a: Auction): void {
  a.status = 'closed';
  const p = db.pigeons.find((x) => x.id === a.pigeonId);
  if (!p) return;
  const shelter = auctionKind(a) === 'shelter';
  const sellerId = shelter ? SHELTER_ID : AUCTION_HOUSE_ID;
  const sellerName = shelter ? 'Opvangcentrum' : 'Veilinghuis';

  // Cascade: highest bidder who can still pay AND has room wins, at their bid.
  const ordered = [...(a.bids ?? [])].sort((x, y) => y.amount - x.amount);
  let winner: Loft | undefined;
  let price = 0;
  for (const b of ordered) {
    const loft = db.lofts.find((l) => l.userId === b.userId);
    if (!loft) continue;
    const owned = db.pigeons.filter((x) => x.ownerId === loft.userId).length;
    if (loft.money >= b.amount && owned < loft.capacity) {
      winner = loft;
      price = b.amount;
      break;
    }
  }

  if (winner) {
    winner.money -= price;
    p.ownerId = winner.userId;
    p.forSale = false;
    db.trades.push({
      id: newId('trd'), pigeonId: p.id, pigeonName: p.name,
      sellerId, sellerName,
      buyerId: winner.userId, buyerName: winner.name, price,
      at: new Date().toISOString(),
    });
    winner.stats.buys += 1;
    const title = shelter ? '🏠 Opvangduif geadopteerd!' : '🔨 Veiling gewonnen!';
    const body = shelter
      ? `${p.name} komt uit het opvangcentrum naar jouw hok, voor €${price}. Met wat training komt die er wel.`
      : `${p.name} is voor jou, voor €${price}. Veel vliegplezier!`;
    notify(db, winner, title, body);
    if (shelter) awardBadge(db, winner, 'opvang');
  } else {
    db.pigeons = db.pigeons.filter((x) => x.id !== a.pigeonId); // no payable bidder
  }
}

/** Open due auctions (Sunday + random shelter) and close any that are over. */
export function ensureAuctions(db: Database, nowMs: number): void {
  for (const a of db.auctions) {
    if (a.status === 'open' && nowMs >= Date.parse(a.endAt)) closeAuction(db, a);
  }

  // Sunday auction: one per Sunday, live during its 11:00–20:00 window.
  for (let back = 0; back <= 7; back++) {
    const dayMs = nowMs - back * 86400000;
    if (brusselsWeekday(dayMs) !== 0) continue; // Sunday only
    const p = tzParts(dayMs);
    const startMs = wallToUtcMs(p.y, p.m, p.d, OPEN_HOUR);
    const endMs = startMs + WINDOW_HOURS * 3600000;
    if (nowMs < startMs || nowMs >= endMs) break; // not inside this Sunday's window
    const key = `auction:${p.y}-${p.m}-${p.d}`;
    if (!db.auctions.some((a) => a.templateKey === key)) createSundayAuction(db, key, startMs, endMs);
    break;
  }

  // Rescue-centre auctions: memoryless spawn based on elapsed real time, so the
  // rate is independent of how often the game is polled.
  const openShelter = db.auctions.filter((a) => a.status === 'open' && auctionKind(a) === 'shelter').length;
  if (openShelter < AUCTION.shelterMaxConcurrent) {
    const last = db.world.lastShelterSpawn ? Date.parse(db.world.lastShelterSpawn) : NaN;
    if (Number.isNaN(last)) {
      db.world.lastShelterSpawn = new Date(nowMs).toISOString();
    } else {
      const dtHours = (nowMs - last) / 3600000;
      if (dtHours > 0) {
        const lambdaPerHour = 1 / AUCTION.shelterMeanIntervalHours;
        if (Math.random() < 1 - Math.exp(-lambdaPerHour * dtHours)) {
          createShelterAuction(db, nowMs);
        }
        db.world.lastShelterSpawn = new Date(nowMs).toISOString();
      }
    }
  }

  if (db.auctions.length > 12) db.auctions = db.auctions.slice(-12);
}

/**
 * Place a bid on an open auction (by id). Money is NOT escrowed — you only have
 * to hold the amount when you bid. At close the highest bidder who can still pay
 * (and has room) wins; if not, it cascades to the next highest bidder.
 * Returns an error string or null.
 */
export function placeBid(db: Database, userId: string, auctionId: string, amount: number): string | null {
  const a = db.auctions.find((x) => x.id === auctionId && x.status === 'open');
  if (!a) return 'Deze veiling loopt niet (meer)';
  const loft = db.lofts.find((l) => l.userId === userId);
  if (!loft) return 'Geen hok gevonden';
  if (a.currentBidderId === userId) return 'Je bent al de hoogste bieder';
  const bid = Math.round(amount);
  const minNext = a.currentBid > 0 ? a.currentBid + a.minIncrement : a.minBid;
  if (!(bid >= minNext)) return `Minimaal bod is €${minNext}`;
  if (loft.money < bid) return 'Je moet het geld dat je biedt ook echt hebben';
  const owned = db.pigeons.filter((p) => p.ownerId === userId).length;
  if (owned >= loft.capacity) return 'Je hok zit vol';

  // Record (or raise) this player's standing bid.
  a.bids = (a.bids ?? []).filter((b) => b.userId !== userId);
  a.bids.push({ userId, name: loft.name, amount: bid });

  if (a.currentBidderId && a.currentBidderId !== userId) {
    const prev = db.lofts.find((l) => l.userId === a.currentBidderId);
    if (prev && !prev.isBot) {
      const pigeonName = db.pigeons.find((p) => p.id === a.pigeonId)?.name ?? 'de veilingduif';
      const reclaim = bid + a.minIncrement;
      const closesAt = new Date(a.endAt).toLocaleTimeString('nl-BE', {
        hour: '2-digit', minute: '2-digit', timeZone: TZ,
      });
      notify(
        db, prev, '📉 Je bent overboden!',
        `${loft.name} bood €${bid} op ${pigeonName} — jouw bod is niet meer het hoogste. ` +
        `Wil je de duif nog? Bied minstens €${reclaim} vóór de veiling sluit (om ${closesAt}).`,
      );
    }
  }
  a.currentBid = bid;
  a.currentBidderId = userId;
  a.currentBidderName = loft.name;
  return null;
}
