/**
 * "Have I already seen what is on offer under Samen kweken?" — the state behind
 * the dot on the Kweek nav button (and on the Samen kweken tab).
 *
 * The market's dot (marketSeen.ts), for the breeding offers: the server says WHEN
 * a bird was last put up to breed or an offer's terms changed (`world.studNewsAt`,
 * by `world.studNewsBy`); this side remembers up to when THIS player has looked,
 * in localStorage — a per-browser convenience, not game state.
 *
 * Stored as epoch milliseconds under `roekoe.studSeen.<userId>`.
 *
 * ⚠️ React-free on purpose, so `stud-news.test.mts` can drive these rules directly.
 */

/** Fired after `markStudSeen`; localStorage re-renders nothing by itself. */
export const STUD_SEEN_EVENT = 'roekoe:stud-seen';

function key(userId: string): string {
  return `roekoe.studSeen.${userId}`;
}

/** When this player last looked at the breeding offers (epoch ms, 0 = never). */
export function studSeenAt(userId: string | null | undefined): number {
  if (!userId) return 0;
  try {
    const raw = Number(localStorage.getItem(key(userId)) ?? '0');
    return Number.isFinite(raw) ? raw : 0;
  } catch {
    return 0; // private mode: the dot may linger, the page still works
  }
}

/**
 * Mark everything up to the newest of `times` as seen — called when the Samen
 * kweken tab has rendered its offers, with the `newsAt` of that same response
 * (and whatever /state said). Never moves backwards.
 */
export function markStudSeen(userId: string | null | undefined, times: (string | null | undefined)[]): void {
  if (!userId) return;
  let at = studSeenAt(userId);
  for (const t of times) {
    const ms = t ? Date.parse(t) : NaN;
    if (Number.isFinite(ms) && ms > at) at = ms;
  }
  try {
    localStorage.setItem(key(userId), String(at));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(STUD_SEEN_EVENT));
}

/**
 * Is there a breeding offer (new, or with changed terms) this player has not
 * seen yet? Whoever put it up is not nagged about their own offer. Like the
 * market, only the LATEST change is kept, which is all the dot needs.
 */
export function hasStudNews(
  studNewsAt: string | null | undefined,
  studNewsBy: string | null | undefined,
  userId: string | null | undefined,
  seenAt: number,
): boolean {
  if (!studNewsAt || !userId) return false;
  if (studNewsBy === userId) return false;
  const ms = Date.parse(studNewsAt);
  return Number.isFinite(ms) && ms > seenAt;
}
