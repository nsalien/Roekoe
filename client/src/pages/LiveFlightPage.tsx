/** Live flight tracker: per-bird position, speed and a funny commentary feed. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useGame } from '../game/GameContext';
import { Money, Spinner, countdownTo, formatFlightTime } from '../components/ui';
import type { LiveResponse } from '../types';

export function LiveFlightPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { refresh } = useGame();
  const nav = useNavigate();
  const [data, setData] = useState<LiveResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const wasCompleted = useRef(false);
  const feedRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api<LiveResponse>(`/flights/${id}/live`);
      setData(res);
      // When the race just finished, refresh loft/money once.
      if (res.flight.status === 'completed' && !wasCompleted.current) {
        wasCompleted.current = true;
        refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Kon vlucht niet laden');
    }
  }, [id, refresh]);

  useEffect(() => {
    load();
    // Flights run in real time (hours), so a gentle poll keeps the board fresh
    // without hammering the server. We stop polling once the race is over.
    const t = setInterval(() => {
      if (wasCompleted.current) return;
      load();
    }, 8000);
    return () => clearInterval(t);
  }, [load]);

  // Keep the commentary feed scrolled to the newest line.
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [data?.commentary.length]);

  if (err) {
    return (
      <div className="card">
        <p className="notice err">{err}</p>
        <Link to="/vluchten" className="btn ghost sm">← terug naar vluchten</Link>
      </div>
    );
  }
  if (!data) return <Spinner />;

  const { flight, live, commentary } = data;
  const isScheduled = flight.status === 'scheduled';
  const isDone = flight.status === 'completed';

  return (
    <div>
      <Link to="/vluchten" className="faint">← alle vluchten</Link>

      <div className="card" style={{ marginTop: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="row" style={{ gap: 8 }}>
              <h1 style={{ margin: 0 }}>{flight.name}</h1>
              {flight.status === 'live' && <span className="badge" style={{ background: 'var(--accent)', color: '#fff' }}>🔴 LIVE</span>}
              {isDone && <span className="badge sale">🏁 gefinisht</span>}
            </div>
            <div className="faint" style={{ marginTop: 2 }}>
              {flight.fromCity} → {flight.toCity} · {flight.distanceKm} km
              {flight.weather ? ` · ${flight.weather}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="faint">start</div>
            <strong>{formatFlightTime(flight.startAt)}</strong>
          </div>
        </div>

        {isScheduled && (
          <div style={{ textAlign: 'center', padding: '18px 0' }}>
            <div className="muted">De duiven zitten nog in de manden…</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: 4 }}>Start {countdownTo(flight.startAt)}</div>
          </div>
        )}

        {live && (
          <div style={{ marginTop: 12 }}>
            <div className="stat-top">
              <span className="stat-label">Kop van de wedstrijd</span>
              <span className="stat-val">{Math.round(live.overallProgress * 100)}%</span>
            </div>
            <div className="bar" style={{ height: 10 }}>
              <span style={{ width: `${live.overallProgress * 100}%`, background: 'linear-gradient(90deg,var(--accent),#fdba74)' }} />
            </div>
          </div>
        )}
      </div>

      {/* Per-bird live board */}
      {live && (
        <div className="card">
          <h2>Stand in de lucht</h2>
          <div className="stack" style={{ gap: 12 }}>
            {live.birds.map((b) => {
              const mine = b.ownerId === user?.id;
              return (
                <div
                  key={b.pigeonId}
                  style={mine ? { background: 'var(--brand-soft)', borderLeft: '3px solid var(--brand-strong)', borderRadius: 8, padding: '6px 8px' } : undefined}
                >
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span className="stat-label">
                      <strong>{b.liveRank}.</strong> {mine ? <strong>{b.pigeonName}</strong> : b.pigeonName}
                      {mine && <span className="badge club" style={{ marginLeft: 6 }}>jij</span>}
                      <span className="faint"> · {b.ownerName}</span>
                    </span>
                    <span className="stat-val">
                      {b.finished ? '🏁 thuis' : `${b.speedKmh} km/u`}
                    </span>
                  </div>
                  <div className="bar" style={{ height: 9 }}>
                    <span
                      style={{
                        width: `${b.progress * 100}%`,
                        background: b.finished
                          ? 'var(--good)'
                          : mine
                            ? 'linear-gradient(90deg,var(--accent),#fdba74)'
                            : undefined,
                      }}
                    />
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="faint">{b.kmDone} / {b.kmTotal} km</span>
                    <span className="faint">{b.finished ? 'binnen' : `nog ${b.kmRemaining} km`}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Commentary feed */}
      {(flight.status === 'live' || isDone) && (
        <div className="card">
          <h2>📻 Live verslag</h2>
          <div ref={feedRef} style={{ maxHeight: 260, overflowY: 'auto' }} className="stack">
            {commentary.length === 0 && <p className="muted">De reporter schraapt zijn keel…</p>}
            {commentary.map((c, i) => (
              <div
                key={i}
                style={{
                  padding: '8px 11px',
                  borderRadius: 10,
                  background: i === commentary.length - 1 ? 'var(--brand-soft)' : 'var(--surface-2)',
                  fontSize: '0.9rem',
                }}
              >
                {c.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sports-reporter recap */}
      {isDone && flight.recap && (
        <div className="card recap-card">
          <h2>📻 Samenvatting van de wedstrijd</h2>
          <p className="recap-text">{flight.recap}</p>
        </div>
      )}

      {/* Final result */}
      {isDone && flight.results.length > 0 && (
        <div className="card">
          <h2>🏆 Uitslag</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>#</th><th>Duif</th><th>Hok</th><th className="num">Prijs</th><th className="num">Ptn</th></tr>
              </thead>
              <tbody>
                {flight.results.map((r) => (
                  <tr key={r.pigeonId} className={r.ownerId === user?.id ? 'me' : r.rank === 1 ? 'podium-1' : ''}>
                    <td>{r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank}</td>
                    <td>{r.pigeonName}</td>
                    <td>{r.ownerName}</td>
                    <td className="num">{r.prize > 0 ? <Money value={r.prize} /> : '—'}</td>
                    <td className="num">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => nav('/vluchten')}>
            ← terug naar vluchten
          </button>
        </div>
      )}
    </div>
  );
}
