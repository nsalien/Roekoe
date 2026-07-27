/**
 * Shared game state. Loads /state once, exposes it to every page and offers a
 * `refresh()` used after any action that changes the world.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { GameState } from '../types';

interface GameContextValue {
  state: GameState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const s = await api<GameState>('/state');
      setState(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kon spelstatus niet laden');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      setLoading(true);
      refresh();
    } else {
      setState(null);
    }
  }, [user, refresh]);

  return (
    <GameContext.Provider value={{ state, loading, error, refresh }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame buiten GameProvider gebruikt');
  return ctx;
}
