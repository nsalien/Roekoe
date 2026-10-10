/**
 * De hokinrichting (⚠️ dev, nog niet live) — everything a loft can buy beyond
 * birds: equipment on the loft row (ventilatie, ren, roofvogelafweer, kunstlicht,
 * infrarood-nestbakken, reismanden, weerstation, vakblad), and per-bird care
 * (vaccins en kuren, verzekering). Hygiëne/stro/poetser live in
 * hygiene.ts; the scout in scout.ts.
 *
 * Rule of the proposal: buying nothing is the game as it was. Every effect is
 * small next to an apart hok or a kenmerk, and almost everything costs per day.
 */

import {
  EQUIPMENT,
  EQUIPMENT_LEVELS,
  REST_BONUS,
  cleanerWage,
  INSURANCE,
  VACCINES,
  VACCINE_RENEW_SHARE,
  irBoxPrice,
  levelPrice,
  type EquipmentKey,
  type LevelKey,
  type VaccineKey,
} from '../config/gameConfig.js';
import type { Database, Loft, Pigeon, PigeonCare } from '../schema.js';
import type { Store } from '../store.js';
import { debtBlock } from './economy.js';
import { effectScale, equipmentLevel, equipmentOf } from './hygiene.js';
import { marketValue } from './market.js';
import { ageMortality, isAway } from './pigeon.js';
import { hashString, round1, seededRng } from './util.js';

const DAY = 86400000;

// --- small helpers ------------------------------------------------------------

/** A stable-id, idempotent notification (safe under concurrent ticks). */
export function careNote(db: Database, userId: string, id: string, title: string, body: string): void {
  if (db.lofts.find((l) => l.userId === userId)?.isBot) return;
  const existing = db.notifications.find((n) => n.id === id);
  const note = { id, userId, kind: 'info' as const, title, body, flightId: null, createdAt: new Date().toISOString(), read: existing?.read ?? false };
  if (existing) Object.assign(existing, note);
  else db.notifications.push(note);
}

function careOf(p: Pigeon): PigeonCare {
  if (!p.care) p.care = {};
  return p.care;
}

/** Drop empty care so an untouched bird writes '' (see pigeonRow). */
function tidy(p: Pigeon): void {
  if (!p.care) return;
  for (const k of Object.keys(p.care) as (keyof PigeonCare)[]) if (p.care[k] === undefined) delete p.care[k];
  if (p.care.vaccines && Object.keys(p.care.vaccines).length === 0) delete p.care.vaccines;
  if (Object.keys(p.care).length === 0) delete p.care;
}

const loftOf = (db: Database, userId: string) => db.lofts.find((l) => l.userId === userId);

// --- equipment: buying --------------------------------------------------------

/** Buy one piece of equipment (or, for the vakblad, subscribe/unsubscribe). */
export function buyEquipment(store: Store, userId: string, key: EquipmentKey, on = true): string | null {
  return store.mutate((db) => {
    const loft = loftOf(db, userId);
    if (!loft) return 'Geen hok gevonden';
    const item = EQUIPMENT[key];
    const eq = { ...equipmentOf(loft) };
    if (key === 'magazine') {
      if (on) { const debt = debtBlock(loft); if (debt) return debt; }
      eq.magazine = on;
      loft.equipment = eq;
      return null;
    }
    if (!on) return 'Dit kan je niet terugverkopen';
    if (eq[key]) return `Je hebt al: ${item.label.toLowerCase()}`;
    if (key === 'raptorGuard' && !eq.run) return 'Roofvogelafweer hangt over de buitenren — bouw eerst een ren';
    const debt = debtBlock(loft); if (debt) return debt;
    const price = (item as { price: number }).price;
    if (loft.money < price) return `Niet genoeg geld voor ${item.label.toLowerCase()}`;
    loft.money -= price;
    (eq as Record<string, unknown>)[key] = true;
    loft.equipment = eq;
    return null;
  });
}

/**
 * Take an item one level up (EQUIPMENT_LEVELS). It must be bought first; every
 * level costs `priceGrowth` times the one before. Like the first purchase, it
 * cannot be sold back.
 */
