/**
 * "Have I already seen what is on the market?" — the state behind the dot on
 * the Markt nav button.
 *
 * The server says WHEN a bird was last put up for sale (`world.marketNewsAt`,
 * one timestamp on a row every request loads anyway — see core/schema.ts for
 * why it cannot be a per-player count). This side remembers up to when THIS
 * player has looked, in localStorage, exactly like the tour and the ceremony do:
 * it is a per-browser convenience, not game state, so it has no business costing
 * a database write on a free plan.
 *
 * Stored as epoch milliseconds under `roekoe.marketSeen.<userId>`.
 *
 * ⚠️ Deliberately React-free (like components/geo.ts) so `market-news.test.mts`
 * can drive these rules directly. The hook that subscribes to them lives in
 * Layout.tsx.
 */

/** Fired after `markMarketSeen`; localStorage re-renders nothing by itself. */
export const MARKET_SEEN_EVENT = 'roekoe:market-seen';

function key(userId: string): string {
  return `roekoe.marketSeen.${userId}`;
}

/** When this player last looked at the market (epoch ms, 0 = never). */
export function marketSeenAt(userId: string | null | undefined): number {
  if (!userId) return 0;
  try {
    const raw = Number(localStorage.getItem(key(userId)) ?? '0');
    return Number.isFinite(raw) ? raw : 0;
  } catch {
    // Private mode / site data blocked: behave as "never looked". Worst case the
    // dot stays put, which is a nag and not a broken page.
    return 0;
  }
}

/** Newest of a bunch of ISO timestamps, in epoch ms. Unparseable ones are skipped. */
function newest(times: (string | null | undefined)[]): number {
  let max = 0;
  for (const t of times) {
    if (!t) continue;
    const ms = Date.parse(t);
    if (Number.isFinite(ms) && ms > max) max = ms;
  }
  return max;
}

/**
 * Mark everything up to `times` as seen. Called when the market page has
 * actually rendered its listings.
 *
 * Pass what the player is looking at (the listings' `listedAt`, the auctions'
 * `startAt`) *and* `world.marketNewsAt`: the /market response can be a moment
 * ahead of the /state poll the badge reads, and without the birds on screen the
 * dot would linger over something already looked at.
 *
 * Never moves backwards — a stale render cannot un-see a newer visit.
 */
export function markMarketSeen(userId: string | null | undefined, times: (string | null | undefined)[]): void {
  if (!userId) return;
  const at = Math.max(newest(times), marketSeenAt(userId));
  try {
    localStorage.setItem(key(userId), String(at));
  } catch {
    /* private mode */
  }
  // The nav lives in another component, so tell it explicitly. Same trick as
  // the profile page's 'roekoe:start-tour'.
  window.dispatchEvent(new Event(MARKET_SEEN_EVENT));
}

/**
 * Is there a bird on the market this player has not seen yet?
 *
 * The seller is exempt from his own listing — he does not need a badge telling
 * him about the bird he just put up. Known limit: because only the LATEST
 * offering is kept, his own listing masks one from another player that he had
 * not looked at yet. Listings are rare enough that this is a missed nudge at
 * worst, and the bird is still right there on the market page.
 */
export function hasMarketNews(
  marketNewsAt: string | null | undefined,
  marketNewsBy: string | null | undefined,
  userId: string | null | undefined,
  seenAt: number,
): boolean {
  if (!marketNewsAt) return false;
  // No player yet (the auth check is still in flight): `seenAt` is 0 for nobody,
  // so without this every first paint would flash a dot.
  if (!userId) return false;
  if (marketNewsBy === userId) return false;
  const ms = Date.parse(marketNewsAt);
  return Number.isFinite(ms) && ms > seenAt;
}
