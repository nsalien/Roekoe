/**
 * Beheer (admin-only console). A place to inspect the game's internals. The
 * first tool is the flight analysis: the full velocity breakdown per duif of a
 * completed flight, so you can see exactly which factor (snelheid, conditie,
 * energie, leeftijd, …) drove the ranking. Built to grow — add tabs below.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Spinner, formatFlightTime } from '../components/ui';

interface AdminFlight {
  id: string; name: string; fromCity: string; toCity: string; distanceKm: number;
  startAt: string; entrants: number; practice: boolean; titan: boolean;
}
interface Breakdown {
  weights: { speed: number; endurance: number; orientation: number };
  baseAttr: number; base: number;
  formFactor: number; healthFactor: number; experienceFactor: number; ageFactor: number; weatherFactor: number;
  velocityNoLuck: number;
}
interface Row {
  pigeonId: string; name: string; ownerName: string; mine: boolean; exists: boolean;
  speed: number | null; endurance: number | null; orientation: number | null;
  raceForm: number | null; currentForm: number | null; health: number | null; experience: number | null;
  ageWeeks: number | null; breakdown: Breakdown | null;
  frozenVelocity: number | null; residual: number | null;
  rank: number | null; finished: boolean | null; timeSeconds: number | null;
}
interface Analysis {
  flight: { id: string; name: string; fromCity: string; toCity: string; distanceKm: number; startAt: string; weather: string; weatherFactor: number; week: number; practice: boolean; titan: boolean };
  weights: { speed: number; endurance: number; orientation: number };
  rows: Row[];
}

export function AdminPage() {
  const { state } = useGame();
  const [tab, setTab] = useState<'flights'>('flights');

  if (!state) return <Spinner />;
  if (!state.isAdmin) return <Navigate to="/" replace />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🛠️ Beheer</h1>
          <p className="muted">Adminconsole — enkel voor jou zichtbaar.</p>
        </div>
        <div className="pill-tabs">
          <button className={tab === 'flights' ? 'active' : ''} onClick={() => setTab('flights')}>Vlucht-analyse</button>
        </div>
      </div>

      {tab === 'flights' && <FlightAnalysis />}
    </div>
  );
}

function num(n: number | null, d = 0): string {
  return n == null ? '—' : n.toFixed(d);
}

function FlightAnalysis() {
  const [flights, setFlights] = useState<AdminFlight[]>([]);
  const [sel, setSel] = useState('');
  const [data, setData] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ flights: AdminFlight[] }>('/admin/flights').then((r) => {
      setFlights(r.flights);
      if (r.flights[0]) setSel(r.flights[0].id);
    });
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      setData(await api<Analysis>(`/admin/flight-analysis/${id}`));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (sel) load(sel); }, [sel, load]);

  return (
    <div className="stack">
      <div className="card">
        <label>Kies een afgeronde vlucht</label>
        <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ maxWidth: '100%' }}>
          {flights.length === 0 && <option value="">— geen afgeronde vluchten —</option>}
          {flights.map((f) => (
            <option key={f.id} value={f.id}>
              {new Date(f.startAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              {' · '}{f.name}{f.titan ? ' 🏆' : f.practice ? ' 🌤️' : ''} · {f.fromCity} → {f.toCity} · {f.distanceKm} km · {f.entrants} duiven
            </option>
          ))}
        </select>
      </div>

      {loading && <Spinner />}

      {data && !loading && (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>{data.flight.name}</strong>{data.flight.titan ? ' 🏆' : data.flight.practice ? ' 🌤️' : ''}
                <div className="faint">{data.flight.fromCity} → {data.flight.toCity} · {data.flight.distanceKm} km · {formatFlightTime(data.flight.startAt)}</div>
              </div>
              <div className="faint" style={{ textAlign: 'right' }}>
                Weer: {data.flight.weather || '—'} (×{data.flight.weatherFactor})<br />
                Weging: snelheid <strong>{data.weights.speed.toFixed(2)}</strong> · conditie <strong>{data.weights.endurance.toFixed(2)}</strong> · oriëntatie <strong>{data.weights.orientation.toFixed(2)}</strong>
              </div>
            </div>
            <p className="faint" style={{ fontSize: '0.82rem', marginBottom: 0 }}>
              De eigenschappen komen uit de <em>huidige</em> staat van de duif; <strong>energie</strong> is de waarde bij
              de start van de vlucht. <strong>v (berekend)</strong> = basis × alle factoren (zonder geluk);
              <strong> v (echt)</strong> is de bevroren racesnelheid. <strong>Residu</strong> ≈ het geluk (×0.9–1.1) van die duif
              (plus eventuele eigenschap-drift sinds de vlucht). De rangschikking volgt de echte snelheid.
            </p>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>#</th><th>Duif</th><th>Hok</th>
                    <th className="num">Snel</th><th className="num">Cond</th><th className="num">Oriÿ</th>
                    <th className="num">En*</th><th className="num">Gez</th><th className="num">Erv</th><th className="num">Lft</th>
                    <th className="num">Basis</th>
                    <th className="num">En×</th><th className="num">Gez×</th><th className="num">Erv×</th><th className="num">Lft×</th>
                    <th className="num">v (ber.)</th><th className="num">v (echt)</th><th className="num">Residu</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const b = r.breakdown;
                    return (
                      <tr key={r.pigeonId} className={r.mine ? 'me' : r.rank === 1 ? 'podium-1' : ''}>
                        <td>{r.finished === false ? '—' : r.rank ?? '—'}</td>
                        <td>
                          {r.exists ? <Link to={`/duif/${r.pigeonId}`} style={{ color: 'inherit' }}>{r.name}</Link> : r.name}
                          {r.mine && <span className="badge club" style={{ marginLeft: 6 }}>jij</span>}
                          {r.finished === false && <span className="faint"> · DNF</span>}
                        </td>
                        <td className="faint">{r.ownerName}</td>
                        <td className="num"><strong>{num(r.speed)}</strong></td>
                        <td className="num">{num(r.endurance)}</td>
                        <td className="num">{num(r.orientation)}</td>
                        <td className="num">{num(r.raceForm)}</td>
                        <td className="num">{num(r.health)}</td>
                        <td className="num">{num(r.experience)}</td>
                        <td className="num">{num(r.ageWeeks)}</td>
                        <td className="num">{b ? b.baseAttr.toFixed(1) : '—'}</td>
                        <td className="num">{b ? b.formFactor.toFixed(2) : '—'}</td>
                        <td className="num">{b ? b.healthFactor.toFixed(2) : '—'}</td>
                        <td className="num">{b ? b.experienceFactor.toFixed(2) : '—'}</td>
                        <td className="num">{b ? b.ageFactor.toFixed(2) : '—'}</td>
                        <td className="num">{b ? b.velocityNoLuck.toFixed(0) : '—'}</td>
                        <td className="num"><strong>{r.frozenVelocity != null ? r.frozenVelocity.toFixed(0) : '—'}</strong></td>
                        <td className="num">{r.residual != null ? r.residual.toFixed(3) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
