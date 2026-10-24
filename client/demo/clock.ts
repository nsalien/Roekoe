/**
 * The demo clock. "Tijd vooruitzetten" shifts `Date.now()` and `new Date()` for
 * the whole page, so the engine (which runs in this same page) and the UI's
 * countdowns agree on what time it is. The offset survives a reload.
 *
 * Only the demo bundle installs this; a production build never contains it.
 */

const OFFSET_KEY = 'roekoe.demo.clockOffset';
const RealDate = Date;
let offsetMs = 0;

function readOffset(): number {
  try {
    const n = Number(localStorage.getItem(OFFSET_KEY) ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function installDemoClock(): void {
  offsetMs = readOffset();
  class DemoDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) super(RealDate.now() + offsetMs);
      else super(...(args as [any]));
    }
    static now(): number {
      return RealDate.now() + offsetMs;
    }
  }
  (globalThis as any).Date = DemoDate;
}

export function clockOffset(): number {
  return offsetMs;
}

export function advanceClock(ms: number): void {
  offsetMs += ms;
  try {
    localStorage.setItem(OFFSET_KEY, String(offsetMs));
  } catch {
    /* private mode: the jump still holds until the page reloads */
  }
}

export function resetClock(): void {
  offsetMs = 0;
  try {
    localStorage.removeItem(OFFSET_KEY);
  } catch {
    /* nothing stored */
  }
}
