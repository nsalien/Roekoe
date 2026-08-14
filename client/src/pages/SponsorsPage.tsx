/** Sponsors: companies only make an offer once your loft has earned their
 * interest. Accept or refuse offers; hold at most one sponsor per category
 * (a competitor costs a break penalty to switch). */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Money, Spinner, useToast } from '../components/ui';
import type { Sponsor, SponsorView } from '../types';

export function SponsorsPage() {
  const { refresh } = useGame();
  const toast = useToast();
  const [view, setView] = useState<SponsorView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setView(await api<SponsorView>('/sponsors'));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<{ result?: string }>) {
    setBusy(true);
    try {
      const res = await fn();
      toast.show(res.result || 'Gelukt', 'ok');
      await load();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  function accept(s: Sponsor) {
    if (s.conflictWith) {
      const ok = window.confirm(
        `Je hebt al ${s.conflictWith} in de categorie ${s.categoryLabel}. Overstappen naar ${s.name} kost een verbrekingsvergoeding van €${s.conflictPenalty}. Doorgaan?`,
      );
      if (!ok) return;
      return run(() => api('/sponsors/accept', { method: 'POST', body: { sponsorId: s.id, replace: true } }));
    }
    return run(() => api('/sponsors/accept', { method: 'POST', body: { sponsorId: s.id } }));
  }

  function refuse(s: Sponsor) {
    return run(() => api('/sponsors/refuse', { method: 'POST', body: { sponsorId: s.id } }));
  }

  function cancel(s: Sponsor) {
    if (!window.confirm(`Contract met ${s.name} opzeggen? Dat kost een verbrekingsvergoeding van €${s.breakPenalty}.`)) return;
    return run(() => api('/sponsors/cancel', { method: 'POST', body: { sponsorId: s.id } }));
  }

  if (!view) return <Spinner />;
  const nothing = view.active.length === 0 && view.offers.length === 0;

  return (
    <div>
      <div className="page-head" data-tour="sponsors">
        <div>
          <h1>Sponsors</h1>
          <p className="muted">
            Bedrijven kloppen pas aan als je hok hun aandacht verdient — hoe beter je duiven en resultaten,
            hoe grotere sponsors zich melden. Je kan meerdere sponsors hebben, maar per categorie (café,
            frituur…) telkens maar één. Je beste duif heeft nu talent {view.bestTalent}.
          </p>
        </div>
      </div>

      {nothing && (
        <div className="card muted">
          Nog geen enkele sponsor geïnteresseerd. Schrijf duiven in, win vluchten en kweek betere duiven —
          dan komen de aanbiedingen vanzelf. 🕊️
        </div>
      )}

      {view.offers.length > 0 && (
        <>
          <div className="page-head"><h2>📨 Nieuwe aanbiedingen</h2></div>
          <div className="grid cols-2">
            {view.offers.map((s) => (
              <SponsorCard key={s.id} s={s} busy={busy} highlight
                onAccept={() => accept(s)} onRefuse={() => refuse(s)} />
            ))}
          </div>
        </>
      )}

      {view.active.length > 0 && (
        <>
          <div className="page-head" style={{ marginTop: 22 }}><h2>🤝 Jouw sponsors</h2></div>
          <div className="grid cols-2">
            {view.active.map((s) => (
              <SponsorCard key={s.id} s={s} busy={busy} active onCancel={() => cancel(s)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SponsorCard({
  s, busy, highlight, active, onAccept, onRefuse, onCancel,
}: {
  s: Sponsor;
  busy: boolean;
  highlight?: boolean;
  active?: boolean;
  onAccept?: () => void;
  onRefuse?: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="card" style={{ borderColor: active ? 'var(--brand-strong)' : highlight ? 'var(--accent)' : undefined }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <div className="row" style={{ gap: 10 }}>
          <span style={{ fontSize: '1.6rem' }}>{s.icon}</span>
          <div>
            <strong>{s.name}</strong>
            <div className="faint" style={{ fontSize: '0.8rem' }}>{s.categoryLabel} · tier {s.tier}</div>
          </div>
        </div>
        {active && <span className="badge" style={{ background: 'var(--brand-strong)', color: '#fff' }}>Actief</span>}
        {highlight && <span className="badge" style={{ background: 'var(--accent)', color: '#fff' }}>Nieuw</span>}
      </div>

      <p className="muted" style={{ margin: '8px 0', fontStyle: 'italic', fontSize: '0.9rem' }}>"{s.tagline}"</p>

      <div className="table-wrap">
        <table className="data compact">
          <tbody>
            <tr><td>Tekengeld</td><td className="num"><Money value={s.signingBonus} />{s.signedBefore ? ' (al gehad)' : ''}</td></tr>
            <tr><td>Per dag</td><td className="num"><Money value={s.dailyStipend} /></td></tr>
            {active && <tr><td>Opzegboete</td><td className="num"><Money value={s.breakPenalty} /></td></tr>}
          </tbody>
        </table>
      </div>

      {/* Podium pays more the bigger the race — that is the whole point of a
          sponsor, so show the grid rather than one number. */}
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="data compact">
          <thead>
            <tr><th>Podiumpremie</th><th className="num">1e</th><th className="num">2e</th><th className="num">3e</th></tr>
          </thead>
          <tbody>
            {([['Regionaal', s.podium?.regional], ['Nationaal', s.podium?.national], ['Internationaal', s.podium?.international]] as const)
              .filter(([, row]) => !!row)
              .map(([label, row]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {row!.map((v, i) => <td key={i} className="num"><Money value={v} /></td>)}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>
        Enkel wedstrijdvluchten tellen — een oefenvlucht, de titanenwedstrijd en de estafettevlucht leveren geen premie op.
      </p>

      {!active && s.conflictWith && (
        <div className="faint" style={{ marginTop: 8, fontSize: '0.82rem', color: 'var(--bad)' }}>
          ⚠️ Concurrent van {s.conflictWith} — overstappen kost <Money value={s.conflictPenalty ?? 0} /> boete.
        </div>
      )}

      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        {onAccept && (
          <button className="btn accent" style={{ flex: 1 }} disabled={busy} onClick={onAccept}>
            {s.conflictWith ? 'Overstappen' : 'Aanvaarden'}
          </button>
        )}
        {onRefuse && (
          <button className="btn ghost" disabled={busy} onClick={onRefuse}>Weigeren</button>
        )}
        {onCancel && (
          <button className="btn ghost" style={{ flex: 1 }} disabled={busy} onClick={onCancel}>Opzeggen</button>
        )}
      </div>
    </div>
  );
}