export function upgradeEquipment(store: Store, userId: string, key: string): string | null {
  return store.mutate((db) => {
    const loft = loftOf(db, userId);
    if (!loft) return 'Geen hok gevonden';
    if (!(EQUIPMENT_LEVELS.keys as readonly string[]).includes(key)) return 'Dit heeft geen niveaus';
    const k = key as LevelKey;
    const level = equipmentLevel(loft, k);
    const label = EQUIPMENT[k].label.toLowerCase();
    if (level === 0) return `Koop eerst ${label}`;
    if (level >= EQUIPMENT_LEVELS.maxLevel) return `${EQUIPMENT[k].label} staat al op het hoogste niveau`;
    const debt = debtBlock(loft); if (debt) return debt;
    const price = levelPrice(k, level + 1);
    if (loft.money < price) return `Niet genoeg geld voor niveau ${level + 1} (€${price.toLocaleString('nl-BE')})`;
    loft.money -= price;
    const eq = { ...equipmentOf(loft) };
    eq.levels = { ...(eq.levels ?? {}), [k]: level + 1 };
    loft.equipment = eq;
    return null;
  });
}

/** Buy infrarood above the nest boxes: the first purchase covers two. */
export function buyIrBox(store: Store, userId: string): string | null {
  return store.mutate((db) => {
    const loft = loftOf(db, userId);
    if (!loft) return 'Geen hok gevonden';
    const debt = debtBlock(loft); if (debt) return debt;
    const eq = { ...equipmentOf(loft) };
    const owned = eq.irBoxes ?? 0;
    if (owned >= EQUIPMENT.irBoxes.maxBoxes) return 'Je hebt al het maximum aan verwarmde nestbakken';
    const price = irBoxPrice(owned);
    if (loft.money < price) return 'Niet genoeg geld voor infrarood';
    loft.money -= price;
    eq.irBoxes = owned === 0 ? 2 : owned + 1;
    loft.equipment = eq;
    return null;
  });
}

// --- equipment: daily cost ----------------------------------------------------

export interface EquipmentCostLine { key: string; label: string; amount: number }

/** How many heated nest boxes hold a pair right now. */
export function irBoxesInUse(loft: Loft, pairs: number): number {
  return Math.min(equipmentOf(loft).irBoxes ?? 0, pairs);
}

/**
 * What runs per day, per item. Read by dailyRunningCostBreakdown, so it is in
 * the Dagbalans AND in what tickDailyCare charges — one source. Equipment is a
 * one-off purchase now: only a person (the hokpoetser, more birds = dearer) and
 * a subscription (the vakblad) cost something every day.
 */
export function equipmentCostLines(loft: Loft, pigeonCount: number): EquipmentCostLine[] {
  const eq = equipmentOf(loft);
  const lines: EquipmentCostLine[] = [];
  if (eq.cleaner) lines.push({ key: 'cleaner', label: 'Hokpoetser', amount: cleanerWage(pigeonCount) });
  if (eq.magazine) lines.push({ key: 'magazine', label: EQUIPMENT.magazine.label, amount: EQUIPMENT.magazine.daily });
  return lines;
}

// --- niveaus for the page ----------------------------------------------------

/** 22,5 / 72 / 7,6: one decimal only where there is one. */
const dec = (x: number) => (Math.round(x * 10) / 10).toLocaleString('nl-BE');

/**
 * Each levelled item's main effect, per level — what the page shows next to an
 * upgrade ("ornithose −60 % → −72 %"). All its other effects grow by the same factor.
 */
const GAIN: Record<LevelKey, { what: string; at: (s: number) => string }> = {
  ventilation: { what: 'ornithose', at: (s) => `−${dec((1 - EQUIPMENT.ventilation.ornithoseMult) * 100 * s)} %` },
  run: { what: 'energie na een rustdag', at: (s) => `+${dec(REST_BONUS.energy + (EQUIPMENT.run.restBonusEnergy - REST_BONUS.energy) * s)}` },
  light: { what: 'libido', at: (s) => `+${dec(EQUIPMENT.light.libidoTarget * s)}` },
  irBoxes: { what: 'sneller uit', at: (s) => `+${dec((EQUIPMENT.irBoxes.hatchSpeed - 1) * 100 * s)} %` },
  baskets: { what: 'energieverlies per vlucht', at: (s) => `−${dec((1 - EQUIPMENT.baskets.energyMult) * 100 * s)} %` },
};

/**
 * What the Inrichting page needs to offer a level: how far it goes, how much
 * stronger each level works (×1 · ×1,5 · ×1,8 · ×2), what every level costs and
 * the main effect at every level. The exact numbers of all effects are in the wiki.
 */
