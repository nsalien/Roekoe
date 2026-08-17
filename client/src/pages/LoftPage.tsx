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
  const pigeons = [...state.pigeons].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));

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

      {state.loft && (
        <LoftUpgrades loft={state.loft} busy={busy} act={act} upkeepBands={state.economy.upkeepBands ?? []} />
      )}

      <div className="grid pigeons">
        {pigeons.map((p, idx) => (
          <PigeonCard key={p.id} pigeon={p} to={`/duif/${p.id}`} tourId={idx === 0 ? 'pigeon' : undefined}>
            {/* Per-pigeon feeding + private compartment */}
            <div className="row" style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <select
                value={p.ration}
                disabled={busy}
                data-tour={idx === 0 ? 'ration' : undefined}
                title="Voerschema van deze duif"
                onChange={(e) => act(() => api(`/pigeons/${p.id}/ration`, { method: 'POST', body: { ration: e.target.value } }))}
                style={{ flex: 1, minWidth: 90, width: 'auto', ...((state.loft?.food[p.ration] ?? 0) <= 0 ? { borderColor: 'var(--bad)', color: 'var(--bad)' } : {}) }}
              >
                {(Object.keys(state.feedRations) as FeedRation[]).map((k) => {
                  const kg = state.loft?.food[k] ?? 0;
                  return (
                    <option key={k} value={k}>
                      {kg <= 0 ? '⚠️' : '🍽'} {state.feedRations[k].label} ({Math.round(kg)} kg)
                    </option>
                  );
                })}
              </select>
              {(state.loft?.food[p.ration] ?? 0) <= 0 && (
                <span className="faint" style={{ color: 'var(--bad)', fontSize: '0.78rem', width: '100%' }}>
                  ⚠️ Geen voorraad {state.feedRations[p.ration].label.toLowerCase()} — koop bij op het dashboard.
                </span>
              )}
              {!p.inInfirmary ? (
                <button
                  className={`btn sm ${p.compartment ? 'accent' : 'ghost'}`}
                  data-tour={idx === 0 ? 'compartment' : undefined}
                  disabled={busy || (!p.compartment && (state.loft?.compartmentsUsed ?? 0) >= (state.loft?.compartments ?? 0))}
                  title={p.compartment ? 'Zit in een apart hok' : 'Zit samen met de anderen'}
                  onClick={() => act(() => api(`/pigeons/${p.id}/compartment`, { method: 'POST', body: { on: !p.compartment } }))}
                >
                  🧱 {p.compartment ? 'Apart' : 'Samen'}
                </button>
              ) : (
                <span
                  className="badge"
                  title="Deze duif rust in de ziekenboeg; haar hokplek (apart/samen) geldt zolang niet."
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand-ink)', alignSelf: 'center' }}
                >
                  🏥 Ziekenboeg
                </span>
              )}
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
  upkeepBands,
}: {
  loft: Loft;
  busy: boolean;
  act: (fn: () => Promise<unknown>, ok?: string) => void;
  upkeepBands: { upTo: number; perPigeon: number }[];
}) {
  return (
    <div className="card" style={{ marginBottom: 18 }} data-tour="upgrades">
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
          {/* Upkeep rises per band — show it BEFORE the upgrade is bought, so a
              bigger loft is never a hidden recurring cost. */}
          {upkeepBands.length > 1 && (
            <div className="faint" style={{ marginTop: 8, fontSize: '0.8rem', lineHeight: 1.5 }}>
              Onderhoud per duif stijgt met de grootte van je hok:{' '}
              {upkeepBands.map((b, i) => {
                const from = i === 0 ? 1 : upkeepBands[i - 1].upTo + 1;
                const mine = loft.pigeonCount >= from;
                return (
                  <span key={b.upTo}>
                    {i > 0 && ' · '}
                    <strong style={mine ? { color: 'var(--text)' } : undefined}>
                      duif {from}–{b.upTo}
                    </strong>{' '}
                    €{b.perPigeon}/dag
                  </span>
                );
              })}
              .
            </div>
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
