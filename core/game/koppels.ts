/**
 * Koppels (hokinrichting — ⚠️ dev, nog niet live).
 *
 * A doffer and a duivin become partners in one of two ways:
 *  - WENNEN: the player puts them together — both in the main loft (neither in an
 *    apart hok), or together in a partnerhok. After a random number of days they
 *    accept each other, or they refuse. Both the day and the verdict are rolled
 *    when the wennen starts (so no tick has to roll them and two requests cannot
 *    disagree) and revealed on that dagovergang (`tickCouples`).
 *  - AANTREKKING: now and then two free birds in the main loft draw together on
 *    their own. The player gets a notification; confirming it makes them a koppel
 *    at once, no wennen.
 *
 * A koppel is what weduwschap flies on (inrichting.widowLevel). Breaking one —
 * `unpair`, or breeding one of them with another bird (`breakForForcedBreeding`)
 * — halves both partners' libido.
 *
 * Everything lives on Loft.equipment (couples, attractions, partnerhokken): no
 * table, no extra query. Bots never pair; they breed the way they always did.
 */

import { BREEDING, COUPLES, EQUIPMENT, TIMEZONE, partnerhokPrice } from '../config/gameConfig.js';
import type { Attraction, Couple, Database, Loft, Pigeon } from '../schema.js';
import type { Store } from '../store.js';
import { debtBlock } from './economy.js';
import { equipmentOf } from './hygiene.js';
import { kinship } from './pedigree.js';
import { ageInWeeks, isAway } from './pigeon.js';
import { clamp, hashString, round1, seededRng } from './util.js';

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Whole-day index of the Brussels calendar date at `ms` (days since epoch). */
export function brusselsDayNumber(ms: number): number {
  const [y, m, d] = dayFormat.format(new Date(ms)).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** A stable-id, idempotent notification for a human loft. */
function note(db: Database, loft: Loft, id: string, title: string, body: string): void {
  if (loft.isBot) return;
  const existing = db.notifications.find((n) => n.id === id);
  const n = { id, userId: loft.userId, kind: 'info' as const, title, body, flightId: null, createdAt: new Date().toISOString(), read: existing?.read ?? false };
  if (existing) Object.assign(existing, n);
  else db.notifications.push(n);
}

const loftOf = (db: Database, userId: string) => db.lofts.find((l) => l.userId === userId);
const own = (db: Database, userId: string, id: string) => db.pigeons.find((p) => p.id === id && p.ownerId === userId);
const first = (p: Pigeon) => p.name.split(' ')[0];

// --- reading ------------------------------------------------------------------

/** The couple (koppel or wennen) this bird is part of, if any. */
export function coupleOf(loft: Loft | undefined, pigeonId: string): Couple | undefined {
  return loft?.equipment?.couples?.find((c) => c.dofferId === pigeonId || c.duivinId === pigeonId);
}

/** Her partner in a koppel (not while still wennen), owned by the same loft. */
export function partnerOf(db: Database, p: Pigeon): Pigeon | null {
  const c = coupleOf(loftOf(db, p.ownerId), p.id);
  if (!c || c.status !== 'koppel') return null;
  const otherId = c.dofferId === p.id ? c.duivinId : c.dofferId;
  return own(db, p.ownerId, otherId) ?? null;
}

/** Are these two a koppel? */
export function areCouple(loft: Loft | undefined, dofferId: string, duivinId: string): boolean {
  return !!loft?.equipment?.couples?.some((c) => c.status === 'koppel' && c.dofferId === dofferId && c.duivinId === duivinId);
}

/** Partnerhokken in use by a pair that is wennen there. */
export function partnerhokInUse(loft: Loft): number {
  return (loft.equipment?.couples ?? []).filter((c) => c.partnerhok).length;
}

/**
 * Do they sit together? In a partnerhok they always do; otherwise both must be
 * in the main loft — home, not in the infirmary, and neither in an apart hok.
 */
export function together(a: Pigeon, b: Pigeon, partnerhok = false, nowMs: number = Date.now()): boolean {
  if (isAway(a, nowMs) || isAway(b, nowMs) || a.inInfirmary || b.inInfirmary) return false;
  return partnerhok || (!a.compartment && !b.compartment);
}

/** In the main loft right now: home, not in the infirmary, not in an apart hok. */
function inMainLoft(p: Pigeon, nowMs: number): boolean {
  return !isAway(p, nowMs) && !p.inInfirmary && !p.compartment;
}

/** A bird that may take a partner at all (adult, not imported-and-quarantined). */
function canPair(db: Database, p: Pigeon, nowMs: number): boolean {
  const q = p.care?.quarantineUntil ? Date.parse(p.care.quarantineUntil) : NaN;
  return ageInWeeks(p, db.world.currentWeek) >= BREEDING.minAgeWeeks && !(q > nowMs);
}

/** The refusal chance for a pair (lower with more libido, halved in a partnerhok). */
export function refuseChance(doffer: Pigeon, duivin: Pigeon, partnerhok: boolean): number {
  const avgLibido = (doffer.libido + duivin.libido) / 2;
  const base = clamp(COUPLES.refuseMax - avgLibido / COUPLES.refuseLibidoDivisor, COUPLES.refuseMin, COUPLES.refuseMax);
  return partnerhok ? base * COUPLES.partnerhokRefuseMult : base;
}

// --- writing ------------------------------------------------------------------

function setCouples(loft: Loft, couples: Couple[]): void {
  loft.equipment = { ...equipmentOf(loft), couples };
}

function setAttractions(loft: Loft, attractions: Attraction[]): void {
  loft.equipment = { ...equipmentOf(loft), attractions };
}

/** Halve a bird's libido (a koppel broken). */
function heartbreak(p: Pigeon | undefined): void {
  if (p) p.libido = round1(p.libido * COUPLES.breakLibidoMult);
}

/** Drop a couple; a real koppel costs both partners half their libido. Widowhood stops. */
function dissolve(db: Database, loft: Loft, c: Couple): void {
  setCouples(loft, (loft.equipment?.couples ?? []).filter((x) => x !== c));
  const doffer = own(db, loft.userId, c.dofferId);
  const duivin = own(db, loft.userId, c.duivinId);
  if (c.status === 'koppel') {
    heartbreak(doffer);
    heartbreak(duivin);
  }
  if (doffer?.care?.widow) {
    delete doffer.care.widow;
    if (Object.keys(doffer.care).length === 0) delete doffer.care;
  }
}

/** Buy a partnerhok (a box where two birds sit together to wennen). */
export function buyPartnerhok(store: Store, userId: string): string | null {
  return store.mutate((db) => {
    const loft = loftOf(db, userId);
    if (!loft) return 'Geen hok gevonden';
    const debt = debtBlock(loft); if (debt) return debt;
    const eq = equipmentOf(loft);
    const owned = eq.partnerhokken ?? 0;
    if (owned >= EQUIPMENT.partnerhok.maxBoxes) return 'Je hebt al het maximum aan partnerhokken';
    const price = partnerhokPrice(owned);
    if (loft.money < price) return 'Niet genoeg geld voor een partnerhok';
    loft.money -= price;
    loft.equipment = { ...eq, partnerhokken: owned + 1 };
    return null;
  });
}

/**
 * Let a doffer and a duivin get used to each other. They must sit together: both
 * in the main loft, or (`partnerhok`) together in a free partnerhok. The day they
 * decide and whether they refuse are rolled now and stay secret.
 */
export function startWennen(
  store: Store, userId: string, dofferId: string, duivinId: string,
  opts: { partnerhok?: boolean } = {}, nowMs: number = Date.now(), rng: () => number = Math.random,
): string | null {
  return store.mutate((db) => {
    const loft = loftOf(db, userId);
    const doffer = own(db, userId, dofferId);
    const duivin = own(db, userId, duivinId);
    if (!loft || !doffer || !duivin) return 'Duif niet gevonden';
    if (doffer.sex !== 'doffer' || duivin.sex !== 'duivin') return 'Een koppel is een doffer en een duivin';
    for (const p of [doffer, duivin]) {
      const c = coupleOf(loft, p.id);
      if (c?.status === 'koppel') return `${p.name} heeft al een partner — ontkoppel eerst`;
      if (c?.status === 'wennen') return `${p.name} is al aan het wennen aan een andere duif`;
      if (!canPair(db, p, nowMs)) return `${p.name} kan nog geen partner nemen (te jong of in quarantaine)`;
    }
    const inBox = !!opts.partnerhok;
    if (inBox && partnerhokInUse(loft) >= (loft.equipment?.partnerhokken ?? 0)) return 'Er is geen vrij partnerhok';
    if (!together(doffer, duivin, inBox, nowMs)) {
      return inBox
        ? 'Beide duiven moeten thuis zijn (niet in de ziekenboeg, niet de weg kwijt)'
        : 'Ze moeten samen in het hoofdhok zitten — niet in een apart hok of de ziekenboeg. Of gebruik een partnerhok.';
    }
    const maxDays = inBox ? COUPLES.partnerhokMaxDays : COUPLES.wennenMaxDays;
    const days = 1 + Math.floor(rng() * maxDays);
    const refuses = rng() < refuseChance(doffer, duivin, inBox);
    setCouples(loft, [
      ...(loft.equipment?.couples ?? []),
      {
        dofferId, duivinId, status: 'wennen',
        startedAt: new Date(nowMs).toISOString(),
        resolveDay: brusselsDayNumber(nowMs) + days,
        refuses,
        ...(inBox ? { partnerhok: true } : {}),
      },
    ]);
    // An attraction between either of them is moot now.
    setAttractions(loft, (loft.equipment?.attractions ?? []).filter((a) => ![a.dofferId, a.duivinId].some((x) => x === dofferId || x === duivinId)));
    return null;
  });
}

/** Say yes to two birds that found each other: a koppel at once, no wennen. */
export function confirmAttraction(store: Store, userId: string, dofferId: string, duivinId: string, nowMs: number = Date.now()): string | null {
  return store.mutate((db) => {
    const loft = loftOf(db, userId);
    const doffer = own(db, userId, dofferId);
    const duivin = own(db, userId, duivinId);
    if (!loft || !doffer || !duivin) return 'Duif niet gevonden';
    const att = (loft.equipment?.attractions ?? []).find((a) => a.dofferId === dofferId && a.duivinId === duivinId);
    if (!att || att.expiresDay < brusselsDayNumber(nowMs)) return 'Die twee trekken niet (meer) naar elkaar toe';
    if (coupleOf(loft, dofferId) || coupleOf(loft, duivinId)) return 'Een van beide heeft intussen al een partner';
    const iso = new Date(nowMs).toISOString();
    setCouples(loft, [...(loft.equipment?.couples ?? []), { dofferId, duivinId, status: 'koppel', startedAt: iso, since: iso }]);
    setAttractions(loft, (loft.equipment?.attractions ?? []).filter((a) => a !== att && ![a.dofferId, a.duivinId].some((x) => x === dofferId || x === duivinId)));
    return null;
  });
}

/** Let an attraction pass. */
export function dismissAttraction(store: Store, userId: string, dofferId: string, duivinId: string): string | null {
  return store.mutate((db) => {
    const loft = loftOf(db, userId);
    if (!loft) return 'Geen hok gevonden';
    setAttractions(loft, (loft.equipment?.attractions ?? []).filter((a) => !(a.dofferId === dofferId && a.duivinId === duivinId)));
    return null;
  });
}

/**
 * A koppel moves into a partnerhok (or back out). The box is theirs: they leave an
 * apart hok if they had one, and a weduwnaar stops being one — he lives with her
 * now. Only a koppel moves in; a pair that wennen picks the box at the start.
 */
export function setPartnerhok(store: Store, userId: string, pigeonId: string, into: boolean): string | null {
  return store.mutate((db) => {
    const loft = loftOf(db, userId);
    if (!loft || !own(db, userId, pigeonId)) return 'Duif niet gevonden';
    const c = coupleOf(loft, pigeonId);
    if (!c) return 'Deze duif heeft geen partner';
    const couples = loft.equipment?.couples ?? [];
    if (!into) {
      if (!c.partnerhok) return null;
      if (c.status === 'wennen') return 'Ze wennen in het partnerhok — stop het wennen, of wacht tot ze beslist hebben';
      const { partnerhok: _gone, ...rest } = c;
      setCouples(loft, couples.map((x) => (x === c ? rest : x)));
      return null;
    }
    if (c.partnerhok) return null;
    if (c.status !== 'koppel') return 'Enkel een koppel trekt in een partnerhok — om te wennen kies je het partnerhok bij de start';
    if (partnerhokInUse(loft) >= (loft.equipment?.partnerhokken ?? 0)) return 'Er is geen vrij partnerhok — koop er een op de pagina Inrichting';
    for (const id of [c.dofferId, c.duivinId]) {
      const p = own(db, userId, id);
      if (p) p.compartment = false;
    }
    const doffer = own(db, userId, c.dofferId);
    if (doffer?.care?.widow) {
      delete doffer.care.widow;
      if (Object.keys(doffer.care).length === 0) delete doffer.care;
    }
    setCouples(loft, couples.map((x) => (x === c ? { ...x, partnerhok: true } : x)));
    return null;
  });
}

/** A bird that moves into an apart hok takes her koppel out of its partnerhok. */
export function leavePartnerhok(loft: Loft, pigeonId: string): void {
  const c = coupleOf(loft, pigeonId);
  if (!c?.partnerhok || c.status !== 'koppel') return;
  const { partnerhok: _gone, ...rest } = c;
  setCouples(loft, (loft.equipment?.couples ?? []).map((x) => (x === c ? rest : x)));
}

/**
 * Break the couple this bird is in. A koppel: both lose half their libido. A pair
 * still wennen simply stops (they were not partners yet).
 */
export function unpair(store: Store, userId: string, pigeonId: string): string | null {
  return store.mutate((db) => {
    const loft = loftOf(db, userId);
    if (!loft || !own(db, userId, pigeonId)) return 'Duif niet gevonden';
    const c = coupleOf(loft, pigeonId);
    if (!c) return 'Deze duif heeft geen partner';
    dissolve(db, loft, c);
    return null;
  });
}

/**
 * Breeding two birds that are NOT each other's partner: every koppel either of
 * them is in falls apart (both partners −50 % libido), and a pair still wennen
 * stops. Called by startBreeding once everything else checked out. Returns the
 * names of the broken koppels, for the notification.
 */
export function breakForForcedBreeding(db: Database, loft: Loft, sireId: string, damId: string): string[] {
  if (areCouple(loft, sireId, damId)) return [];
  const broken: string[] = [];
  for (const id of [sireId, damId]) {
    const c = coupleOf(loft, id);
    if (!c) continue;
    if (c.status === 'koppel') {
      const a = own(db, loft.userId, c.dofferId);
      const b = own(db, loft.userId, c.duivinId);
      broken.push(`${a ? first(a) : '?'} & ${b ? first(b) : '?'}`);
    }
    dissolve(db, loft, c);
  }
  if (broken.length > 0) {
    note(db, loft, `ntf:koppel:broken:${sireId}:${damId}`, '💔 Koppel uit elkaar',
      `Door het geforceerde nest ${broken.length === 1 ? 'is het koppel' : 'zijn de koppels'} ${broken.join(' en ')} uit elkaar. Beide partners verloren de helft van hun libido.`);
  }
  return broken;
}

// --- the dagovergang ----------------------------------------------------------

/**
 * Once a day per loft (tickDailyCare): drop couples whose birds are gone, reveal
 * the wennen that decide today, let old attractions lapse and maybe start a new
 * one. A loft with no couples, no attractions and no free duo writes nothing.
 */
export function tickCouples(db: Database, loft: Loft, owned: Pigeon[], dayNo: number, nowMs: number): void {
  const couples = loft.equipment?.couples ?? [];
  const attractions = loft.equipment?.attractions ?? [];
  const byId = new Map(owned.map((p) => [p.id, p]));

  if (couples.length > 0) {
    let next = couples;
    for (const c of couples) {
      const doffer = byId.get(c.dofferId);
      const duivin = byId.get(c.duivinId);
      if (!doffer || !duivin) {
        // Sold or died: the koppel ends without a heartbreak for the one left behind.
        next = next.filter((x) => x !== c);
        if (doffer?.care?.widow) delete doffer.care.widow;
        continue;
      }
      if (c.status !== 'wennen' || (c.resolveDay ?? Infinity) > dayNo) continue;
      const id = `ntf:koppel:${c.dofferId}:${c.duivinId}:${c.startedAt}`;
      if (!together(doffer, duivin, !!c.partnerhok, nowMs)) {
        next = next.filter((x) => x !== c);
        note(db, loft, id, '💔 Geen koppel', `${first(doffer)} en ${first(duivin)} zaten niet meer samen — het wennen is mislukt.`);
      } else if (c.refuses) {
        next = next.filter((x) => x !== c);
        note(db, loft, id, '🙅 Ze willen elkaar niet', `${first(doffer)} en ${first(duivin)} hebben elkaar geweigerd. Probeer een andere partner.`);
      } else {
        const since = new Date(nowMs).toISOString();
        // Wennen in a partnerhok: the new koppel stays in it (out again via setPartnerhok).
        next = next.map((x) => (x === c
          ? { dofferId: c.dofferId, duivinId: c.duivinId, status: 'koppel' as const, startedAt: c.startedAt, since, ...(c.partnerhok ? { partnerhok: true } : {}) }
          : x));
        note(db, loft, id, '💑 Een nieuw koppel', `${first(doffer)} en ${first(duivin)} hebben elkaar aanvaard — ze zijn nu partners.`);
      }
    }
    if (next !== couples) setCouples(loft, next);
  }

  // Attractions: drop the stale ones (lapsed, or a bird no longer free or home).
  const busy = new Set((loft.equipment?.couples ?? []).flatMap((c) => [c.dofferId, c.duivinId]));
  const fresh = attractions.filter((a) => {
    const d = byId.get(a.dofferId);
    const h = byId.get(a.duivinId);
    return a.expiresDay >= dayNo && d && h && !busy.has(d.id) && !busy.has(h.id) && together(d, h, false, nowMs);
  });
  if (fresh.length !== attractions.length) setAttractions(loft, fresh);

  // And maybe two free birds find each other today (human lofts only).
  if (loft.isBot || fresh.length >= COUPLES.maxOpenAttractions) return;
  const rng = seededRng(hashString(`attract:${loft.userId}:${dayNo}`));
  if (rng() >= COUPLES.attractionChancePerDay) return;
  const offered = new Set(fresh.flatMap((a) => [a.dofferId, a.duivinId]));
  const free = owned.filter((p) => !busy.has(p.id) && !offered.has(p.id) && canPair(db, p, nowMs) && inMainLoft(p, nowMs));
  const duos: { d: Pigeon; h: Pigeon; w: number }[] = [];
  for (const d of free.filter((p) => p.sex === 'doffer')) {
    for (const h of free.filter((p) => p.sex === 'duivin')) {
      if (kinship(db, d, h)) continue; // family does not draw together here
      duos.push({ d, h, w: Math.max(1, d.libido + h.libido) });
    }
  }
  if (duos.length === 0) return;
  let pick = rng() * duos.reduce((s, x) => s + x.w, 0);
  const chosen = duos.find((x) => (pick -= x.w) <= 0) ?? duos[duos.length - 1];
  setAttractions(loft, [...fresh, { dofferId: chosen.d.id, duivinId: chosen.h.id, day: dayNo, expiresDay: dayNo + COUPLES.attractionDays }]);
  note(db, loft, `ntf:attract:${loft.userId}:${dayNo}`, `💕 ${first(chosen.d)} en ${first(chosen.h)} trekken naar elkaar toe`,
    `Ze zoeken elkaar steeds op in het hok. Bevestig het op de pagina Kweek, dan zijn ze meteen een koppel — zonder wentijd.`);
}
