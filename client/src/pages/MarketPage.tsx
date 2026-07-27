/** Duivenmarkt: browse and buy pigeons listed by the NPC market or other players. */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Money, Spinner, useToast } from '../components/ui';
import { PigeonCard } from '../components/PigeonCard';
import type { Pigeon } from '../types';

export function MarketPage() {
  const { state, refresh } = useGame();
  const toast = useToast();
  const [listings, setListings] = useState<Pigeon[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'npc' | 'players'>('all');

  const load = useCallback(async () => {
    const res = await api<{ listings: Pigeon[] }>('/market');
    setListings(res.listings);
  }, []);
  useEffect(() => {
    load();
  }, [load, state?.world.currentWeek]);

  async function buy(p: Pigeon) {
    setBusy(true);
    try {
      await api('/market/buy', { method: 'POST', body: { pigeonId: p.id } });
      toast.show(`${p.name} gekocht! 🕊️`, 'ok');
      await load();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  if (!listings) return <Spinner />;
  const money = state?.loft?.money ?? 0;
  const shown = listings.filter((p) =>
    filter === 'all' ? true : filter === 'npc' ? p.fromNpc : !p.fromNpc,
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Duivenmarkt</h1>
          <p className="muted">Koop nieuwe kampioenen. Jouw kassa: <Money value={money} /></p>
        </div>
        <div className="pill-tabs">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Alles</button>
          <button className={filter === 'npc' ? 'active' : ''} onClick={() => setFilter('npc')}>Markt</button>
          <button className={filter === 'players' ? 'active' : ''} onClick={() => setFilter('players')}>Spelers</button>
        </div>
      </div>

      {shown.length === 0 && <div className="card muted">Geen duiven te koop op dit moment.</div>}

      <div className="grid pigeons">
        {shown.map((p) => (
          <PigeonCard key={p.id} pigeon={p} showOwner={!p.fromNpc}>
            <button
              className="btn accent block"
              disabled={busy || money < (p.price ?? 0)}
              onClick={() => buy(p)}
            >
              Koop · <Money value={p.price ?? 0} />
            </button>
          </PigeonCard>
        ))}
      </div>
    </div>
  );
}