export function inrichtingLevels(): {
  max: number; scale: readonly number[]; prices: Record<LevelKey, number[]>;
  gain: Record<LevelKey, { what: string; values: string[] }>;
} {
  const prices = {} as Record<LevelKey, number[]>;
  const gain = {} as Record<LevelKey, { what: string; values: string[] }>;
  for (const k of EQUIPMENT_LEVELS.keys) {
    prices[k] = EQUIPMENT_LEVELS.effectScale.map((_, i) => levelPrice(k, i + 1));
    gain[k] = { what: GAIN[k].what, values: EQUIPMENT_LEVELS.effectScale.map((sc) => GAIN[k].at(sc)) };
  }
  return { max: EQUIPMENT_LEVELS.maxLevel, scale: EQUIPMENT_LEVELS.effectScale, prices, gain };
}

// --- equipment: effects -------------------------------------------------------

/** Extra libido target from kunstlicht and the buitenren (applyDayOfCare). */
export function libidoTargetBonus(loft: Loft): number {
  return EQUIPMENT.light.libidoTarget * effectScale(loft, 'light') + EQUIPMENT.run.libidoTarget * effectScale(loft, 'run');
}

/** The rest bonus on every third rest day: +6 with a buitenren instead of +4 (more per level). */
export function restBonusEnergy(loft: Loft, base: number): number {
  return base + (EQUIPMENT.run.restBonusEnergy - base) * effectScale(loft, 'run');
}

/** Health recovery from feed: +5 % with dakventilatie (more per level). */
export function feedHealthMult(loft: Loft): number {
  return 1 + EQUIPMENT.ventilation.healthRecoveryBonus * effectScale(loft, 'ventilation');
}

/** Infrarood at its level: how much faster a heated nest hatches, and its bonuses. */
export function irBoxEffect(loft: Loft): { hatchSpeed: number; twin: number; coldSuccess: number } {
  const s = effectScale(loft, 'irBoxes');
  return {
    hatchSpeed: 1 + (EQUIPMENT.irBoxes.hatchSpeed - 1) * s,
    twin: EQUIPMENT.irBoxes.twinBonus * s,
    coldSuccess: EQUIPMENT.irBoxes.coldSuccessBonus * s,
  };
}

/** Does this bird fend off the disease she just caught? (ventilatie, vaccins, kuren) */
export function fendsOff(loft: Loft, p: Pigeon, diseaseName: string, nowMs: number, rng: () => number = Math.random): boolean {
  if (diseaseName === 'Ornithose' && rng() < (1 - EQUIPMENT.ventilation.ornithoseMult) * effectScale(loft, 'ventilation')) return true;
  const until = p.care?.vaccines ?? {};
  for (const [key, iso] of Object.entries(until)) {
    const v = VACCINES[key as VaccineKey];
    if (!v || v.disease !== diseaseName) continue;
    if (Date.parse(iso) > nowMs && rng() < v.protect) return true;
  }
  return false;
}

/**
 * De sperwer boven de ren (no roofvogelafweer): on average once every 40 days,
 * the birds resting in the ren that day lose some energie. No injuries. Seeded
 * on the loft and the day, so two requests closing the same day agree.
 */
export function tickHawk(db: Database, loft: Loft, owned: Pigeon[], dayNo: number, livePigeonIds: Set<string>): void {
  const eq = loft.equipment;
  if (!eq?.run || eq.raptorGuard) return;
  const rng = seededRng(hashString(`hawk:${loft.userId}:${dayNo}`));
  if (rng() >= EQUIPMENT.run.hawkChancePerDay) return;
  const inRun = owned.filter((p) => !p.inInfirmary && !isAway(p) && !livePigeonIds.has(p.id));
  if (inRun.length === 0) return;
  for (const p of inRun) p.form = round1(Math.max(0, p.form - EQUIPMENT.run.hawkEnergyLoss));
  eq.lastHawkDay = dayNo;
  careNote(
    db, loft.userId, `ntf:hawk:${loft.userId}:${dayNo}`, '🦅 Sperwer boven de ren',
    `Een sperwer joeg je duiven in de ren de stuipen op het lijf. ${inRun.length} ${inRun.length === 1 ? 'duif verloor' : 'duiven verloren'} wat energie. Roofvogelafweer houdt hem weg.`,
  );
}

// --- vaccins en kuren ---------------------------------------------------------

