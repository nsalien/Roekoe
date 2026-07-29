/** Kweek: pair a doffer and a duivin to produce young that inherit attributes. */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Money, Spinner, countdownTo, useToast } from '../components/ui';
import { PigeonAvatar } from '../components/PigeonAvatar';
import type { BreedingPair } from '../types';

const BREED_COST = 200;

export function BreedingPage() {
  const { state, loading, refresh } = useGame();
  const toast = useToast();
  const [pairs, setPairs] = useState<BreedingPair[]>([]);
  const [sireId, setSireId] = useState('');
  const [damId, setDamId] = useState('');
  const [busy, setBusy] = useState(false);

  const loadPairs = useCallback(async () => {
    const res = await api<{ pairs: BreedingPair[] }>('/breeding');
    setPairs(res.pairs);
  }, []);
  useEffect(() => {
    loadPairs();
  }, [loadPairs, state?.world.currentWeek]);

  if (loading || !state) return <Spinner />;
  const doffers = state.pigeons.filter((p) => p.sex === 'doffer');
  const duivinnen = state.pigeons.filter((p) => p.sex === 'duivin');
  const sire = doffers.find((p) => p.id === sireId);
  const dam = duivinnen.find((p) => p.id === damId);

  async function start() {
    if (!sireId || !damId) return;
    setBusy(true);
    try {
      await api('/breeding', { method: 'POST', body: { sireId, damId } });
      toast.show('Koppel gevormd! De jongen komen over enkele dagen. 🥚', 'ok');
      setSireId('');
      setDamId('');
      await loadPairs();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Kweek</h1>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Nieuw koppel</h2>
          <p className="muted">
            Kost <Money value={BREED_COST} />. De jongen erven het gemiddelde van beide ouders, met wat variatie —
            koppel je besten voor de sterkste nakomelingen. Een hoog <strong>❤ libido</strong> en voldoende
            <strong> ⚡ energie</strong> vergroten de kans op (meer) jongen; te weinig energie levert soms niets op.
          </p>

          <div className="field">
            <label>Vader (doffer)</label>
            <select value={sireId} onChange={(e) => setSireId(e.target.value)}>
              <option value="">— kies een doffer —</option>
              {doffers.map((p) => (
                <option key={p.id} value={p.id}>{p.name} (★{p.talent} · ❤{Math.round(p.libido)} · ⚡{Math.round(p.form)})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Moeder (duivin)</label>
            <select value={damId} onChange={(e) => setDamId(e.target.value)}>
              <option value="">— kies een duivin —</option>
              {duivinnen.map((p) => (
                <option key={p.id} value={p.id}>{p.name} (★{p.talent} · ❤{Math.round(p.libido)} · ⚡{Math.round(p.form)})</option>
              ))}
            </select>
          </div>

          {sire && dam && (
            <div className="row" style={{ justifyContent: 'center', gap: 4, margin: '4px 0 12px' }}>
              <PigeonAvatar pigeon={sire} size={54} />
              <span style={{ fontSize: '1.4rem' }}>💕</span>
              <PigeonAvatar pigeon={dam} size={54} />
              <span className="faint" style={{ marginLeft: 8 }}>
                verwacht talent ≈ {Math.round((sire.talent + dam.talent) / 2)}
              </span>
            </div>
          )}

          <button className="btn block" disabled={busy || !sireId || !damId} onClick={start}>
            Koppelen · <Money value={BREED_COST} />
          </button>
        </div>

        <div className="card">
          <h2>Broedsels onderweg</h2>
          {pairs.length === 0 && <p className="muted">Geen koppels aan het broeden.</p>}
          <div className="stack">
            {pairs.map((pair) => (
              <div key={pair.id} className="card" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{pair.sire} × {pair.dam}</span>
                  <strong>{Date.parse(pair.hatchAt) <= Date.now() ? 'komt eraan…' : countdownTo(pair.hatchAt)}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
