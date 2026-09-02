/** Kweek: pair a doffer and a duivin to produce young that inherit attributes. */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Money, Spinner, timeUntil, useToast } from '../components/ui';
import { PigeonAvatar } from '../components/PigeonAvatar';
import { NestChoice } from '../components/NestChoice';
import type { BreedingView } from '../types';

export function BreedingPage() {
  const { state, loading, refresh } = useGame();
  const toast = useToast();
  const [view, setView] = useState<BreedingView | null>(null);
  const [sireId, setSireId] = useState('');
  const [damId, setDamId] = useState('');
  const [busy, setBusy] = useState(false);

  const loadPairs = useCallback(async () => {
    setView(await api<BreedingView>('/breeding'));
  }, []);
  useEffect(() => {
    loadPairs();
  }, [loadPairs, state?.world.currentWeek]);

  if (loading || !state) return <Spinner />;
  const pairs = view?.pairs ?? [];
  const nests = view?.nests ?? [];
  const freeSpace = view?.freeSpace ?? 0;
  const BREED_COST = state.economy.breedCost;
  const MIN_BREED_WEEKS = 8; // BREEDING.minAgeWeeks — same age she may first race
  const eligible = (p: (typeof state.pigeons)[number]) =>
    !p.ailment && !p.inInfirmary && !p.breeding && !p.racing && !p.onCure && p.ageWeeks >= MIN_BREED_WEEKS;
  /** Resting between clutches — she is eligible in every other way, so she needs
   *  her own line below rather than silently vanishing from the list. */
  const resting = (p: (typeof state.pigeons)[number]) =>
    !!p.breedAvailableAt && Date.parse(p.breedAvailableAt) > Date.now();
  const doffers = state.pigeons.filter((p) => p.sex === 'doffer' && eligible(p) && !resting(p));
  const duivinnen = state.pigeons.filter((p) => p.sex === 'duivin' && eligible(p) && !resting(p));
  const restingBirds = state.pigeons.filter((p) => eligible(p) && resting(p));
  const nextFree = restingBirds
    .map((p) => p.breedAvailableAt!)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const sire = doffers.find((p) => p.id === sireId);
  const dam = duivinnen.find((p) => p.id === damId);
  // Are these two family? The server works it out (the client has no ancestry)
  // and sends only the related combinations — usually none.
  const kin = view?.related?.find((r) => r.sireId === sireId && r.damId === damId)?.degree ?? null;
  const KIN_LABEL: Record<string, string> = {
    'directe-lijn': 'rechtstreekse familie — ouder, kind of grootouder',
    volle: 'volle broer en zus',
    half: 'halfbroer en halfzus',
    familie: 'familie van elkaar',
  };

  async function stop(pairId: string) {
    setBusy(true);
    try {
      await api(`/breeding/${pairId}/stop`, { method: 'POST' });
      toast.show('Koppel gestopt — de duiven kunnen weer vliegen.', 'ok');
      await loadPairs();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!sireId || !damId) return;
    // A second, deliberate step for an inbred pairing: the consequence lands on a
    // bird you keep for months, so one stray click should not be enough.
    if (kin && !window.confirm(
      `${sire?.name} en ${dam?.name} zijn ${KIN_LABEL[kin] ?? 'familie'}.\n\n` +
      'Het jong krijgt lagere genetische plafonds en waarschijnlijk een afwijking. Toch koppelen?',
    )) return;
    setBusy(true);
    try {
      await api('/breeding', { method: 'POST', body: { sireId, damId } });
      toast.show('Koppel gevormd! Wanneer de jongen komen, is een verrassing. 🥚', 'ok');
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

      {/* A held clutch comes first: it blocks new pairs and the young are waiting. */}
      {nests.length > 0 && (
        <div className="stack" style={{ marginBottom: 16 }}>
          {nests.map((nest) => (
            <NestChoice key={nest.id} nest={nest} freeSpace={freeSpace} onDone={loadPairs} />
          ))}
        </div>
      )}

      <div className="grid cols-2">
        <div className="card" data-tour="breed">
          <h2>Nieuw koppel</h2>
          {/* Two sentences: what it costs and what drives the odds. The rest
              (overerving, genen, uitkomsttijd) staat in de wiki. */}
          <p className="muted" style={{ marginBottom: 4 }}>
            Kost <Money value={BREED_COST} /> + 15 energie per ouder. Hoog <strong>❤ libido</strong> en veel
            <strong> ⚡ energie</strong> = meer kans op (twee) jongen.
          </p>
          <p className="faint" style={{ margin: '0 0 12px', fontSize: '0.82rem' }}>
            <Link to="/wiki#broeden">Meer over kweken &amp; overerving →</Link>
          </p>

          {/* A bird resting between clutches is eligible in every other way, so
              without this line she would just quietly be missing from the list. */}
          {restingBirds.length > 0 && (
            <p className="muted" style={{ margin: '0 0 12px', fontSize: '0.85rem' }}>
              🪺 {restingBirds.length} {restingBirds.length === 1 ? 'duif rust' : 'duiven rusten'} uit van een vorig
              nest{nextFree ? ` (eerstvolgende ${timeUntil(nextFree)})` : ''}.
            </p>
          )}

          <div className="field">
            <label>Vader (doffer)</label>
            <select value={sireId} onChange={(e) => setSireId(e.target.value)}>
              <option value="">— kies een doffer —</option>
              {doffers.map((p) => (
                <option key={p.id} value={p.id}>{p.name} (★{p.talent} · ❤{Math.round(p.libido ?? 0)} · ⚡{Math.round(p.form ?? 0)})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Moeder (duivin)</label>
            <select value={damId} onChange={(e) => setDamId(e.target.value)}>
              <option value="">— kies een duivin —</option>
              {duivinnen.map((p) => (
                <option key={p.id} value={p.id}>{p.name} (★{p.talent} · ❤{Math.round(p.libido ?? 0)} · ⚡{Math.round(p.form ?? 0)})</option>
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

          {/* Inteelt is allowed — you are warned, not stopped. The warning has to
              be specific about the consequence, or it reads as decoration. */}
          {kin && (
            <div
              className="card"
              style={{
                boxShadow: 'none', marginBottom: 10,
                background: 'rgba(234,88,12,0.10)',
                border: '1px solid rgba(234,88,12,0.35)',
              }}
            >
              <strong>⚠️ Deze twee zijn {KIN_LABEL[kin] ?? 'familie van elkaar'}</strong>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                Kweken met familie wordt afgeraden. Het jong krijgt <strong>lagere genetische plafonds</strong> —
                daar traint ze zich nooit meer uit — en er is een grote kans dat ze met een{' '}
                <strong>afwijking</strong> geboren wordt. Je mag doorgaan, maar reken op een mindere duif.
              </p>
              <p className="faint" style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>
                <Link to="/wiki#inteelt">Meer over inteelt →</Link>
              </p>
            </div>
          )}

          {nests.length > 0 && (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Er wacht nog een nest op je keuze — beslis daar eerst over voor je opnieuw koppelt.
            </p>
          )}
          <button
            className={kin ? 'btn block danger' : 'btn block'}
            disabled={busy || !sireId || !damId || nests.length > 0}
            onClick={start}
          >
            {kin ? 'Toch koppelen' : 'Koppelen'} · <Money value={BREED_COST} />
          </button>
        </div>

        <div className="card">
          <h2>Broedsels onderweg</h2>
          {pairs.length === 0 && <p className="muted">Geen koppels aan het broeden.</p>}
          <div className="stack">
            {pairs.map((pair) => (
              <div key={pair.id} className="card" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <span>{pair.sire} × {pair.dam}</span>
                  <div className="row" style={{ gap: 8 }}>
                    <strong className="faint">🥚 aan het broeden…</strong>
                    <button className="btn ghost sm" disabled={busy} onClick={() => stop(pair.id)}>Stop</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
