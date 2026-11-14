/**
 * Shared game state. Loads /state once, exposes it to every page and offers a
 * `refresh()` used after any action that changes the world.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { GameState } from '../types';

interface GameContextValue {
  state: GameState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Refresh, but only if the state on screen is older than `maxAgeMs`. */
  refreshIfStale: (maxAgeMs: number) => void;
}

/**
 * How old the state may get before coming back to the tab, or moving to another
 * page, fetches it again. `/state` was only loaded at login and after your own
 * actions, so an app reopened the next morning showed yesterday's kassa, energie,
 * bell and calendar until you did something. One narrow load (the cheap one) per
 * minute at most — never a timer, so an idle or hidden tab still costs nothing.
 */
export const STATE_MAX_AGE_MS = 60_000;

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * One `/state` call at a time. Pages routinely fire their own `load()` and a
   * `refresh()` for the same action, and several components share this context,
   * so the same instant could ask for the world two or three times over. Every
   * one of those is a full world load (~300 D1 rows) against a budget shared by
   * all players, so callers that arrive while a fetch is in flight now wait for
   * that one instead of starting another.
   */
  const inFlight = useRef<Promise<void> | null>(null);
  const lastLoaded = useRef(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const s = await api<GameState>('/state');
        setState(s);
        setError(null);
        lastLoaded.current = Date.now();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Kon spelstatus niet laden');
      } finally {
        setLoading(false);
      }
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, [user]);

  useEffect(() => {
    if (user) {
      setLoading(true);
      refresh();
    } else {
      setState(null);
    }
  }, [user, refresh]);

  const refreshIfStale = useCallback((maxAgeMs: number) => {
    if (!user || lastLoaded.current === 0) return; // not loaded yet: the first load is on its way
    if (Date.now() - lastLoaded.current >= maxAgeMs) void refresh();
  }, [user, refresh]);

  // Back on the tab (the phone app resumed, the browser tab focused again).
  useEffect(() => {
    if (!user) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshIfStale(STATE_MAX_AGE_MS);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user, refreshIfStale]);

  return (
    <GameContext.Provider value={{ state, loading, error, refresh, refreshIfStale }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame buiten GameProvider gebruikt');
  return ctx;
}
