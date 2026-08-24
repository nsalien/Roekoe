/**
 * Beheer (admin-only console). A place to inspect the game's internals. The
 * first tool is the flight analysis: the full velocity breakdown per duif of a
 * completed flight, so you can see exactly which factor (snelheid, conditie,
 * energie, leeftijd, …) drove the ranking. Built to grow — add tabs below.
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
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
  baseAttr: number; base: number; effectiveForm: number;
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
  const [tab, setTab] = useState<'flights' | 'pigeons'>('flights');

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
          <button className={tab === 'pigeons' ? 'active' : ''} onClick={() => setTab('pigeons')}>Duif-inspector</button>
        </div>
      </div>

      {tab === 'flights' && <FlightAnalysis />}
      {tab === 'pigeons' && <PigeonInspector />}
    </div>
  );
}

function num(n: number | null, d = 0): string {
  return n == null ? '—' : n.toFixed(d);
}

interface InspectGenes { speed: number; endurance: number; orientation: number }
interface AttrChange { attr: string; from: number; to: number; reason: string; at: string }
interface InspectPigeon {
  id: string; name: string; ownerName: string; isBot: boolean; sex: string;
  birthWeek: number; currentWeek: number; ageWeeks: number;
  speed: number; endurance: number; orientation: number;
  libido: number; form: number; health: number; experience: number;
  genes: InspectGenes | null; declineRate: number | null;
  aging: boolean; declinePerWeek: number;
  atGeneCap: { speed: boolean; endurance: boolean; orientation: boolean } | null;
  attrLog: AttrChange[];
}

const ATTR_NL: Record<string, string> = { speed: 'snelheid', endurance: 'conditie', orientation: 'oriëntatie' };
interface InspectResp {
  pigeons: InspectPigeon[]; total: number;
  caps: { train: number; race: number; ceil: number; peakEndWeeks: number };
}

/**
 * Duif-inspector: look up any pigeon's EXACT stored values (1 decimal), gene caps
 * and ageing status — so you can verify a bird isn't unfairly degrading. A skill
 * only declines with age once the bird is past the peak age (peakEndWeeks); the
 * "Veroudert" column shows exactly that, plus how much it loses per rolled week.
 */