/** Can't fly right now: a fresh vaccine, or import quarantine. */
export function grounded(p: Pigeon, nowMs: number = Date.now()): string | null {
  const q = p.care?.quarantineUntil ? Date.parse(p.care.quarantineUntil) : NaN;
  if (q > nowMs) return 'Deze duif zit nog in quarantaine na haar import';
  const v = p.care?.noFlyUntil ? Date.parse(p.care.noFlyUntil) : NaN;
  if (v > nowMs) return 'Deze duif is net ingeënt en mag nog niet vliegen';
  return null;
}

/** In import quarantine: no pairing either. */
export function inQuarantine(p: Pigeon, nowMs: number = Date.now()): boolean {
  return !!p.care?.quarantineUntil && Date.parse(p.care.quarantineUntil) > nowMs;
}

function applyVaccine(p: Pigeon, key: VaccineKey, nowMs: number): void {
  const v = VACCINES[key];
  const care = careOf(p);
  care.vaccines = { ...(care.vaccines ?? {}), [key]: new Date(nowMs + v.days * DAY).toISOString() };
  if (v.noFlyDays > 0) {
    const until = nowMs + v.noFlyDays * DAY;
    const prev = care.noFlyUntil ? Date.parse(care.noFlyUntil) : 0;
    care.noFlyUntil = new Date(Math.max(prev, until)).toISOString();
  }
  if (v.libidoHit) p.libido = round1(Math.max(0, p.libido - v.libidoHit));
}

/** Is she unprotected against this, or close enough to the end of her course to renew? */
export function needsCourse(p: Pigeon, key: VaccineKey, nowMs: number): boolean {
  const until = p.care?.vaccines?.[key];
  if (!until) return true;
  return Date.parse(until) - nowMs < VACCINES[key].days * VACCINE_RENEW_SHARE * DAY;
}

/** Give one bird a vaccine or kuur. */
export function vaccinate(store: Store, userId: string, pigeonId: string, key: VaccineKey, nowMs: number = Date.now()): string | null {
  return store.mutate((db) => {
    const loft = loftOf(db, userId);
    const p = db.pigeons.find((x) => x.id === pigeonId && x.ownerId === userId);
    const v = VACCINES[key];
    if (!loft || !p) return 'Duif niet gevonden';
    if (!v) return 'Onbekend middel';
    const debt = debtBlock(loft); if (debt) return debt;
    if (isAway(p)) return 'Deze duif is nog niet thuis';
    if (loft.money < v.price) return `Niet genoeg geld voor ${v.label.toLowerCase()}`;
    loft.money -= v.price;
    applyVaccine(p, key, nowMs);
    return null;
  });
}

/** "Hele hok": the same middel for every bird at home. Returns an error or a summary. */
export function vaccinateLoft(store: Store, userId: string, key: VaccineKey, nowMs: number = Date.now()): { error: string | null; count: number } {
  return store.mutate((db) => {
    const loft = loftOf(db, userId);
    const v = VACCINES[key];
    if (!loft || !v) return { error: 'Onbekend middel', count: 0 };
    const debt = debtBlock(loft); if (debt) return { error: debt, count: 0 };
    const home = db.pigeons.filter((p) => p.ownerId === userId && !isAway(p));
    if (home.length === 0) return { error: 'Geen duiven thuis', count: 0 };
    // Skip who is still well covered: renewing her is a choice on her own page.
    const birds = home.filter((p) => needsCourse(p, key, nowMs));
    if (birds.length === 0) return { error: `Al je duiven thuis zijn nog beschermd met ${v.label.toLowerCase()}`, count: 0 };
    const cost = birds.length * v.price;
    if (loft.money < cost) return { error: `Niet genoeg geld (€${cost} voor ${birds.length} duiven)`, count: 0 };
    loft.money -= cost;
    for (const p of birds) applyVaccine(p, key, nowMs);
    return { error: null, count: birds.length };
  });
}

// --- verzekering --------------------------------------------------------------

/** Her chance to die on one real day: the flat base plus old age (4 gameweeks per 7 days). */
export function dailyDeathChance(p: Pigeon, week: number): number {
  return INSURANCE.baseDailyDeath + ageMortality(p, week) * (4 / 7);
}

/** Premium per day for a policy paying `payout`. */
export function insurancePremium(p: Pigeon, week: number, payout: number): number {
  return Math.round(INSURANCE.loading * payout * dailyDeathChance(p, week) * 100) / 100;
}

/** What a policy taken out today would pay, and cost per day. */
export function insuranceQuote(db: Database, p: Pigeon): { payout: number; premium: number } {
  const payout = Math.round(marketValue(db, p, db.world.currentWeek) * INSURANCE.payoutRate);
  return { payout, premium: insurancePremium(p, db.world.currentWeek, payout) };
}

