/** Vluchten: upcoming races (with route + start time), live races and results. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useGame } from '../game/GameContext';
import { Money, Spinner, countdownTo, formatDuration, formatFlightTime, useToast } from '../components/ui';
import type { Flight } from '../types';

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

  const load = useCallback(async () => {
    const res = await api<{ scheduled: Flight[]; live: Flight[]; completed: Flight[] }>('/flights');
    setScheduled(res.scheduled);
    setLive(res.live);
    setCompleted(res.completed);
  }, []);
  useEffect(() => {
    load();
  }, [load, state?.world.currentWeek]);

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
            const available = state.pigeons.filter((p) => p.canRace && !committed.has(p.id));
            return (
              <div key={f.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="row" style={{ gap: 8 }}>
                      <h2 style={{ margin: 0 }}>{f.name}</h2>
                      <span className={`badge ${f.type}`}>{f.type === 'club' ? 'Club' : 'Nationaal'}</span>
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
                    options={available.map((p) => ({ id: p.id, label: `${p.name} (★${p.talent}, cond. ${Math.round(p.form)})` }))}
                    onEnter={(pigeonId) => act(() => api(`/flights/${f.id}/enter`, { method: 'POST', body: { pigeonId } }), 'Ingeschreven!')}
                  />
                  <span className="faint" style={{ flexShrink: 0 }}>{f.entryCount} ingeschreven</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'results' && (
        <div className="stack">
          {completed.length === 0 && <div className="card muted">Nog geen uitslagen.</div>}
          {completed.map((f) => (
            <FlightResultCard key={f.id} flight={f} meId={user?.id} />
          ))}
        </div>
      )}
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
  const maxV = top.length ? top[0].velocity : 1;
  const cancelled = flight.results.length === 0;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <strong>{flight.name}</strong>
            <span className={`badge ${flight.type}`}>{flight.type === 'club' ? 'Club' : 'Nat.'}</span>
          </div>
          <div className="faint">{formatFlightTime(flight.startAt)} · {flight.fromCity} → {flight.toCity} · {flight.weather}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {cancelled ? <span className="muted">afgelast</span> : (
            <>
              <div className="faint">winnaar</div>
              <strong>{flight.results[0]?.ownerName}</strong>
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
            {top.map((r) => (
              <div key={r.pigeonId} className="stat">
                <div className="stat-top">
                  <span className="stat-label">{r.rank}. {r.pigeonName} <span className="faint">· {r.ownerName}</span></span>
                  <span className="stat-val">{r.velocity} m/min</span>
                </div>
                <div className="bar">
                  <span style={{ width: `${(r.velocity / maxV) * 100}%`, background: r.ownerId === meId ? 'linear-gradient(90deg,#f97316,#fdba74)' : undefined }} />
                </div>
              </div>
            ))}
          </div>

          {open && (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data">
                <thead>
                  <tr><th>#</th><th>Duif</th><th>Hok</th><th className="num">Snelheid</th><th className="num">Tijd</th><th className="num">Prijs</th><th className="num">Ptn</th></tr>
                </thead>
                <tbody>
                  {flight.results.map((r) => (
                    <tr key={r.pigeonId} className={r.ownerId === meId ? 'me' : r.rank === 1 ? 'podium-1' : ''}>
                      <td>{r.rank}</td><td>{r.pigeonName}</td><td>{r.ownerName}</td>
                      <td className="num">{r.velocity}</td><td className="num">{formatDuration(r.timeSeconds)}</td>
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
