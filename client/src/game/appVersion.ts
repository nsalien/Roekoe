/**
 * Is this tab running the code that is live right now?
 *
 * A tab or home-screen app left open keeps the JavaScript it was opened with, and
 * the server moves on underneath it. That is how a phone open since before the
 * leagues (24 okt) still offered EVERY bird for a league flight: its old picker
 * only knew the leeftijdscriterium (`f.ageCat`), and a league flight has none.
 * The server refused the wrong bird, but the list was wrong.
 *
 * Every build writes its id into the bundle (`__APP_BUILD__`) and into a static
 * `/version.json` (the `buildVersion` plugin in vite.config.ts). Comparing the two
 * costs one static file — no Worker, no D1. React-free on purpose, like
 * marketSeen.ts.
 */

declare const __APP_BUILD__: string;

/** The build this tab is running ('' outside a Vite build, e.g. in tests). */
export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : '';

/** The build that is live now, or null when it cannot be told (offline, dev server, 404). */
export async function liveBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { build?: unknown };
    return typeof json.build === 'string' && json.build ? json.build : null;
  } catch {
    return null;
  }
}

const RELOADED_KEY = 'roekoe.reloadedFor';

/**
 * Reload into `build`, unless this tab already tried that a minute ago — a CDN
 * that briefly serves the old page next to the new version.json must not turn
 * into a reload loop. Returns false when it did not reload.
 */
export function reloadInto(build: string): boolean {
  try {
    const raw = sessionStorage.getItem(RELOADED_KEY);
    const last = raw ? (JSON.parse(raw) as { build: string; at: number }) : null;
    if (last && last.build === build && Date.now() - last.at < 60_000) return false;
    sessionStorage.setItem(RELOADED_KEY, JSON.stringify({ build, at: Date.now() }));
  } catch {
    // No sessionStorage (private mode): reload anyway, a loop needs it to persist.
  }
  window.location.reload();
  return true;
}