export function setInsurance(store: Store, userId: string, pigeonId: string, on: boolean, nowMs: number = Date.now()): string | null {
  return store.mutate((db) => {
    const loft = loftOf(db, userId);
    const p = db.pigeons.find((x) => x.id === pigeonId && x.ownerId === userId);
    if (!loft || !p) return 'Duif niet gevonden';
    if (!on) {
      if (p.care) p.care.insurance = undefined;
      tidy(p);
      return null;
    }
    const debt = debtBlock(loft); if (debt) return debt;
    if (p.care?.insurance) return 'Deze duif is al verzekerd';
    const { payout } = insuranceQuote(db, p);
    if (payout <= 0) return 'Deze duif heeft geen marktwaarde om te verzekeren';
    careOf(p).insurance = { payout, since: new Date(nowMs).toISOString() };
    return null;
  });
}

/** Total premium a loft pays today (Dagbalans). */
export function insuranceCost(pigeons: Pigeon[], week: number): number {
  let sum = 0;
  for (const p of pigeons) if (p.care?.insurance) sum += insurancePremium(p, week, p.care.insurance.payout);
  return Math.round(sum * 100) / 100;
}

export type DeathCause = 'ziekte' | 'ouderdom' | 'vlucht' | 'sperwer' | 'honger';

/**
 * She died: pay out if the policy covers it. Not covered: honger, a flight she
 * started with under INSURANCE.minStartEnergy, an ailment that never saw the
 * infirmary, and the first INSURANCE.waitingDays. Stable notification id.
 */
export function insurancePayout(
  db: Database, p: Pigeon, cause: DeathCause, nowMs: number,
  opts: { startEnergy?: number } = {},
): number {
  const pol = p.care?.insurance;
  if (!pol) return 0;
  const loft = loftOf(db, p.ownerId);
  if (!loft) return 0;
  let reason: string | null = null;
  if (nowMs - Date.parse(pol.since) < INSURANCE.waitingDays * DAY) reason = 'ze was nog geen week verzekerd';
  else if (cause === 'honger') reason = 'honger is niet gedekt';
  else if (cause === 'vlucht' && (opts.startEnergy ?? 100) < INSURANCE.minStartEnergy) reason = 'ze vertrok met te weinig energie';
  else if (cause === 'ziekte' && !(p.ailment?.boeg || p.inInfirmary)) reason = 'ze lag nooit in de ziekenboeg';
  const id = `ntf:insure:${p.id}`;
  if (reason) {
    careNote(db, loft.userId, id, `🛡️ Geen uitkering voor ${p.name}`, `De verzekering betaalt niet: ${reason}.`);
    return 0;
  }
  loft.money += pol.payout;
  careNote(db, loft.userId, id, `🛡️ Verzekering keert uit voor ${p.name}`, `Je ontvangt €${pol.payout} van de duivenverzekering.`);
  return pol.payout;
}

/** A sold bird leaves her policy with the old loft. */
export function clearOwnerCare(p: Pigeon): void {
  if (!p.care) return;
  p.care.insurance = undefined;
  tidy(p);
}

// --- what a flight sees -------------------------------------------------------

export interface EntryMods {
  energyMult: number; // reismanden
  healthMult: number; // reismanden
}

/** The hokinrichting's effect on one bird's flight, frozen at the lossing. */
export function entryMods(db: Database, p: Pigeon): EntryMods {
  const loft = loftOf(db, p.ownerId);
  const s = loft ? effectScale(loft, 'baskets') : 0;
  return {
    energyMult: 1 - (1 - EQUIPMENT.baskets.energyMult) * s,
    healthMult: 1 - (1 - EQUIPMENT.baskets.healthMult) * s,
  };
}

// --- vakblad ------------------------------------------------------------------

/** Does this viewer read the vakblad? */
export function readsMagazine(db: Database, viewerId: string | undefined): boolean {
  if (!viewerId) return false;
  return !!loftOf(db, viewerId)?.equipment?.magazine;
}

/**
 * Someone else's bird, seen through the vakblad: each racing skill as a band of
 * ±EQUIPMENT.magazine.bandHalfWidth around a slightly shifted centre. The shift
 * is seeded on the bird, so the band does not wander on every refresh, and the
 * true value always lies inside it.
 */
