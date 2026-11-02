/** De bank: lenen tot een limiet op je gemiddelde inkomsten,
 * dagelijks afbetalen met rente. Kort gehouden — de uitleg staat in /wiki#bank. */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Money, Spinner, useToast } from '../components/ui';
import type { BankView } from '../types';

/** Same rounding as gameConfig.loanTotal / loanDaily (whole euros, rounded up). */
const totalFor = (amount: number, interest: number) => Math.ceil((amount * (100 + Math.round(interest * 100))) / 100);
const dailyFor = (total: number, days: number) => Math.ceil(total / days);
const euro = (n: number) => `€${n.toLocaleString('nl-BE')}`;

export function BankPage() {
  const { refresh } = useGame();
  const toast = useToast();
  const [view, setView] = useState<BankView | null>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(0);
  const [days, setDays] = useState(14);

  const load = useCallback(async () => {
    const v = await api<BankView>('/bank');
    setView(v);
    // Start the form on something that fits: half of what the chosen term allows.
    setAmount((a) => {
      const max = v.terms.find((t) => t.days === days)?.max ?? 0;
      if (a > 0 && a <= max) return a;
      return Math.max(v.minLoan, Math.floor(max / 2 / v.step) * v.step);
    });
  }, [days]);
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

  if (!view) return <Spinner />;

  const term = view.terms.find((t) => t.days === days) ?? view.terms[0];
  const total = totalFor(amount, term.interest);
  const daily = dailyFor(total, term.days);
  const valid = amount >= view.minLoan && amount % view.step === 0 && amount <= term.max;

  function lend() {
    const ok = window.confirm(
      `${euro(amount)} lenen over ${term.days} dagen?\n\n` +
        `Je betaalt ${term.days} dagen ${euro(daily)} per dag terug, samen ${euro(total)} — ${euro(total - amount)} rente. ` +
        'Aflossen kan altijd, maar dan betaal je wat je nog schuldig bent, rente inbegrepen.',
    );
    if (!ok) return;
    return run(() => api('/bank/borrow', { method: 'POST', body: { amount, days: term.days } }));
  }

  function settle(id: string, owed: number) {
    if (!window.confirm(`Deze lening nu aflossen voor ${euro(owed)}?`)) return;
    return run(() => api('/bank/settle', { method: 'POST', body: { loanId: id } }));
  }

  return (
    <div>
      <div className="page-head" data-tour="bank">
        <div>
          <h1>🏦 Bank</h1>
          <p className="muted" style={{ marginBottom: 4 }}>
            Je mag tot <Money value={view.limit} /> open hebben staan — {view.limitDays} dagen van je gemiddelde inkomsten
            (<Money value={view.averageIncome} />/dag). Nog vrij:{' '}
            <strong style={{ color: view.room > 0 ? 'var(--good)' : undefined }}><Money value={view.room} /></strong>.
          </p>
          <p className="faint" style={{ margin: 0, fontSize: '0.82rem' }}>
            <Link to="/wiki#bank">Meer info over lenen →</Link>
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Lenen</h2>
        {view.blocked ? (
          <p className="faint" style={{ margin: 0 }}>{view.blocked}</p>
        ) : (
          <>
            <div className="chip-row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
              {view.terms.map((t) => (
                <button key={t.days} className={`chip ${t.days === term.days ? 'active' : ''}`} onClick={() => setDays(t.days)} disabled={t.max <= 0}>
                  {t.days} dagen · {Math.round(t.interest * 100)} %
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="number"
                value={amount}
                min={view.minLoan}
                max={term.max}
                step={view.step}
                onChange={(e) => setAmount(Number(e.target.value))}
                style={{ maxWidth: 140 }}
              />
              <button className="btn accent" disabled={busy || !valid} onClick={lend}>
                Leen <Money value={amount} />
              </button>
              <span className="faint">max. <Money value={term.max} /></span>
            </div>
            <p style={{ margin: '10px 0 0' }}>
              {valid ? (
                <>
                  Vanaf vannacht <strong>{term.days} dagen <Money value={daily} /></strong> per dag — samen{' '}
                  <Money value={total} />, waarvan <span style={{ color: 'var(--bad)' }}><Money value={total - amount} /> rente</span>.
                </>
              ) : (
                <span className="faint">
                  Kies een bedrag vanaf {euro(view.minLoan)}, in stappen van {euro(view.step)}, tot {euro(term.max)}.
                </span>
              )}
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Lopende leningen</h2>
        {view.loans.length === 0 ? (
          <p className="faint" style={{ margin: 0 }}>Je hebt geen lopende leningen.</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Nog af te betalen: <strong><Money value={view.owed} /></strong> · vannacht <Money value={view.dueTonight} />.
            </p>
            {view.loans.map((l) => (
              <div
                key={l.id}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}
              >
                <div style={{ minWidth: 0 }}>
                  <div><Money value={l.principal} /> over {l.days} dagen</div>
                  <div className="faint" style={{ fontSize: '0.82rem' }}>
                    nog <Money value={l.owed} /> · {l.daysLeft} {l.daysLeft === 1 ? 'dag' : 'dagen'} · vannacht <Money value={l.tonight} />
                  </div>
                </div>
                <button className="btn ghost sm" disabled={busy} onClick={() => settle(l.id, l.owed)}>
                  Aflossen · <Money value={l.owed} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
