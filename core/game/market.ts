/**
 * What is a pigeon worth? Ask the market.
 *
 * `estimateValue` (pigeon.ts) is a *model*: talent, genes, age and experience run
 * through a fixed curve. Any fixed curve is a guess, and ours guessed badly at the
 * top — birds the model priced at €2.300 changed hands for €7.000, because a bird
 * that wins races earns that back in weeks while a mediocre one never earns a cent.
 *
 * So the market sets the **level** and the model only keeps the **order**:
 *
 *  1. Every completed sale (market, private offer, auction hammer) records the
 *     bird's talent next to its price.
 *  2. Each sale yields a *factor*: what players paid divided by what the reference
 *     curve says a bird of that talent is worth. Sell a talent-70 bird for €7.000
 *     where the curve said €2.200 and the factor is ~3.
 *  3. Those factors are averaged per talent band — weighted by how close the sale
 *     is in talent (`talentSigma`) and how recent it is (`halfLifeDays`) — giving a
 *     price curve that genuinely drifts week to week with what people pay.
 *  4. How far the market overrules the model (the *trust*) depends on how much
 *     comparable evidence there is — NOT on its age. It used to: a sale's weight
 *     halved every 10 days in the trust too, so a record price slid back towards
 *     the model day after day while nothing cheaper sold (a score-80 bird went from
 *     €20.000 to €12.000 in about a week). Now a price holds until a newer sale says
 *     otherwise; a sale only fades out over the last `fadeDays` of its window.
 *
 * Why factors instead of the sale prices themselves: with ten players there will
 * never be sales in every talent band. Blending straight to observed prices made a
 * talent-85 bird come out *cheaper* than a talent-70 one that happened to sell high.
 * Scaling the curve keeps prices comparable across bands.
 *
 * And because sparse data can still dent the curve locally, the finished curve is
 * made **monotone** (a cumulative maximum): a better bird is never worth less than a
 * worse one, whatever the sales happen to say.
 *
 * With no sales at all you get the model unchanged, so this is safe on day one and
 * self-correcting from the first sale onwards.
 */

import type { Database, Pigeon } from '../schema.js';
import { MARKET_VALUATION } from '../config/gameConfig.js';
import { estimateValue, talent } from './pigeon.js';
import { clamp } from './util.js';

/** Talent grid the curve is sampled on (0..100 inclusive, step 2). */
const STEP = 2;
const GRID = Array.from({ length: 51 }, (_, i) => i * STEP);

export interface MarketValuation {
  /** The number to show the player. */
  value: number;
  /** What the fixed model alone would have said. */
  modelValue: number;
  /** Weighted mean price of comparable recent sales (null when there are none). */
  marketValue: number | null;
  /** The market's price level versus the reference curve (1 = the curve was right). */
  factor: number;
  /** How much the market overruled the model, 0..maxTrust. */
  trust: number;
  /** How many sales carried any weight for this bird. */
  sampleSize: number;
}

/**
 * The reference curve: what the model says a bird of this talent is worth with
 * everything else neutral. Sales are measured against this, so a factor means "the
 * market pays N× the curve" regardless of the sold bird's age or experience.
 */
function reference(t: number): number {
  return Math.max(50, Math.pow(Math.max(t, 1) / 50, 2.2) * 800);
}

interface MarketCurve {
  /** `reference(t) × market multiplier`, made non-decreasing. Indexed by GRID. */
  scaled: number[];
  /** Diagnostics per grid point, for the "how was this derived" line in the UI. */
  factor: number[];
  trust: number[];
  samples: number[];
  price: (number | null)[];
}

/**
 * Built at most once per request: the `Database` object only lives for one request,
 * so keying the cache on it gives us per-request memoisation for free. Matters
 * because the state DTO values ~200 birds and the Workers CPU budget is 10 ms.
 *
 * The trade count is part of the key: a request that CLOSES an auction appends a
 * sale and then values birds, and it would be a nasty little trap if that fresh
 * sale were invisible until the next request.
 */
const curveCache = new WeakMap<Database, { curve: MarketCurve; trades: number }>();

