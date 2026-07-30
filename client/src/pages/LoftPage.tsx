/** Mijn hok: all your pigeons with sorting and quick sell/withdraw actions. */

import { useState } from 'react';
import { useGame } from '../game/GameContext';
import { api } from '../api/client';
import { Money, Spinner, useToast } from '../components/ui';
import { PigeonCard } from '../components/PigeonCard';
import type { FeedRation, Loft, Pigeon } from '../types';

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

      {state.loft && <LoftUpgrades loft={state.loft} busy={busy} act={act} />}

      <div className="grid pigeons">
        {pigeons.map((p) => (
          <PigeonCard key={p.id} pigeon={p} to={`/duif/${p.id}`}>
            {/* Per-pigeon feeding + private compartment */}
            <div className="row" style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <select
                value={p.ration}
                disabled={busy}
                title="Voerschema van deze duif"
                onChange={(e) => act(() => api(`/pigeons/${p.id}/ration`, { method: 'POST', body: { ration: e.target.value } }))}
                style={{ flex: 1, minWidth: 90, width: 'auto' }}
              >
                {(Object.keys(state.feedRations) as FeedRation[]).map((k) => (
                  <option key={k} value={k}>🍽 {state.feedRations[k].label}</option>
                ))}
              </select>
              <button
                className={`btn sm ${p.compartment ? 'accent' : 'ghost'}`}
                disabled={busy || (!p.compartment && (state.loft?.compartmentsUsed ?? 0) >= (state.loft?.compartments ?? 0))}
                title={p.compartment ? 'Zit in een apart hok' : 'Zit samen met de anderen'}
                onClick={() => act(() => api(`/pigeons/${p.id}/compartment`, { method: 'POST', body: { on: !p.compartment } }))}
              >
                🧱 {p.compartment ? 'Apart' : 'Samen'}
              </button>
            </div>
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

function LoftUpgrades({
  loft,
  busy,
  act,
}: {
  loft: Loft;
  busy: boolean;
  act: (fn: () => Promise<unknown>, ok?: string) => void;
}) {
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h2 style={{ marginTop: 0 }}>🏗️ Uitbreidingen</h2>
      <div className="grid cols-2">
        {/* Capacity */}
        <div>
          <strong>🏠 Hokcapaciteit</strong>
          <div className="faint" style={{ margin: '2px 0 8px' }}>
            Nu plaats voor <strong>{loft.capacity}</strong> duiven.
          </div>
          {loft.nextCapacity ? (
            <button
              className="btn accent sm"
              disabled={busy || loft.money < loft.nextCapacity.price}
              onClick={() => act(() => api('/loft/capacity', { method: 'POST' }), 'Hok uitgebreid! 🏠')}
            >
              Naar {loft.nextCapacity.capacity} · <Money value={loft.nextCapacity.price} />
            </button>
          ) : (
            <div className="faint">Maximale capaciteit bereikt.</div>
          )}
        </div>

        {/* Compartments */}
        <div>
          <strong>🧱 Aparte hokken</strong>
          <div className="faint" style={{ margin: '2px 0 8px' }}>
            {loft.compartmentsUsed}/{loft.compartments} in gebruik. Kies per duif hieronder wie apart zit — beter energieherstel en minder ziekte.
          </div>
          {loft.compartmentCost != null ? (
            <button
              className="btn sm"
              disabled={busy || loft.money < loft.compartmentCost}
              onClick={() => act(() => api('/loft/compartment', { method: 'POST' }), 'Apart hok gebouwd! 🧱')}
            >
              Bijbouwen · <Money value={loft.compartmentCost} />
            </button>
          ) : (
            <div className="faint">Elke plaats heeft al een apart hok.</div>
          )}
        </div>
      </div>
    </div>
  );
}
