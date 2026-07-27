/** Overview dashboard: loft at a glance, care controls and quick links. */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGame } from '../game/GameContext';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { Money, Spinner, useToast } from '../components/ui';
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
  const avgForm = pigeons.length ? Math.round(pigeons.reduce((s, p) => s + p.form, 0) / pigeons.length) : 0;

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
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="faint">Kassa</div>
          <div style={{ fontSize: '1.5rem' }}><Money value={loft.money} /></div>
        </div>
        <div className="card">
          <div className="faint">Duiven</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>
            {loft.pigeonCount}<span className="faint" style={{ fontSize: '0.9rem' }}> / {loft.capacity}</span>
          </div>
        </div>
        <div className="card">
          <div className="faint">Seizoenspunten</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>
            {loft.seasonPoints}
            {myRank && <span className="faint" style={{ fontSize: '0.9rem' }}> · #{myRank.rank}</span>}
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        {/* Care panel */}
        <div className="card">
          <h2>🌾 Verzorging</h2>
          <p className="muted" style={{ marginBottom: 10 }}>
            Voorraad voer: <strong>{loft.food.toLocaleString('nl-NL')} kg</strong> · gemiddelde conditie <strong>{avgForm}</strong>
          </p>

          <label>Voerschema</label>
          <div className="pill-tabs" style={{ width: '100%', marginBottom: 12 }}>
            {(Object.keys(feedRations) as FeedRation[]).map((key) => (
              <button
                key={key}
                className={loft.feedRation === key ? 'active' : ''}
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => act(() => api('/loft/ration', { method: 'POST', body: { ration: key } }))}
              >
                {feedRations[key].label}
              </button>
            ))}
          </div>

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
            <h2>🏁 Aankomende vluchten</h2>
            <Link to="/vluchten" className="btn ghost sm">Alles</Link>
          </div>
          {scheduledFlights.length === 0 && <p className="muted">Geen vluchten gepland deze week.</p>}
          <div className="stack">
            {scheduledFlights.map((f) => (
              <Link key={f.id} to="/vluchten" className="card" style={{ padding: 12, boxShadow: 'none' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong>{f.name}</strong>
                    <div className="faint">{f.distanceKm} km · {f.entryCount} ingeschreven</div>
                  </div>
                  <span className={`badge ${f.type}`}>{f.type === 'club' ? 'Club' : 'Nationaal'}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Top pigeons */}
      <div className="page-head" style={{ marginTop: 22 }}>
        <h2>⭐ Toppers in je hok</h2>
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
          <strong>👑 Beheerder</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Jij bent de spelleider. Gebruik <em>“Volgende week”</em> bovenaan om de week af te sluiten: dan worden alle
            vluchten gevlogen, duiven gevoerd en jongen geboren. Week {world.currentWeek}.
          </p>
        </div>
      )}
    </div>
  );
}
