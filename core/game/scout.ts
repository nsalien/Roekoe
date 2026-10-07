/**
 * Scout op buitenlandse markten (hokinrichting — ⚠️ dev, nog niet live).
 *
 * The player pays a scout's wage and picks a market and a budget, once per
 * season. How long he is away is uncertain (`returnChance`, up to the tier's
 * `maxDays`), and he may come back empty-handed (`emptyChance`). All of that —
 * the return day, whether he finds anything, and the birds themselves — is
 * rolled the moment he leaves, so no tick has to make it and two requests can
 * never disagree; the player only learns it when he is back. Then: buy one or
 * none within SCOUT.choiceHours. The wage is gone either way. A bought bird sits
 * SCOUT.quarantineDays in quarantine. Bots never take part. Everything lives on
 * Loft.equipment.scout.
 */

import { GENE, SCOUT, type ScoutMarket, type ScoutTier } from '../config/gameConfig.js';
import type { Pigeon, ScoutMission } from '../schema.js';
import type { Store } from '../store.js';
import { newId } from '../store.js';
import { debtBlock } from './economy.js';
import { equipmentOf } from './hygiene.js';
import { marketValue } from './market.js';
import { nameKey, namesInUse } from './names.js';
import { generatePigeon, talent } from './pigeon.js';
import { rollAnyTrait } from './traits.js';
import { clamp, round1 } from './util.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;

/** The chance he comes home on day `day` of the trip, given he is not back yet. */
export function returnChance(tier: ScoutTier, day: number): number {
  const max = SCOUT.tiers[tier].maxDays;
  if (day >= max) return 1;
  if (day <= 1) return SCOUT.firstDayChance;
  return SCOUT.firstDayChance + (1 - SCOUT.firstDayChance) * Math.pow((day - 1) / (max - 1), SCOUT.returnCurve);
}

/** Roll the day he comes home (1..maxDays). */
export function rollReturnDay(tier: ScoutTier, rng: () => number = Math.random): number {
  const max = SCOUT.tiers[tier].maxDays;
  for (let d = 1; d < max; d++) if (rng() < returnChance(tier, d)) return d;
  return max;
}

/** The scout's state for a loft: away, back with a report, or nothing. */
export function scoutStatus(m: ScoutMission | null | undefined, nowMs: number): 'none' | 'away' | 'report' | 'expired' {
  if (!m) return 'none';
  if (nowMs < Date.parse(m.readyAt)) return 'away';
  if (nowMs <= Date.parse(m.expiresAt)) return 'report';
  return 'expired';
}

/** Roll one bird for this market and budget. */
function scoutBird(market: ScoutMarket, tier: ScoutTier, week: number, taken: Set<string>): Pigeon {
  const m = SCOUT.markets[market];
  const t = SCOUT.tiers[tier];
  const quality = 0.5 + ((t.scoreMin + t.scoreMax) / 2 - 64) / 40; // brons ~0,6 → goud ~0,9
  const p = generatePigeon({
    ownerId: 'scout',
    currentWeek: week,
    quality: clamp(quality, 0.4, 1),
    trait: Math.random() < SCOUT.traitChance ? rollAnyTrait() : null,
    taken,
  });
  // The market's speciality: that gene cap rolls a class higher.
  if (m.boost && p.genes) p.genes[m.boost] = Math.min(GENE.ceil, p.genes[m.boost] + SCOUT.geneBoost);
  // Land the overall score inside the budget's band (+ China's bonus), within her caps.
  const target = t.scoreMin + Math.random() * (t.scoreMax - t.scoreMin) + m.scoreBonus;
  const shift = target - talent(p);
  for (const a of ['speed', 'endurance', 'orientation'] as const) {
    const cap = p.genes?.[a] ?? GENE.ceil;
    p[a] = round1(clamp(p[a] + shift + (Math.random() * 4 - 2), 5, cap));
  }
  p.experience = round1(10 + Math.random() * 20); // she has raced over there
  p.form = 70;
  p.health = 90;
  return p;
}

