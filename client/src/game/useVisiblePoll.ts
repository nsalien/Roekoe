/**
 * `setInterval` that only runs while the tab is actually being looked at.
 *
 * Every poll in this app costs a FULL world load (~300 D1 rows) against a
 * free-plan budget of 5M rows a day — and that budget is shared by every player,
 * which works out at roughly 17k requests a day for everyone together. A
 * forgotten background tab used to keep spending it all night for nobody: one
 * live board left open is ~1.4k requests a day, so a handful of stale tabs is
 * the entire budget, after which every route 503s (login included).
 *
 * So: a hidden tab polls not at all, and pays its catch-up fetch once, when the
 * player actually comes back.
 */

import { useEffect, useRef } from 'react';

export function useVisiblePoll(fn: () => void, intervalMs: number, enabled = true): void {
  // Keep the newest callback without restarting the timer on every render.
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  }, [fn]);

  const lastRun = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;

    const run = () => {
      lastRun.current = Date.now();
      saved.current();
    };
    const start = () => {
      if (timer === undefined) timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        stop();
        return;
      }
      // Catch up on what was missed while away — but only if a whole interval
      // has actually gone by, so flicking between tabs can't turn into a burst.
      if (Date.now() - lastRun.current >= intervalMs) run();
      start();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}
