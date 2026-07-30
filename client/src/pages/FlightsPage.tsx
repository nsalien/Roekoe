/** Vluchten: upcoming races (with route + start time), live races and results. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useGame } from '../game/GameContext';
import { Money, Spinner, countdownTo, formatDuration, formatFlightTime, tierLabel, useToast } from '../components/ui';
import type { BetKind, BetPreview, BetView, Flight } from '../types';

/** A ticking clock so countdowns update every second. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function FlightsPage() {
  const { user } = useAuth();
  const { state, refresh } = useGame();
  const toast = useToast();
  const now = useNow();
  const [scheduled, setScheduled] = useState<Flight[]>([]);
  const [live, setLive] = useState<Flight[]>([]);
  const [completed, setCompleted] = useState<Flight[]>([]);
  const [tab, setTab] = useState<'scheduled' | 'results'>('scheduled');
  const [busy, setBusy] = useState(false);

  const [bets, setBets] = useState<BetView[]>([]);

  const load = useCallback(async () => {
    const res = await api<{ scheduled: Flight[]; live: Flight[]; completed: Flight[] }>('/flights');
    setScheduled(res.scheduled);
    setLive(res.live);
    setCompleted(res.completed);
  }, []);
  const loadBets = useCallback(async () => {
    const res = await api<{ bets: BetView[] }>('/bets');
    setBets(res.bets);
  }, []);
  useEffect(() => {
    load();
    loadBets();
  }, [load, loadBets, state?.world.currentWeek]);

  // Reload periodically so flights flip to live / completed without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const committed = useMemo(() => {
    const set = new Set<string>();
    for (const f of [...scheduled, ...live]) {
      for (const e of f.entries) if (e.ownerId === user?.id) set.add(e.pigeonId);
    }
    return set;
  }, [scheduled, live, user]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      await refresh();
      if (ok) toast.show(ok, 'ok');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  if (!state) return <Spinner />;

  return (
    <div>
      <div className="page-head">
        <h1>Vluchten</h1>
        <div className="pill-tabs">
          <button className={tab === 'scheduled' ? 'active' : ''} onClick={() => setTab('scheduled')}>Kalender</button>
          <button className={tab === 'results' ? 'active' : ''} onClick={() => setTab('results')}>Uitslagen</button>
        </div>
      </div>

      {tab === 'scheduled' && (
        <div className="stack">
          {bets.filter((b) => b.status === 'open').length > 0 && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>🎲 Jouw lopende weddenschappen</h2>
              <div className="stack" style={{ gap: 6 }}>
                {bets.filter((b) => b.status === 'open').map((b) => (
                  <div key={b.id} className="row" style={{ justifyContent: 'space-between', gap: 8, fontSize: '0.9rem' }}>
                    <span>{betLabel(b)} <span className="faint">· {b.flightName}</span></span>
                    <span className="faint">inzet <Money value={b.stake} /> · bij winst <strong><Money value={b.potentialWin} /></strong></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live races first */}
          {live.map((f) => (
            <div key={f.id} className="card" style={{ borderColor: 'var(--accent)' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="badge" style={{ background: 'var(--accent)', color: '#fff' }}>🔴 LIVE</span>
                    <strong>{f.name}</strong>
                  </div>
                  <div className="faint">{f.fromCity} → {f.toCity} · {f.distanceKm} km · {f.entryCount} duiven</div>
                </div>
                <Link to={`/vluchten/${f.id}`} className="btn accent">Bekijk live →</Link>
              </div>
            </div>
          ))}

          {scheduled.length === 0 && live.length === 0 && (
            <div className="card muted">Geen vluchten gepland. Kom straks terug!</div>
          )}

          {scheduled.map((f) => {
            const myEntries = f.entries.filter((e) => e.ownerId === user?.id);
            const available = state.pigeons.filter(
              (p) => p.canRace && !committed.has(p.id) && !p.breeding && p.form >= 1,
            );
            return (
              <div key={f.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="row" style={{ gap: 8 }}>
                      <h2 style={{ margin: 0 }}>{f.name}</h2>
                      <span className={`badge ${f.type}`}>{tierLabel(f.type)}</span>
                    </div>
                    <div className="faint" style={{ marginTop: 2 }}>
                      🕊️ {f.fromCity} → {f.toCity} · {f.distanceKm} km · inschrijfgeld <Money value={f.entryFee} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800 }}>{formatFlightTime(f.startAt)}</div>
                    <div className="faint">{countdownTo(f.startAt, now)}</div>
                  </div>
                </div>

                {myEntries.length > 0 && (
                  <div className="row" style={{ gap: 6, marginTop: 10 }}>
                    {myEntries.map((e) => {
                      const p = state.pigeons.find((x) => x.id === e.pigeonId);
                      return (
                        <span key={e.pigeonId} className="badge" style={{ background: 'var(--surface-2)' }}>
                          🕊️ {p?.name ?? 'duif'}
                          <button
                            className="btn ghost sm"
                            style={{ padding: '0 6px', marginLeft: 4 }}
                            disabled={busy}
                            onClick={() => act(() => api(`/flights/${f.id}/withdraw`, { method: 'POST', body: { pigeonId: e.pigeonId } }))}
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                <hr className="sep" />
                <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <EnterControl
                    disabled={busy}
                    options={available.map((p) => ({ id: p.id, label: `${p.name} (★${p.talent}, energie ${Math.round(p.form)})` }))}
                    onEnter={(pigeonId) => act(() => api(`/flights/${f.id}/enter`, { method: 'POST', body: { pigeonId } }), 'Ingeschreven!')}
                  />
                  <span className="faint" style={{ flexShrink: 0 }}>{f.entryCount} ingeschreven</span>
                </div>

                {f.bettingOpen && (
                  <BetPanel flight={f} meId={user?.id} onPlaced={() => { loadBets(); refresh(); }} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'results' && (
        <div className="stack">
          {bets.filter((b) => b.status !== 'open').length > 0 && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>🎲 Afgeronde weddenschappen</h2>
              <div className="stack" style={{ gap: 6 }}>
                {bets.filter((b) => b.status !== 'open').map((b) => (
                  <div key={b.id} className="row" style={{ justifyContent: 'space-between', gap: 8, fontSize: '0.9rem' }}>
                    <span>{betLabel(b)} <span className="faint">· {b.flightName}</span></span>
                    <span className={b.status === 'won' ? 'good' : b.status === 'lost' ? 'bad' : 'faint'}>
                      {b.status === 'won' ? <>gewonnen +<Money value={b.potentialWin} /></> : b.status === 'lost' ? <>verloren −<Money value={b.stake} /></> : 'vervallen'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {completed.length === 0 && <div className="card muted">Nog geen uitslagen.</div>}
          {completed.map((f) => (
            <FlightResultCard key={f.id} flight={f} meId={user?.id} />
          ))}
        </div>
      )}
    </div>
  );
}

const KIND_LABELS: Record<BetKind, string> = {
  win: 'Wint de vlucht',
  last: 'Eindigt allerlaatste',
  own_top3: 'Eigen duif in top 3',
  mine_wins: 'Een van mijn duiven wint',
  head2head: 'Komt eerder thuis dan…',
};

function betLabel(b: BetView): string {
  if (b.kind === 'mine_wins') return 'Een van je duiven wint';
  if (b.kind === 'head2head') return `${b.pigeonName} > ${b.rivalName}`;
  const tail = b.kind === 'win' ? 'wint' : b.kind === 'last' ? 'laatste' : 'top 3';
  return `${b.pigeonName} ${tail}`;
}

function BetPanel({ flight, meId, onPlaced }: { flight: Flight; meId?: string; onPlaced: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<BetKind>('win');
  const [pigeonId, setPigeonId] = useState('');
  const [rivalId, setRivalId] = useState('');
  const [stake, setStake] = useState(50);
  const [preview, setPreview] = useState<BetPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const entrants = flight.entrants;
  const mine = entrants.filter((e) => e.ownerId === meId);
  const targets = kind === 'own_top3' ? mine : entrants;
  const needsTarget = kind !== 'mine_wins';
  const needsRival = kind === 'head2head';

  // Keep target valid for the chosen kind.
  useEffect(() => {
    if (!needsTarget) return;
    if (!targets.some((t) => t.pigeonId === pigeonId)) setPigeonId(targets[0]?.pigeonId ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, flight.id]);

  // Live odds preview.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (needsTarget && !pigeonId) { setPreview(null); return; }
      if (needsRival && (!rivalId || rivalId === pigeonId)) { setPreview(null); return; }
      try {
        const p = await api<BetPreview>('/bets/preview', {
          method: 'POST',
          body: { flightId: flight.id, kind, pigeonId: needsTarget ? pigeonId : null, rivalId: needsRival ? rivalId : null, stake },
        });
        if (!cancelled) setPreview(p);
      } catch {
        if (!cancelled) setPreview(null);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [kind, pigeonId, rivalId, stake, flight.id, needsTarget, needsRival]);

  async function confirm() {
    setBusy(true);
    try {
      await api('/bets', {
        method: 'POST',
        body: { flightId: flight.id, kind, pigeonId: needsTarget ? pigeonId : null, rivalId: needsRival ? rivalId : null, stake },
      });
      toast.show('Weddenschap geplaatst! 🎲', 'ok');
      setOpen(false);
      onPlaced();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>🎲 Weddenschap plaatsen</button>
    );
  }

  const availableKinds: BetKind[] = ['win', 'last', 'head2head', ...(mine.length > 0 ? (['own_top3', 'mine_wins'] as BetKind[]) : [])];

  return (
    <div className="card" style={{ marginTop: 10, background: 'var(--surface-2)', boxShadow: 'none' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>🎲 Weddenschap</strong>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>×</button>
      </div>

      <label style={{ marginTop: 8 }}>Type</label>
      <select value={kind} onChange={(e) => setKind(e.target.value as BetKind)} disabled={busy}>
        {availableKinds.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
      </select>

      {needsTarget && (
        <>
          <label style={{ marginTop: 8 }}>{kind === 'own_top3' ? 'Jouw duif' : 'Duif'}</label>
          <select value={pigeonId} onChange={(e) => setPigeonId(e.target.value)} disabled={busy}>
            {targets.map((t) => <option key={t.pigeonId} value={t.pigeonId}>{t.name} (★{t.talent} · {t.ownerName})</option>)}
          </select>
        </>
      )}
      {needsRival && (
        <>
          <label style={{ marginTop: 8 }}>Tegenstander</label>
          <select value={rivalId} onChange={(e) => setRivalId(e.target.value)} disabled={busy}>
            <option value="">— kies —</option>
            {entrants.filter((t) => t.pigeonId !== pigeonId).map((t) => <option key={t.pigeonId} value={t.pigeonId}>{t.name} ({t.ownerName})</option>)}
          </select>
        </>
      )}

      <label style={{ marginTop: 8 }}>Inzet</label>
      <input type="number" min={10} value={stake} onChange={(e) => setStake(Number(e.target.value))} disabled={busy} style={{ maxWidth: 140 }} />

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
        <span className="faint">
          {preview
            ? <>Kans ~{Math.round(preview.prob * 100)}% · ratio <strong>{preview.ratio}×</strong> · winst <strong><Money value={preview.potentialWin} /></strong></>
            : 'Kies je weddenschap…'}
        </span>
        <button className="btn accent sm" disabled={busy || !preview} onClick={confirm}>Bevestig</button>
      </div>
    </div>
  );
}

function EnterControl({
  options,
  onEnter,
  disabled,
}: {
  options: { id: string; label: string }[];
  onEnter: (id: string) => void;
  disabled?: boolean;
}) {
  const [sel, setSel] = useState('');
  if (options.length === 0) return <span className="muted">Geen vluchtklare duiven beschikbaar.</span>;
  return (
    <div className="row enter-control" style={{ gap: 8, flex: 1, minWidth: 0 }}>
      <select
        value={sel}
        onChange={(e) => setSel(e.target.value)}
        style={{ flex: 1, minWidth: 0, maxWidth: '100%' }}
      >
        <option value="">— kies een duif —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <button className="btn" disabled={disabled || !sel} onClick={() => { onEnter(sel); setSel(''); }} style={{ flexShrink: 0 }}>
        Inschrijven
      </button>
    </div>
  );
}

function FlightResultCard({ flight, meId }: { flight: Flight; meId?: string }) {
  const [open, setOpen] = useState(false);
  const top = flight.results.slice(0, 5);
  const maxV = Math.max(1, ...flight.results.map((r) => r.velocity));
  const cancelled = flight.results.length === 0;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <strong>{flight.name}</strong>
            <span className={`badge ${flight.type}`}>{tierLabel(flight.type)}</span>
          </div>
          <div className="faint">{formatFlightTime(flight.startAt)} · {flight.fromCity} → {flight.toCity} · {flight.weather}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {cancelled ? <span className="muted">afgelast</span> : (
            <>
              <div className="faint">winnaar</div>
              <strong>{flight.results.find((r) => r.finished)?.ownerName ?? 'niemand thuis'}</strong>
            </>
          )}
        </div>
      </div>

      {flight.recap && (
        <div className="recap" style={{ marginTop: 10 }}>
          <span className="recap-badge">📻 Verslag</span> {flight.recap}
        </div>
      )}

      {!cancelled && (
        <>
          <div style={{ marginTop: 12 }}>
            {top.map((r) => {
              const mine = r.ownerId === meId;
              return (
              <div key={r.pigeonId} className="stat" style={mine ? { background: 'var(--brand-soft)', borderRadius: 8, padding: '4px 8px' } : undefined}>
                <div className="stat-top">
                  <span className="stat-label">
                    {r.finished ? `${r.rank}.` : '—'} <strong>{r.pigeonName}</strong> <span className="faint">· {r.ownerName}</span>
                    {mine && <span className="badge club" style={{ marginLeft: 6 }}>jij</span>}
                  </span>
                  <span className="stat-val">{r.finished ? `${r.velocity} m/min` : '❌ niet thuis'}</span>
                </div>
                <div className="bar">
                  <span style={{ width: `${r.finished ? (r.velocity / maxV) * 100 : 0}%`, background: r.ownerId === meId ? 'linear-gradient(90deg,#f97316,#fdba74)' : undefined }} />
                </div>
              </div>
              );
            })}
          </div>

          {open && (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data">
                <thead>
                  <tr><th>#</th><th>Duif</th><th>Hok</th><th className="num">Snelheid</th><th className="num">Tijd</th><th className="num">Prijs</th><th className="num">Ptn</th></tr>
                </thead>
                <tbody>
                  {flight.results.map((r) => (
                    <tr key={r.pigeonId} className={r.ownerId === meId ? 'me' : r.finished && r.rank === 1 ? 'podium-1' : ''}>
                      <td>{r.finished ? r.rank : '—'}</td><td>{r.pigeonName}</td><td>{r.ownerName}</td>
                      <td className="num">{r.finished ? r.velocity : '—'}</td><td className="num">{r.finished ? formatDuration(r.timeSeconds) : '❌ DNF'}</td>
                      <td className="num">{r.prize > 0 ? <Money value={r.prize} /> : '—'}</td><td className="num">{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setOpen((o) => !o)}>
            {open ? 'Verberg volledige uitslag' : 'Toon volledige uitslag'}
          </button>
        </>
      )}
    </div>
  );
}