/** Send the scout. One mission at a time; the wage is paid now. */
export function sendScout(store: Store, userId: string, market: string, tier: string, nowMs: number = Date.now()): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Geen hok gevonden';
    if (loft.isBot) return 'Bots sturen geen scout';
    if (!(market in SCOUT.markets) || !(tier in SCOUT.tiers)) return 'Onbekende markt of budget';
    const eq = equipmentOf(loft);
    const st = scoutStatus(eq.scout, nowMs);
    if (st === 'away') return 'Je scout is nog onderweg';
    if (st === 'report') return 'Er ligt nog een scoutrapport — koop een duif of sluit het rapport eerst';
    if (eq.scoutSeason === db.world.seasonYear) return 'Je scout ging dit seizoen al op pad — volgend seizoen kan het weer';
    const debt = debtBlock(loft); if (debt) return debt;
    const t = SCOUT.tiers[tier as ScoutTier];
    if (loft.money < t.wage) return 'Niet genoeg geld voor het scoutloon';
    loft.money -= t.wage;
    const m = SCOUT.markets[market as ScoutMarket];
    const taken = namesInUse(db.pigeons);
    const offers: ScoutMission['offers'] = [];
    // Thin supply: the better the birds he is after, the likelier he finds none.
    const found = Math.random() >= t.emptyChance ? SCOUT.offers : 0;
    for (let i = 0; i < found; i++) {
      const p = scoutBird(market as ScoutMarket, tier as ScoutTier, db.world.currentWeek, taken);
      taken.add(nameKey(p.name));
      const base = marketValue(db, p, db.world.currentWeek);
      // Rounded UP to €100: an import is never cheaper than its multiplier says.
      const price = Math.max(100, Math.ceil((base * (m.priceMin + Math.random() * (m.priceMax - m.priceMin))) / 100) * 100);
      const est = (v: number) => Math.round(clamp(v + (Math.random() * 2 - 1) * SCOUT.capsEstimateNoise, GENE.floor, GENE.ceil));
      offers.push({
        pigeon: p,
        price,
        capsEstimate: {
          speed: est(p.genes?.speed ?? GENE.ceil),
          endurance: est(p.genes?.endurance ?? GENE.ceil),
          orientation: est(p.genes?.orientation ?? GENE.ceil),
        },
      });
    }
    const readyAt = nowMs + rollReturnDay(tier as ScoutTier) * DAY;
    loft.equipment = {
      ...eq,
      scoutSeason: db.world.seasonYear,
      scout: {
        market, tier,
        sentAt: new Date(nowMs).toISOString(),
        readyAt: new Date(readyAt).toISOString(),
        expiresAt: new Date(readyAt + SCOUT.choiceHours * HOUR).toISOString(),
        offers,
      },
    };
    return null;
  });
}

/** Buy bird `index` from the report. She arrives in quarantine. */
export function buyScouted(store: Store, userId: string, index: number, nowMs: number = Date.now()): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Geen hok gevonden';
    const eq = equipmentOf(loft);
    const st = scoutStatus(eq.scout, nowMs);
    if (st === 'away') return 'Je scout is nog niet terug';
    if (st !== 'report' || !eq.scout) return 'Er ligt geen geldig scoutrapport meer';
    const offer = eq.scout.offers[index];
    if (!offer) return 'Die duif staat niet in het rapport';
    const debt = debtBlock(loft); if (debt) return debt;
    const mine = db.pigeons.filter((p) => p.ownerId === userId).length;
    if (mine >= loft.capacity) return 'Je hebt een vrije plaats nodig voor een importduif';
    if (loft.money < offer.price) return 'Niet genoeg geld voor deze duif';
    loft.money -= offer.price;
    const bird: Pigeon = {
      ...offer.pigeon,
      id: newId('pig'),
      ownerId: userId,
      createdAtWeek: db.world.currentWeek,
      care: {
        origin: `Import · ${SCOUT.markets[eq.scout.market as ScoutMarket]?.label ?? 'buitenland'}`,
        quarantineUntil: new Date(nowMs + SCOUT.quarantineDays * 86400000).toISOString(),
      },
    };
    // Names are unique: if someone took hers since the scout left, add a mark.
    if (namesInUse(db.pigeons).has(nameKey(bird.name))) bird.name = `${bird.name} (import)`;
    db.pigeons.push(bird);
    loft.equipment = { ...eq, scout: null };
    return null;
  });
}

/** Close the report without buying (the wage stays spent). */
export function dismissScout(store: Store, userId: string, nowMs: number = Date.now()): string | null {
  return store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === userId);
    if (!loft) return 'Geen hok gevonden';
    const eq = equipmentOf(loft);
    if (scoutStatus(eq.scout, nowMs) === 'away') return 'Je scout is nog onderweg';
    loft.equipment = { ...eq, scout: null };
    return null;
  });
}