export function magazineRanges(p: Pigeon): Record<'speed' | 'endurance' | 'orientation', [number, number]> {
  const w = EQUIPMENT.magazine.bandHalfWidth;
  const band = (attr: 'speed' | 'endurance' | 'orientation'): [number, number] => {
    const shift = (hashString(`blad:${p.id}:${attr}`) % (w + 1)) - Math.floor(w / 2); // within ±w/2
    const lo = Math.max(0, Math.round(p[attr] + shift - w));
    const hi = Math.min(100, Math.round(p[attr] + shift + w));
    return [Math.min(lo, Math.floor(p[attr])), Math.max(hi, Math.ceil(p[attr]))];
  };
  return { speed: band('speed'), endurance: band('endurance'), orientation: band('orientation') };
}

/**
 * Het marktrapport: what birds fetched per talent class over the last
 * EQUIPMENT.magazine.reportDays (from the trades the world load carries), and
 * every sale in that window.
 */
export function magazineReport(db: Database, nowMs: number) {
  const cutoff = new Date(nowMs - EQUIPMENT.magazine.reportDays * DAY).toISOString();
  const sales = db.trades.filter((t) => t.at >= cutoff && t.price > 0).sort((a, b) => (a.at < b.at ? 1 : -1));
  const classes = new Map<string, { label: string; count: number; sum: number; min: number; max: number }>();
  for (const t of sales) {
    if (typeof t.talent !== 'number') continue;
    const lo = Math.floor(t.talent / 5) * 5;
    const key = String(lo);
    const c = classes.get(key) ?? { label: `★ ${lo}–${lo + 4}`, count: 0, sum: 0, min: Infinity, max: 0 };
    c.count += 1; c.sum += t.price; c.min = Math.min(c.min, t.price); c.max = Math.max(c.max, t.price);
    classes.set(key, c);
  }
  return {
    days: EQUIPMENT.magazine.reportDays,
    classes: [...classes.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([, c]) => ({ label: c.label, count: c.count, avg: Math.round(c.sum / c.count), min: c.min, max: c.max })),
    sales: sales.map((t) => ({ pigeonName: t.pigeonName, price: t.price, at: t.at, talent: t.talent ?? null, buyerName: t.buyerName, sellerName: t.sellerName })),
  };
}

/**
 * Het Duivenblad, every Monday: the fastest bird, the biggest riser and the
 * dearest sale of the week, to every subscriber. `dayNo` is the Brussels day
 * that just started (tickDailyCare's dagovergang); stable id per reader + day.
 */
export function tickMagazine(db: Database, dayNo: number, nowMs: number): void {
  const weekday = ((dayNo % 7) + 4 + 7) % 7; // 1970-01-01 was a Thursday; 1 = Monday
  if (weekday !== 1) return;
  const readers = db.lofts.filter((l) => !l.isBot && l.equipment?.magazine);
  if (readers.length === 0) return;
  const fastest = [...db.pigeons].filter((p) => (p.seasonPeakSpeed ?? 0) > 0)
    .sort((a, b) => (b.seasonPeakSpeed ?? 0) - (a.seasonPeakSpeed ?? 0))[0];
  const score = (p: Pigeon) => (p.speed + p.endurance + p.orientation) / 3;
  const riser = [...db.pigeons].filter((p) => typeof p.seasonStartScore === 'number')
    .map((p) => ({ p, gain: score(p) - (p.seasonStartScore as number) }))
    .sort((a, b) => b.gain - a.gain)[0];
  const weekAgo = new Date(nowMs - 7 * DAY).toISOString();
  const dearest = db.trades.filter((t) => t.at >= weekAgo).sort((a, b) => b.price - a.price)[0];
  const owner = (p: Pigeon) => loftOf(db, p.ownerId)?.name ?? 'onbekend';
  const lines = [
    fastest ? `Snelste duif: ${fastest.name} (${owner(fastest)}), ${Math.round((fastest.seasonPeakSpeed ?? 0) * 60 / 1000)} km/u.` : null,
    riser && riser.gain > 0 ? `Grootste stijger: ${riser.p.name} (${owner(riser.p)}), +${round1(riser.gain)} dit seizoen.` : null,
    dearest ? `Duurste verkoop: ${dearest.pigeonName} voor €${dearest.price.toLocaleString('nl-BE')} aan ${dearest.buyerName}.` : 'Geen verkopen deze week.',
  ].filter(Boolean).join(' ');
  for (const l of readers) careNote(db, l.userId, `ntf:blad:${l.userId}:${dayNo}`, '📰 Het Duivenblad', lines);
}
