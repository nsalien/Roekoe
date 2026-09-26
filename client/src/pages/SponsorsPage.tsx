/** Sponsors: companies only make an offer once your loft has earned their
 * interest. Accept or refuse offers; hold at most one sponsor per category
 * (a competitor costs a break penalty to switch). */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Money, Spinner, useToast } from '../components/ui';
import type { Sponsor, SponsorView } from '../types';

export function SponsorsPage() {
  const { refresh } = useGame();
  const toast = useToast();
  const [view, setView] = useState<SponsorView | null>(null);
  const [busy, setBusy] = useState(false);
  // An offer waiting for the player to pick which contract to drop (at the limit).
  const [pending, setPending] = useState<Sponsor | null>(null);
  // Contracts ticked for the forced (free) reduction.
  const [dropIds, setDropIds] = useState<string[]>([]);

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
    // At the limit (and not a switch within a category): first choose who goes.
    if (!s.conflictWith && view && view.active.length >= (view.maxActive ?? Infinity)) {
      setPending(s);
      return;
    }
    if (s.conflictWith) {
      const ok = window.confirm(
        `Je hebt al ${s.conflictWith} in de categorie ${s.categoryLabel}. Overstappen naar ${s.name} kost een verbrekingsvergoeding van €${s.conflictPenalty}. Doorgaan?`,
      );
      if (!ok) return;
      return run(() => api('/sponsors/accept', { method: 'POST', body: { sponsorId: s.id, replace: true } }));
    }
    return run(() => api('/sponsors/accept', { method: 'POST', body: { sponsorId: s.id } }));
  }

  function acceptDropping(s: Sponsor, drop: Sponsor) {
    if (!window.confirm(`${drop.name} opzeggen (verbrekingsvergoeding €${drop.breakPenalty}) om ${s.name} te tekenen?`)) return;
    setPending(null);
    return run(() => api('/sponsors/accept', { method: 'POST', body: { sponsorId: s.id, dropSponsorId: drop.id } }));
  }

  function reduce() {
    setDropIds([]);
    return run(() => api('/sponsors/reduce', { method: 'POST', body: { sponsorIds: dropIds } }));
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
  const max = view.maxActive ?? null;
  const mustDrop = max != null ? Math.max(0, view.active.length - max) : 0;

  return (
    <div>
      <div className="page-head" data-tour="sponsors">
        <div>
          <h1>Sponsors</h1>
          <p className="muted" style={{ marginBottom: 4 }}>
            Sponsors kloppen pas aan ná een podium. Eén per categorie. Je beste duif heeft talent {view.bestTalent}.
            {max != null && <> <strong>Sponsors: {view.active.length} / {max}</strong>.</>}
          </p>
          <p className="faint" style={{ margin: 0, fontSize: '0.82rem' }}>
            <Link to="/wiki#sponsors">Meer over sponsors &amp; podiumpremies →</Link>
          </p>
        </div>
      </div>

      {view.mustReduce && (
        <div className="card" style={{ borderColor: 'var(--bad)', marginBottom: 16 }}>
          <strong style={{ color: 'var(--bad)' }}>⚠️ Kies je sponsors</strong>
          <p className="muted" style={{ margin: '6px 0 10px' }}>
            Je hebt {view.active.length} sponsors, het maximum is {max}. Kies er <strong>{mustDrop}</strong> om op te
            zeggen — <strong>gratis</strong>. Tot dan betaalt geen enkele sponsor uit.
          </p>
          <div className="stack" style={{ gap: 6 }}>
            {view.active.map((s) => (
              <label key={s.id} className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={dropIds.includes(s.id)}
                  onChange={(e) => setDropIds((ids) => (e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id)))}
                />
                <span>{s.icon} {s.name} · <Money value={s.dailyStipend} />/dag</span>
              </label>
            ))}
          </div>
          <button
            className="btn accent block"
            style={{ marginTop: 10 }}
            disabled={busy || view.active.length - dropIds.length > (max ?? 0) || dropIds.length === 0}
            onClick={reduce}
          >
            {view.active.length - dropIds.length > (max ?? 0)
              ? `Kies er nog ${view.active.length - dropIds.length - (max ?? 0)}`
              : `Deze ${dropIds.length} gratis opzeggen`}
          </button>
        </div>
      )}

      {pending && (
        <div className="card" style={{ borderColor: 'var(--accent)', marginBottom: 16 }}>
          <strong>Wie laat je gaan voor {pending.name}?</strong>
          <p className="muted" style={{ margin: '6px 0 10px' }}>
            Je hebt al {view.active.length} sponsors, het maximum. Kies er een om op te zeggen; dat kost de gewone
            verbrekingsvergoeding.
          </p>
          <div className="stack" style={{ gap: 6 }}>
            {view.active.map((a) => (
              <button key={a.id} className="btn secondary block" disabled={busy} onClick={() => acceptDropping(pending, a)}>
                {a.icon} {a.name} · <Money value={a.dailyStipend} />/dag · boete <Money value={a.breakPenalty} />
              </button>
            ))}
          </div>
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setPending(null)}>Annuleren</button>
        </div>
      )}

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
      {/* The "only competition flights pay" caveat used to sit on EVERY card;
          it is a rule of the game, not of this sponsor — it lives in the wiki now. */}
      <p className="faint" style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>
        Enkel wedstrijdvluchten betalen een premie.
      </p>

      {!active && s.conflictWith && (
        <div className="faint" style={{ marginTop: 8, fontSize: '0.82rem', color: 'var(--bad)' }}>
          ⚠️ Concurrent van {s.conflictWith} — overstappen kost <Money value={s.conflictPenalty ?? 0} /> boete.
          {s.refusalIsFinal && <> Ze bieden <strong>minder</strong> dan {s.conflictWith}: weiger je, dan komen ze <strong>niet meer terug</strong>.</>}
        </div>
      )}

      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        {onAccept && (
          <button className="btn accent" style={{ flex: 1 }} disabled={busy} onClick={onAccept}>
            {s.conflictWith ? 'Overstappen' : 'Aanvaarden'}
          </button>
        )}
        {onRefuse && (
          // A definitive refusal is worth one confirmation — it removes the
          // sponsor from the game for this loft.
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() => {
              if (s.refusalIsFinal && !window.confirm(`${s.name} definitief weigeren? Ze bieden minder dan ${s.conflictWith} en komen dan niet meer terug.`)) return;
              onRefuse();
            }}
          >
            {s.refusalIsFinal ? 'Definitief weigeren' : 'Weigeren'}
          </button>
        )}
        {onCancel && (
          <button className="btn ghost" style={{ flex: 1 }} disabled={busy} onClick={onCancel}>Opzeggen</button>
        )}
      </div>
    </div>
  );
}
