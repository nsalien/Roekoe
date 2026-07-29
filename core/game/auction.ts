/**
 * Weekly Sunday auction. Every Sunday from 11:00 to 20:00 (Brussels) a special
 * top pigeon goes under the hammer. Players bid; the highest bid is held in
 * escrow (refunded when outbid). At close the winner keeps the bird.
 */

import type { Auction, Database, Loft } from '../schema.js';
import { newId } from '../store.js';
import { estimateValue, generatePigeon, talent } from './pigeon.js';
import { randFloat } from './util.js';

export const AUCTION_HOUSE_ID = 'auction_house';
const TZ = 'Europe/Brussels';
const OPEN_HOUR = 11;
const WINDOW_HOURS = 9; // 11:00 → 20:00

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

function createAuction(db: Database, key: string, startMs: number, endMs: number): void {
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
    currentBid: 0, currentBidderId: null, currentBidderName: null, status: 'open',
  });
  for (const loft of db.lofts) {
    if (!loft.isBot) {
      notify(db, loft, '🔨 Zondagveiling geopend!',
        `Topduif ${p.name} (talent ${talent(p)}) gaat onder de hamer tot 20u. Bied mee op de markt!`);
    }
  }
}

function closeAuction(db: Database, a: Auction): void {
  a.status = 'closed';
  const p = db.pigeons.find((x) => x.id === a.pigeonId);
  if (a.currentBidderId && p) {
    p.ownerId = a.currentBidderId;
    p.forSale = false;
    const winner = db.lofts.find((l) => l.userId === a.currentBidderId);
    if (winner) {
      db.trades.push({
        id: newId('trd'), pigeonId: p.id, pigeonName: p.name,
        sellerId: AUCTION_HOUSE_ID, sellerName: 'Veilinghuis',
        buyerId: winner.userId, buyerName: winner.name, price: a.currentBid,
        at: new Date().toISOString(),
      });
      winner.stats.buys += 1;
      notify(db, winner, '🔨 Veiling gewonnen!',
        `${p.name} is voor jou, voor €${a.currentBid}. Veel vliegplezier!`);
    }
  } else if (p) {
    db.pigeons = db.pigeons.filter((x) => x.id !== a.pigeonId); // unsold, withdrawn
  }
}

/** Open the Sunday auction when due and close any that are over. */
export function ensureAuctions(db: Database, nowMs: number): void {
  for (const a of db.auctions) {
    if (a.status === 'open' && nowMs >= Date.parse(a.endAt)) closeAuction(db, a);
  }
  for (let back = 0; back <= 7; back++) {
    const dayMs = nowMs - back * 86400000;
    if (brusselsWeekday(dayMs) !== 0) continue; // Sunday only
    const p = tzParts(dayMs);
    const startMs = wallToUtcMs(p.y, p.m, p.d, OPEN_HOUR);
    const endMs = startMs + WINDOW_HOURS * 3600000;
    if (nowMs < startMs || nowMs >= endMs) break; // not inside this Sunday's window
    const key = `auction:${p.y}-${p.m}-${p.d}`;
    if (!db.auctions.some((a) => a.templateKey === key)) createAuction(db, key, startMs, endMs);
    break;
  }
  if (db.auctions.length > 8) db.auctions = db.auctions.slice(-8);
}

/** Place a bid on the open auction. Returns an error string or null. */
export function placeBid(db: Database, userId: string, amount: number): string | null {
  const a = db.auctions.find((x) => x.status === 'open');
  if (!a) return 'Er is momenteel geen veiling';
  const loft = db.lofts.find((l) => l.userId === userId);
  if (!loft) return 'Geen hok gevonden';
  if (a.currentBidderId === userId) return 'Je bent al de hoogste bieder';
  const bid = Math.round(amount);
  const minNext = a.currentBid > 0 ? a.currentBid + a.minIncrement : a.minBid;
  if (!(bid >= minNext)) return `Minimaal bod is €${minNext}`;
  if (loft.money < bid) return 'Niet genoeg geld voor dit bod';
  const owned = db.pigeons.filter((p) => p.ownerId === userId).length;
  if (owned >= loft.capacity) return 'Je hok zit vol';
  if (a.currentBidderId) {
    const prev = db.lofts.find((l) => l.userId === a.currentBidderId);
    if (prev) {
      prev.money += a.currentBid;
      if (!prev.isBot) notify(db, prev, '📉 Overboden', `Iemand bood meer op ${db.pigeons.find((p) => p.id === a.pigeonId)?.name ?? 'de veilingduif'}. Je inzet is terugbetaald.`);
    }
  }
  loft.money -= bid;
  a.currentBid = bid;
  a.currentBidderId = userId;
  a.currentBidderName = loft.name;
  return null;
}