function buildCurve(db: Database, nowMs: number): MarketCurve {
  const { talentSigma, halfLifeDays, observationDays, fadeDays, trustWeight, maxTrust, minFactor, maxFactor } =
    MARKET_VALUATION;

  // Collect usable observations once.
  const obs: { talent: number; price: number; recency: number; presence: number }[] = [];
  for (const trade of db.trades) {
    if (typeof trade.talent !== 'number' || trade.price <= 0) continue; // pre-market-data sale
    const atMs = Date.parse(trade.at);
    if (Number.isNaN(atMs)) continue;
    const ageDays = (nowMs - atMs) / 86400000;
    if (ageDays < 0 || ageDays > observationDays) continue;
    obs.push({
      talent: trade.talent,
      price: trade.price,
      // Which sales set the price LEVEL: the newest weigh most.
      recency: Math.pow(0.5, ageDays / halfLifeDays),
      // How much a sale counts as evidence: fully, until it nears the end of the window.
      presence: clamp((observationDays - ageDays) / fadeDays, 0, 1),
    });
  }

  const scaled: number[] = [];
  const factor: number[] = [];
  const trustArr: number[] = [];
  const samples: number[] = [];
  const price: (number | null)[] = [];

  for (const t of GRID) {
    let evidence = 0;
    let weightSum = 0;
    let weightedFactor = 0;
    let weightedPrice = 0;
    let n = 0;
    for (const o of obs) {
      const dt = o.talent - t;
      const similarity = Math.exp(-(dt * dt) / (2 * talentSigma * talentSigma));
      if (similarity < 0.02) continue; // too far off in talent to say anything here
      const e = similarity * o.presence;
      if (e <= 0) continue;
      const w = e * o.recency;
      evidence += e;
      weightSum += w;
      weightedFactor += w * (o.price / reference(o.talent));
      weightedPrice += w * o.price;
      n += 1;
    }
    const f = weightSum > 0 ? clamp(weightedFactor / weightSum, minFactor, maxFactor) : 1;
    // Trust from the evidence alone: without a newer sale, a price stays put.
    const tr = clamp(evidence / trustWeight, 0, maxTrust);
    factor.push(f);
    trustArr.push(tr);
    samples.push(n);
    price.push(weightSum > 0 ? Math.round(weightedPrice / weightSum) : null);
    // Blend the factor towards 1 by however much we trust the data here.
    scaled.push(reference(t) * (1 - tr + tr * f));
  }

  // Monotone repair: a better bird must never be worth less than a worse one, even
  // if the only sale in a band happened to be a bargain.
  for (let i = 1; i < scaled.length; i++) scaled[i] = Math.max(scaled[i], scaled[i - 1]);

  return { scaled, factor, trust: trustArr, samples, price };
}

function curveFor(db: Database, nowMs: number): MarketCurve {
  const hit = curveCache.get(db);
  if (hit && hit.trades === db.trades.length) return hit.curve;
  const curve = buildCurve(db, nowMs);
  curveCache.set(db, { curve, trades: db.trades.length });
  return curve;
}

/** Price a bird off recent comparable sales. */
export function valuePigeon(db: Database, pigeon: Pigeon, currentWeek: number, nowMs = Date.now()): MarketValuation {
  const modelValue = estimateValue(pigeon, currentWeek);
  const t = clamp(talent(pigeon), 0, 100);
  const curve = curveFor(db, nowMs);

  // Interpolate on the grid, then rescale: the bird keeps its own age/genes/
  // experience factors (they are baked into modelValue) while the market decides
  // what its talent band is worth.
  const pos = clamp(t / STEP, 0, GRID.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, GRID.length - 1);
  const frac = pos - lo;
  const at = (arr: number[]) => arr[lo] + (arr[hi] - arr[lo]) * frac;

  const scaled = at(curve.scaled);
  const value = (modelValue / reference(t)) * scaled;
  const idx = frac < 0.5 ? lo : hi;
  return {
    value: Math.max(50, Math.round(value / 10) * 10),
    modelValue,
    marketValue: curve.price[idx],
    factor: curve.factor[idx],
    trust: curve.trust[idx],
    sampleSize: curve.samples[idx],
  };
}

/** Just the number, for the many call sites that don't care how it was derived. */
export function marketValue(db: Database, pigeon: Pigeon, currentWeek: number): number {
  return valuePigeon(db, pigeon, currentWeek).value;
}

/**
 * Note that a fresh bird is on offer, so the Markt nav button can show a dot
 * until the player has actually looked (see `World.marketNewsAt` in schema.ts).
 *
 * `byUserId` is the seller, so his own listing does not nag him; leave it empty
 * for the auction house. Writes two short strings on a row that every request
 * loads anyway — no extra query, no extra row.
 *
 * ⚠️ Only call this when a bird is *genuinely* newly on offer. Calling it on a
 * tick that runs every request would stamp the world row on every poll, which is
 * the write leak `idle-writes.test.mts` exists to catch (§503-fix ronde 4).
 */
export function noteMarketNews(db: Database, byUserId = '', nowMs = Date.now()): void {
  db.world.marketNewsAt = new Date(nowMs).toISOString();
  db.world.marketNewsBy = byUserId;
}
