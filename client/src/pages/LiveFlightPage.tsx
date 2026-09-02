/** Live flight tracker: per-bird position, speed and a funny commentary feed. */

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useGame } from '../game/GameContext';
import { useVisiblePoll } from '../game/useVisiblePoll';
import { Money, Spinner, countdownTo, formatFlightTime, useToast } from '../components/ui';
import { MapErrorBoundary } from '../components/MapErrorBoundary';
import type { LiveFlight, LiveResponse } from '../types';

/**
 * The live map, loaded ONLY when someone is actually watching a race. Leaflet
 * plus its CSS is a sizeable chunk and every other page in the game would
 * otherwise pay for it on first load. It renders from the poll this page already
 * does — it never fetches anything itself (see FlightMap.tsx).
 */
const FlightMap = lazy(() => import('../components/FlightMap'));

/** Which leg of an estafettevlucht a bird flew (undefined for normal flights). */
function legOf(flight: LiveFlight, pigeonId: string): number | undefined {
  return flight.entries.find((e) => e.pigeonId === pigeonId)?.leg;
}

export function LiveFlightPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { refresh } = useGame();
  const toast = useToast();
  const nav = useNavigate();
  const [data, setData] = useState<LiveResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  }, [load]);

  // Flights run in real time (hours — an estafettevlucht runs the best part of
  // a DAY), so a gentle poll keeps the board fresh without hammering the
  // server. Every poll reads the whole world (~350 D1 rows), and D1's free
  // plan allows 5M rows a day: at the old 20 s one open board for a single
  // long race burned over a million rows on its own, which is what took the
  // site down. 60 s costs a third of that and the board is still live —
  // and `useVisiblePoll` stops it entirely once the tab is out of sight.
  useVisiblePoll(() => {
    if (wasCompleted.current) return;
    load();
  }, 60000);

  // Keep the commentary feed scrolled to the newest line.
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [data?.commentary.length]);

  async function giveUp(pigeonId: string, name: string) {
    if (!id) return;
    if (!window.confirm(`${name} laten opgeven? Ze finisht niet, maar spaart wel energie voor de volgende vlucht.`)) return;
    setBusy(true);
    try {
      await api(`/flights/${id}/giveup`, { method: 'POST', body: { pigeonId } });
      toast.show(`${name} geeft op en is meteen weer vrij 🏳️`, 'ok');
      await load();
      // Her race is over the moment she is pulled, so she is free again right
      // away (trainen, rustkuur, koppelen, verkopen — see birdStillOut). That
      // freedom lives in `/state`, which the live board never fetches: without
      // this she kept showing up as "ingeschreven voor een vlucht" everywhere
      // else until something happened to reload it.
      refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  // Admin only: end a live flight now instead of waiting for the stragglers.
  // The standings were frozen at release, so this only skips the waiting.
  async function finishNow(name: string) {
    if (!id) return;
    if (!window.confirm(`Ben je zeker dat je deze match wil beëindigen?\n\n${name} wordt meteen afgerond. De duiven eindigen op de plaatsen die nu al vastliggen en krijgen hun gewone punten en prijzengeld — er wordt niemand geschrapt.`)) return;
    setBusy(true);
    try {
      const res = await api<{ results: number }>(`/admin/flights/${id}/finish`, { method: 'POST' });
      toast.show(`Vlucht afgerond — ${res.results} duiven in de uitslag 🏁`, 'ok');
      await load();
      refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

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

        {flight.status === 'live' && user?.isAdmin && (
          <div className="row" style={{ marginTop: 10, gap: 8, alignItems: 'center' }}>
            <button className="btn danger sm" disabled={busy} onClick={() => finishNow(flight.name)}>
              ⏩ Match beëindigen
            </button>
            <span className="faint sm">
              Beheerder — rondt de vlucht nu af op de stand die al vastligt.
            </span>
          </div>
        )}

        {isScheduled && (
          <div style={{ textAlign: 'center', padding: '18px 0' }}>
            <div className="muted">De duiven zitten nog in de manden…</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: 4 }}>Start {countdownTo(flight.startAt)}</div>
          </div>
        )}

        {/* Head and tail of the field: the leader's progress and that of the last
            bird still in the race. Both follow real positions, not the clock. */}
        {live && (
          <div className="stack" style={{ marginTop: 12, gap: 8 }}>
            <div>
              <div className="stat-top">
                <span className="stat-label">Kop van de wedstrijd</span>
                <span className="stat-val">{Math.round(live.headProgress * 100)}%</span>
              </div>
              <div className="bar" style={{ height: 10 }}>
                <span style={{ width: `${live.headProgress * 100}%`, background: 'linear-gradient(90deg,var(--accent),#fdba74)' }} />
              </div>
            </div>
            <div>
              <div className="stat-top">
                <span className="stat-label">Staart van de wedstrijd</span>
                <span className="stat-val">{Math.round(live.tailProgress * 100)}%</span>
              </div>
              <div className="bar" style={{ height: 10 }}>
                <span style={{ width: `${live.tailProgress * 100}%` }} />
              </div>
            </div>
          </div>
        )}

        {/* The same race on a real map. Rides on the poll above: no request of
            its own, no extra D1 row. Hidden when the release point has no
            coordinates, so we never draw a route through the wrong place. */}
        {live && flight.route && (
          <MapErrorBoundary>
            <Suspense fallback={<div className="flight-map map-loading">Kaart laden…</div>}>
              <FlightMap
                route={flight.route}
                birds={live.birds}
                teams={live.teams}
                meId={user?.id}
                outCount={live.birds.filter((b) => b.gaveUp).length}
              />
            </Suspense>
          </MapErrorBoundary>
        )}
      </div>

      {/* Per-team live board (estafettevlucht) */}
      {live?.teams && (
        <div className="card">
          <h2>Stand van de ploegen</h2>
          <div className="stack" style={{ gap: 14 }}>
            {live.teams.map((t) => {
              const mine = t.ownerId === user?.id;
              return (
                <div
                  key={t.ownerId}
                  style={mine ? { background: 'var(--brand-soft)', borderLeft: '3px solid var(--brand-strong)', borderRadius: 8, padding: '6px 8px' } : undefined}
                >
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span className="stat-label">
                      <strong>{t.out ? '—' : `${t.liveRank}.`}</strong> {mine ? <strong>{t.ownerName}</strong> : t.ownerName}
                      {mine && <span className="badge club" style={{ marginLeft: 6 }}>jij</span>}
                    </span>
                    <span className="stat-val">
                      {t.out ? '💥 uitgeschakeld' : t.finished ? '🏁 thuis' : `${t.speedKmh} km/u`}
                    </span>
                  </div>
                  <div className="bar" style={{ height: 9, opacity: t.out ? 0.4 : 1 }}>
                    <span
                      style={{
                        width: `${t.progress * 100}%`,
                        background: t.out
                          ? 'var(--muted)'
                          : t.finished
                            ? 'var(--good)'
                            : mine
                              ? 'linear-gradient(90deg,var(--accent),#fdba74)'
                              : undefined,
                      }}
                    />
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="faint">{t.kmDone} / {t.kmTotal} km</span>
                    <span className="faint">{t.out ? 'uit de wedstrijd' : t.finished ? 'binnen' : `etappe ${t.activeLeg} · nog ${t.kmRemaining} km`}</span>
                  </div>
                  {/* The three legs, so you can see who has the baton. */}
                  <div className="stack" style={{ gap: 3, marginTop: 6 }}>
                    {t.legs.map((l) => {
                      const flying = l.status === 'onderweg';
                      return (
                        <div key={l.pigeonId} className="row" style={{ justifyContent: 'space-between', gap: 8, fontSize: '0.82rem', opacity: l.status === 'wachtend' ? 0.55 : 1 }}>
                          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                            {l.status === 'binnen' ? '✅' : flying ? '🔴' : l.status === 'gestopt' ? '💥' : '⏳'} etappe {l.leg} · {l.pigeonName}
                          </span>
                          <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                            <span className="faint">{l.kmDone} / {l.kmTotal} km</span>
                            {mine && flying && (
                              <button
                                className="btn ghost sm"
                                style={{ padding: '0 6px', color: 'var(--bad)' }}
                                disabled={busy}
                                title="De hele ploeg valt dan uit — enkel om je duif te sparen"
                                onClick={() => giveUp(l.pigeonId, l.pigeonName)}
                              >
                                🏳️
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="faint" style={{ marginTop: 10, marginBottom: 0 }}>
            Eén duif tegelijk per ploeg; valt er één weg, dan valt de hele ploeg uit.{' '}
            <Link to="/wiki#estafette">Meer info →</Link>
          </p>
        </div>
      )}

      {/* Per-bird live board */}
      {live && !live.teams && (
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
                      <strong>{b.gaveUp ? '—' : `${b.liveRank}.`}</strong> {mine ? <strong>{b.pigeonName}</strong> : b.pigeonName}
                      {mine && <span className="badge club" style={{ marginLeft: 6 }}>jij</span>}
                      <span className="faint"> · {b.ownerName}</span>
                    </span>
                    <span className="stat-val">
                      {b.gaveUp ? '🏳️ opgegeven' : b.finished ? '🏁 thuis' : `${b.speedKmh} km/u`}
                    </span>
                  </div>
                  <div className="bar" style={{ height: 9, opacity: b.gaveUp ? 0.4 : 1 }}>
                    <span
                      style={{
                        width: `${b.progress * 100}%`,
                        background: b.gaveUp
                          ? 'var(--muted)'
                          : b.finished
                            ? 'var(--good)'
                            : mine
                              ? 'linear-gradient(90deg,var(--accent),#fdba74)'
                              : undefined,
                      }}
                    />
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="faint">{b.kmDone} / {b.kmTotal} km</span>
                    {mine && !b.finished && !b.gaveUp ? (
                      <button
                        className="btn ghost sm"
                        style={{ padding: '0 8px', color: 'var(--bad)' }}
                        disabled={busy}
                        title="Ze finisht niet, maar spaart wel energie"
                        onClick={() => giveUp(b.pigeonId, b.pigeonName)}
                      >
                        🏳️ Opgeven
                      </button>
                    ) : (
                      <span className="faint">{b.gaveUp ? 'opgegeven' : b.finished ? 'binnen' : `nog ${b.kmRemaining} km`}</span>
                    )}
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
                <tr>
                  <th>#</th><th>Duif</th><th>Hok</th><th className="num">Prijs</th>
                  {flight.relay ? <th className="num">km/u</th> : <th className="num">Ptn</th>}
                </tr>
              </thead>
              <tbody>
                {/* A relay scores per team: three birds share one placing, listed
                    in the order they flew their legs. */}
                {(flight.relay
                  ? [...flight.results].sort((a, b) =>
                      a.rank - b.rank ||
                      (legOf(flight, a.pigeonId) ?? 0) - (legOf(flight, b.pigeonId) ?? 0))
                  : flight.results
                ).map((r) => (
                  <tr key={r.pigeonId} className={r.ownerId === user?.id ? 'me' : r.rank === 1 ? 'podium-1' : ''}>
                    <td>{r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank}</td>
                    <td>
                      {r.pigeonName}
                      {flight.relay && <span className="faint"> · etappe {legOf(flight, r.pigeonId) ?? '?'}</span>}
                    </td>
                    <td>{r.ownerName}</td>
                    <td className="num">{r.prize > 0 ? <Money value={r.prize} /> : r.finished !== false && r.rewarded === false ? <span className="faint" title="Buiten de 3 beloonde duiven van dit hok">buiten de 3</span> : '—'}</td>
                    {flight.relay
                      ? <td className="num">{r.finished === false ? '—' : Math.round(r.velocity * 0.06)}</td>
                      : <td className="num">{r.points}</td>}
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
