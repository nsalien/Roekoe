/** Mijn hok: all your pigeons with sorting and quick sell/withdraw actions. */

import { useState } from 'react';
import { useGame } from '../game/GameContext';
import { api } from '../api/client';
import { Money, Spinner, useToast } from '../components/ui';
import { PigeonCard } from '../components/PigeonCard';
import type { Pigeon } from '../types';

type SortKey = 'talent' | 'speed' | 'endurance' | 'orientation' | 'form' | 'ageWeeks';

export function LoftPage() {
  const { state, loading, refresh } = useGame();
  const toast = useToast();
  const [sort, setSort] = useState<SortKey>('talent');
  const [busy, setBusy] = useState(false);
  const [sellFor, setSellFor] = useState<string | null>(null);
  const [price, setPrice] = useState(0);

  if (loading || !state) return <Spinner />;
  const pigeons = [...state.pigeons].sort((a, b) => b[sort] - a[sort]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (ok) toast.show(ok, 'ok');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  function beginSell(p: Pigeon) {
    setSellFor(p.id);
    setPrice(p.value);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Mijn hok</h1>
          <p className="muted">{state.loft?.pigeonCount} duiven · capaciteit {state.loft?.capacity}</p>
        </div>
        <label className="row" style={{ gap: 8, marginBottom: 0 }}>
          <span className="faint">Sorteer</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ width: 'auto' }}>
            <option value="talent">Talent</option>
            <option value="speed">Snelheid</option>
            <option value="endurance">Conditie</option>
            <option value="orientation">Oriëntatie</option>
            <option value="form">Energie</option>
            <option value="ageWeeks">Leeftijd</option>
          </select>
        </label>
      </div>

      <div className="grid pigeons">
        {pigeons.map((p) => (
          <PigeonCard key={p.id} pigeon={p} to={`/duif/${p.id}`}>
            {sellFor === p.id ? (
              <div className="row">
                <input
                  type="number"
                  value={price}
                  min={1}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  style={{ maxWidth: 110 }}
                />
                <button
                  className="btn sm"
                  disabled={busy || price <= 0}
                  onClick={() => act(() => api('/market/list', { method: 'POST', body: { pigeonId: p.id, price } }), 'Te koop gezet').then(() => setSellFor(null))}
                >
                  Bevestig
                </button>
                <button className="btn ghost sm" onClick={() => setSellFor(null)}>Annuleer</button>
              </div>
            ) : (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="faint">Waarde <Money value={p.value} /></span>
                {p.forSale ? (
                  <button className="btn secondary sm" disabled={busy} onClick={() => act(() => api('/market/unlist', { method: 'POST', body: { pigeonId: p.id } }), 'Uit de verkoop')}>
                    Uit verkoop
                  </button>
                ) : (
                  <button className="btn ghost sm" disabled={busy} onClick={() => beginSell(p)}>Verkoop</button>
                )}
              </div>
            )}
          </PigeonCard>
        ))}
      </div>
    </div>
  );
}
