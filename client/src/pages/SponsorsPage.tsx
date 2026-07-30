/** Sponsors: companies that invest in a well-performing melker. Sign one head
 * sponsor for a signing bonus, a weekly stipend and a bonus per won flight. */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Money, Spinner, useToast } from '../components/ui';
import type { SponsorOffer, SponsorView } from '../types';

export function SponsorsPage() {
  const { refresh } = useGame();
  const toast = useToast();
  const [view, setView] = useState<SponsorView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<SponsorView>('/sponsors');
    setView(res);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function sign(o: SponsorOffer) {
    if (view?.activeId && view.activeId !== o.id) {
      const ok = window.confirm(
        `Je hebt al een hoofdsponsor. Overstappen naar ${o.name}? Je verliest de weekbijdrage van je huidige sponsor.`,
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await api<{ result: string }>('/sponsors/sign', { method: 'POST', body: { sponsorId: o.id } });
      toast.show(res.result || 'Getekend!', 'ok');
      await load();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm('Je hoofdsponsor opzeggen? Je weekbijdrage stopt.')) return;
    setBusy(true);
    try {
      const res = await api<{ result: string }>('/sponsors/cancel', { method: 'POST' });
      toast.show(res.result || 'Opgezegd', 'ok');
      await load();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  if (!view) return <Spinner />;
  const active = view.offers.find((o) => o.id === view.activeId) ?? null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Sponsors</h1>
          <p className="muted">
            Presteer goed en bedrijven willen investeren in jouw hok. Kies één hoofdsponsor: die betaalt
            tekengeld, een vaste weekbijdrage en een bonus per gewonnen vlucht. Je beste duif heeft nu talent {view.bestTalent}.
          </p>
        </div>
      </div>

      {active ? (
        <div className="card" style={{ borderColor: 'var(--brand-strong)', marginBottom: 18 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 10 }}>
              <span style={{ fontSize: '1.8rem' }}>{active.icon}</span>
              <div>
                <strong style={{ fontSize: '1.05rem' }}>{active.name}</strong>
                <div className="faint">Jouw huidige hoofdsponsor</div>
              </div>
            </div>
            <button className="btn ghost sm" disabled={busy} onClick={cancel}>Opzeggen</button>
          </div>
          <p className="muted" style={{ margin: '10px 0 0', fontStyle: 'italic' }}>"{active.tagline}"</p>
          <div className="row" style={{ gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
            <span>Weekbijdrage: <strong><Money value={active.weeklyStipend} /></strong></span>
            <span>Per overwinning: <strong><Money value={active.winBonus} /></strong></span>
          </div>
        </div>
      ) : (
        <div className="card muted" style={{ marginBottom: 18 }}>
          Je hebt nog geen hoofdsponsor. Teken hieronder bij een bedrijf dat je hebt vrijgespeeld.
        </div>
      )}

      <div className="grid cols-2">
        {view.offers.map((o) => (
          <div
            key={o.id}
            className="card"
            style={{ opacity: o.unlocked || o.active ? 1 : 0.6, borderColor: o.active ? 'var(--brand-strong)' : undefined }}
          >
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <div className="row" style={{ gap: 10 }}>
                <span style={{ fontSize: '1.6rem' }}>{o.icon}</span>
                <div>
                  <strong>{o.name}</strong>
                  <div className="faint" style={{ fontSize: '0.8rem' }}>Tier {o.tier}</div>
                </div>
              </div>
              {o.active && <span className="badge" style={{ background: 'var(--brand-strong)', color: '#fff' }}>Actief</span>}
            </div>

            <p className="muted" style={{ margin: '8px 0', fontStyle: 'italic', fontSize: '0.9rem' }}>"{o.tagline}"</p>

            <div className="table-wrap">
              <table className="data compact">
                <tbody>
                  <tr><td>Tekengeld</td><td className="num"><Money value={o.signingBonus} />{o.signedBefore ? ' (al ontvangen)' : ''}</td></tr>
                  <tr><td>Per week</td><td className="num"><Money value={o.weeklyStipend} /></td></tr>
                  <tr><td>Per overwinning</td><td className="num"><Money value={o.winBonus} /></td></tr>
                </tbody>
              </table>
            </div>

            {o.unlocked ? (
              <button
                className={`btn ${o.active ? '' : 'accent'} block`}
                style={{ marginTop: 10 }}
                disabled={busy || o.active}
                onClick={() => sign(o)}
              >
                {o.active ? 'Huidige sponsor' : view.activeId ? 'Overstappen' : 'Tekenen'}
              </button>
            ) : (
              <div className="faint" style={{ marginTop: 10, fontSize: '0.85rem' }}>🔒 {o.requirement}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