function PigeonInspector() {
  const [q, setQ] = useState('');
  const [resp, setResp] = useState<InspectResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      setResp(await api<InspectResp>(`/admin/pigeons${query ? `?q=${encodeURIComponent(query)}` : ''}`));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(''); }, [load]);
  // Debounce the search so typing doesn't hammer the API.
  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q, load]);

  const peak = resp?.caps.peakEndWeeks ?? 208;
  const cap = (v: number, atCap: boolean | undefined) => (
    <span>{v.toFixed(1)}{atCap ? <span className="badge" style={{ marginLeft: 4 }}>cap</span> : null}</span>
  );

  return (
    <div className="stack">
      <div className="card">
        <label>Zoek een duif (op naam of hoknaam) — leeg = alle duiven</label>
        <input
          type="text"
          value={q}
          placeholder="bv. Tinne"
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: '100%' }}
        />
        <p className="faint" style={{ fontSize: '0.82rem', marginBottom: 0 }}>
          Exacte opgeslagen waarden (op 0,1) + gen-caps. <strong>Veroudert</strong> staat op "ja" vanaf {peak} weken —
          alleen dán kan een vaardigheid door leeftijd zakken. Klik een naam voor de volledige duifpagina.
        </p>
      </div>

      {loading && <Spinner />}

      {resp && !loading && (
        <div className="card">
          <div className="faint" style={{ marginBottom: 8 }}>
            {resp.total} duif/duiven gevonden{resp.total > resp.pigeons.length ? ` (eerste ${resp.pigeons.length} getoond)` : ''}.
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Duif</th><th>Hok</th><th className="num">Lft (wk)</th>
                  <th className="num">Snel</th><th className="num">Cond</th><th className="num">Oriÿ</th>
                  <th className="num">Libido</th><th className="num">Energie</th><th className="num">Gez</th><th className="num">Erv</th>
                  <th>Genen (cap)</th><th className="num">Verval/wk</th><th>Veroudert</th><th>Log</th>
                </tr>
              </thead>
              <tbody>
                {resp.pigeons.map((p) => (
                  <Fragment key={p.id}>
                    <tr className={p.aging ? 'podium-1' : ''}>
                      <td>
                        <Link to={`/duif/${p.id}`} style={{ color: 'inherit' }}>{p.name}</Link>
                        {p.isBot && <span className="faint"> · bot</span>}
                      </td>
                      <td className="faint">{p.ownerName}</td>
                      <td className="num">{p.ageWeeks}</td>
                      <td className="num"><strong>{cap(p.speed, p.atGeneCap?.speed)}</strong></td>
                      <td className="num">{cap(p.endurance, p.atGeneCap?.endurance)}</td>
                      <td className="num">{cap(p.orientation, p.atGeneCap?.orientation)}</td>
                      <td className="num">{p.libido.toFixed(1)}</td>
                      <td className="num">{p.form.toFixed(1)}</td>
                      <td className="num">{p.health.toFixed(1)}</td>
                      <td className="num">{p.experience.toFixed(1)}</td>
                      <td className="faint">{p.genes ? `${p.genes.speed}/${p.genes.endurance}/${p.genes.orientation}` : '—'}</td>
                      <td className="num">{p.aging ? p.declinePerWeek.toFixed(3) : '0'}</td>
                      <td>
                        {p.aging
                          ? <span style={{ color: 'var(--bad)', fontWeight: 700 }}>ja (&gt;{peak} wk)</span>
                          : <span className="faint">nee</span>}
                      </td>
                      <td>
                        <button className="btn ghost sm" onClick={() => toggle(p.id)}>
                          📜 {p.attrLog.length}{open.has(p.id) ? ' ▲' : ' ▼'}
                        </button>
                      </td>
                    </tr>
                    {open.has(p.id) && (
                      <tr>
                        <td colSpan={14} style={{ background: 'var(--surface-2, rgba(127,127,127,0.06))' }}>
                          {p.attrLog.length === 0 ? (
                            <span className="faint">Nog geen geregistreerde wijzigingen aan snelheid/conditie/oriëntatie voor deze duif
                              {' '}(het logboek startte bij de uitrol — oudere veranderingen zijn niet bewaard).</span>
                          ) : (
                            <div className="stack" style={{ gap: 3 }}>
                              <div className="faint" style={{ fontSize: '0.8rem' }}>Wijzigingsgeschiedenis (nieuwste eerst):</div>
                              {p.attrLog.map((e, i) => {
                                const down = e.to < e.from;
                                return (
                                  <div key={i} style={{ fontSize: '0.84rem' }}>
                                    <span className="faint">{formatFlightTime(e.at)}</span>{' · '}
                                    <strong>{ATTR_NL[e.attr] ?? e.attr}</strong>{' '}
                                    {e.from.toFixed(1)} <span style={{ color: down ? 'var(--bad)' : 'var(--good, #2e9e5b)', fontWeight: 700 }}>→ {e.to.toFixed(1)}</span>
                                    {' '}<span className="faint">({e.reason})</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
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
              De eigenschappen komen uit de <em>huidige</em> staat van de duif; <strong>En*</strong> is de energie bij de
              start van de vlucht. <strong>En(eff)</strong> = de energie ná ervarings-dosering (een ervaren duif presteert
              alsof ze meer energie heeft); <strong>En×</strong> wordt daaruit berekend en weegt zwaarder op langere
              vluchten. <strong>v (ber.)</strong> = basis × alle factoren (zonder geluk); <strong>v (echt)</strong> is de
              bevroren racesnelheid. <strong>Residu</strong> ≈ het geluk (×0.9–1.1) van die duif (plus eigenschap-drift
              sinds de vlucht). De rangschikking volgt de echte snelheid.
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
                    <th className="num">En(eff)</th><th className="num">En×</th><th className="num">Gez×</th><th className="num">Erv×</th><th className="num">Lft×</th>
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
                        <td className="num">{b ? b.effectiveForm.toFixed(0) : '—'}</td>
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
