/** Overview dashboard: loft at a glance, care controls and quick links. */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGame } from '../game/GameContext';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { Money, Spinner, countdownTo, formatFlightTime, useToast } from '../components/ui';
import { PigeonCard } from '../components/PigeonCard';
import type { FeedRation } from '../types';

const FOOD_PRICE = 3;

export function DashboardPage() {
  const { state, loading, refresh } = useGame();
  const { user } = useAuth();
  const toast = useToast();
  const [buyKg, setBuyKg] = useState(50);
  const [busy, setBusy] = useState(false);

  if (loading || !state) return <Spinner />;
  const { loft, pigeons, world, rankings, scheduledFlights, feedRations } = state;
  if (!loft) return <div className="card">Geen hok gevonden.</div>;

  const myRank = rankings.find((r) => r.userId === user?.id);
  const topPigeons = pigeons.slice(0, 3);
  const now = Date.now();
  const avgForm = pigeons.length ? Math.round(pigeons.reduce((s, p) => s + p.form, 0) / pigeons.length) : 0;

  // Ailing birds still in the normal loft (need the player to act).
  const needCare = pigeons.filter((p) => p.ailment && !p.inInfirmary).length;
  // The player's own next race (soonest scheduled or currently live).
  const myNextFlight = [...scheduledFlights]
    .filter((f) => f.entries.some((e) => e.ownerId === user?.id))
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];

  async function act(fn: () => Promise<unknown>, okMsg?: string) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (okMsg) toast.show(okMsg, 'ok');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{loft.name}</h1>
          <p className="muted">Welkom terug, {user?.username}! Hier is de stand van zaken.</p>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid cols-3" style={{ marginBottom: 18 }}>
        <div className="tile">
          <div className="tile-label">Kassa</div>
          <div className="tile-value"><Money value={loft.money} /></div>
        </div>
        <div className="tile">
          <div className="tile-label">Duiven</div>
          <div className="tile-value">
            {loft.pigeonCount}<span className="faint" style={{ fontSize: '0.95rem', fontWeight: 600 }}> / {loft.capacity}</span>
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Seizoenspunten</div>
          <div className="tile-value">
            {loft.seasonPoints}
            {myRank && <span className="faint" style={{ fontSize: '0.95rem', fontWeight: 600 }}> · #{myRank.rank}</span>}
          </div>
        </div>

        <Link to="/ziekenboeg" className="tile card-hover" style={{ display: 'block', color: 'inherit' }}>
          <div className="tile-label">Ziek / gewond</div>
          <div className="tile-value" style={{ color: needCare > 0 ? 'var(--bad)' : 'var(--good)' }}>
            {needCare}
          </div>
          <div className="faint" style={{ fontSize: '0.8rem' }}>
            {needCare > 0 ? '⚠️ actie nodig — naar ziekenboeg' : 'alles gezond 🎉'}
          </div>
        </Link>

        <Link to="/ziekenboeg" className="tile card-hover" style={{ display: 'block', color: 'inherit' }}>
          <div className="tile-label">In de ziekenboeg</div>
          <div className="tile-value">
            {loft.infirmaryCount}
            <span className="faint" style={{ fontSize: '0.95rem', fontWeight: 600 }}> / {loft.infirmaryCapacity}</span>
          </div>
          <div className="faint" style={{ fontSize: '0.8rem' }}>in verzorging</div>
        </Link>

        {myNextFlight ? (
          <Link to={`/vluchten/${myNextFlight.id}`} className="tile card-hover" style={{ display: 'block', color: 'inherit' }}>
            <div className="tile-label">
              Jouw volgende vlucht
              {myNextFlight.status === 'live' && (
                <span className="badge" style={{ marginLeft: 6, background: 'var(--accent)', color: '#fff' }}>🔴 LIVE</span>
              )}
            </div>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', marginTop: 2 }}>{myNextFlight.name}</div>
            <div className="faint" style={{ fontSize: '0.82rem' }}>{myNextFlight.fromCity} → {myNextFlight.toCity}</div>
            <div className="faint" style={{ fontSize: '0.82rem' }}>
              {myNextFlight.status === 'live'
                ? 'bezig — volg live →'
                : `${formatFlightTime(myNextFlight.startAt)} · ${countdownTo(myNextFlight.startAt, now)}`}
            </div>
          </Link>
        ) : (
          <div className="tile">
            <div className="tile-label">Jouw volgende vlucht</div>
            <div className="tile-value" style={{ fontSize: '1.05rem' }}>—</div>
            <div className="faint" style={{ fontSize: '0.8rem' }}>schrijf een duif in bij Vluchten</div>
          </div>
        )}
      </div>

      {/* Daily missions */}
      {state.missions.length > 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>🎯 Dagopdrachten</h2>
            <span className="chip week" title="Dagen op rij ingelogd">🔥 {state.streak} op rij</span>
          </div>
          <div className="stack" style={{ marginTop: 10, gap: 10 }}>
            {state.missions.map((m) => (
              <div key={m.key}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <span className={m.done ? 'faint' : ''}>{m.done ? '✅ ' : ''}{m.label}</span>
                  <span className="faint" style={{ flexShrink: 0, fontSize: '0.82rem' }}>
                    {m.progress}/{m.target} · +<Money value={m.rewardMoney} /> +{m.rewardXp}xp
                  </span>
                </div>
                <div className="bar" style={{ height: 7, marginTop: 3 }}>
                  <span style={{ width: `${Math.min(100, (m.progress / m.target) * 100)}%`, background: m.done ? 'var(--good)' : undefined }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid cols-2">
        {/* Care panel */}
        <div className="card">
          <h2>Verzorging</h2>
          <p className="muted" style={{ marginBottom: 10 }}>
            Voorraad voer: <strong>{loft.food.toLocaleString('nl-NL')} kg</strong> · gemiddelde energie <strong>{avgForm}</strong>
          </p>

          <label>Voer voor álle duiven ineens</label>
          <div className="pill-tabs" style={{ width: '100%', marginBottom: 10, flexWrap: 'wrap' }}>
            {(Object.keys(feedRations) as FeedRation[]).map((key) => (
              <button
                key={key}
                className={loft.feedRation === key ? 'active' : ''}
                style={{ flex: '1 0 30%' }}
                disabled={busy}
                onClick={() => act(() => api('/loft/ration', { method: 'POST', body: { ration: key } }), `Alle duiven op ${feedRations[key].label}`)}
              >
                {feedRations[key].label}
              </button>
            ))}
          </div>

          {/* Compact reference cards for each schema (wrap nicely on phones). */}
          <div className="ration-cards" style={{ marginBottom: 10 }}>
            {(Object.keys(feedRations) as FeedRation[]).map((key) => {
              const r = feedRations[key];
              return (
                <div key={key} className={`ration-card${loft.feedRation === key ? ' active' : ''}`}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                    <strong>{r.label}</strong>
                    <span className="faint">{r.foodPerPigeon} kg · <Money value={Math.round(r.foodPerPigeon * FOOD_PRICE * 10) / 10} /></span>
                  </div>
                  <div className="row" style={{ gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                    <span className="chip-mini good">⚡ +{r.formRecovery}</span>
                    <span className="chip-mini good">❤️‍🩹 +{r.healthRecovery}</span>
                    {r.enduranceRecovery > 0 && <span className="chip-mini good">💪 +{r.enduranceRecovery}</span>}
                    {r.libidoRecovery > 0 && <span className="chip-mini good">❤️ +{r.libidoRecovery}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="faint" style={{ margin: '0 0 12px', fontSize: '0.8rem' }}>
            Waarden per duif per week (energie · gezondheid · conditie · libido). Per duif kan je een eigen schema kiezen in <strong>Mijn hok</strong> of op de duifpagina. Te weinig voorraad: −8 energie & −6 gezondheid voor álle duiven.
          </p>

          <label>Voer bijkopen ({FOOD_PRICE} per kg)</label>
          <div className="row">
            <input
              type="number"
              min={1}
              value={buyKg}
              onChange={(e) => setBuyKg(Number(e.target.value))}
              style={{ maxWidth: 120 }}
            />
            <button
              className="btn"
              disabled={busy || buyKg <= 0}
              onClick={() => act(() => api('/loft/food', { method: 'POST', body: { kg: buyKg } }), `${buyKg} kg voer gekocht`)}
            >
              Kopen · <Money value={Math.round(buyKg * FOOD_PRICE)} />
            </button>
          </div>
        </div>

        {/* Upcoming flights */}
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Aankomende vluchten</h2>
            <Link to="/vluchten" className="btn ghost sm">Alles</Link>
          </div>
          {scheduledFlights.length === 0 && <p className="muted">Geen vluchten gepland. Kom straks terug!</p>}
          <div className="stack">
            {scheduledFlights.slice(0, 4).map((f) => (
              <Link
                key={f.id}
                to={f.status === 'live' ? `/vluchten/${f.id}` : '/vluchten'}
                className="card"
                style={{ padding: 12, boxShadow: 'none' }}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div className="row" style={{ gap: 6 }}>
                      <strong>{f.name}</strong>
                      {f.status === 'live' && <span className="badge" style={{ background: 'var(--accent)', color: '#fff' }}>🔴 LIVE</span>}
                    </div>
                    <div className="faint">{f.fromCity} → {f.toCity} · {f.distanceKm} km</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="faint">{formatFlightTime(f.startAt)}</div>
                    <div className="faint">{f.status === 'live' ? 'bezig' : countdownTo(f.startAt, now)}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Top pigeons */}
      <div className="page-head" style={{ marginTop: 22 }}>
        <h2>Toppers in je hok</h2>
        <Link to="/hok" className="btn ghost sm">Naar mijn hok</Link>
      </div>
      <div className="grid pigeons">
        {topPigeons.map((p) => (
          <PigeonCard key={p.id} pigeon={p} to={`/duif/${p.id}`} />
        ))}
        {topPigeons.length === 0 && <div className="card muted">Nog geen duiven.</div>}
      </div>

      {state.isAdmin && (
        <div className="card" style={{ marginTop: 18, borderStyle: 'dashed' }}>
          <strong>Beheerder</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Jij bent de spelleider. Vluchten, voeding (dagelijks) en broedsels lopen vanzelf in echte tijd. Gebruik
            <em> “Volgende week”</em> bovenaan om de vaste onkosten te verrekenen, ziekte/herstel/sterfte te verwerken
            en het seizoen te laten vorderen. Week {world.currentWeek}.
          </p>
        </div>
      )}
    </div>
  );
}
