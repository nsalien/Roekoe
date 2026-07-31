/** Overview dashboard: loft at a glance, care controls and quick links. */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGame } from '../game/GameContext';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { Money, Spinner, countdownTo, formatFlightTime, useToast } from '../components/ui';
import { PigeonCard } from '../components/PigeonCard';
import type { FeedRation } from '../types';

/** Weekly config figure → per-day, rounded to 1 decimal (feed is applied 1/7 daily). */
function perDay(weekly: number): number {
  return Math.round((weekly / 7) * 10) / 10;
}

export function DashboardPage() {
  const { state, loading, refresh } = useGame();
  const { user } = useAuth();
  const toast = useToast();
  const [buyKg, setBuyKg] = useState(50);
  const [buyType, setBuyType] = useState<FeedRation>('normal');
  const [busy, setBusy] = useState(false);

  if (loading || !state) return <Spinner />;
  const { loft, pigeons, world, rankings, scheduledFlights, feedRations } = state;
  if (!loft) return <div className="card">Geen hok gevonden.</div>;

  const myRank = rankings.find((r) => r.userId === user?.id);
  const topPigeons = pigeons.slice(0, 3);
  const now = Date.now();
  const avgForm = pigeons.length ? Math.round(pigeons.reduce((s, p) => s + p.form, 0) / pigeons.length) : 0;
  const coachedCount = pigeons.filter((p) => p.coached).length;
  const eco = state.economy;
  const weeklyFixed = eco.weeklyUpkeepBase + pigeons.length * eco.weeklyUpkeepPerPigeon + coachedCount * eco.coachSalary;
  // How many pigeons eat each food type, and which types are running out.
  const rationCounts = { normal: 0, premium: 0, libido: 0, herstel: 0 } as Record<FeedRation, number>;
  for (const p of pigeons) rationCounts[p.ration] = (rationCounts[p.ration] ?? 0) + 1;
  const weekNeed = (k: FeedRation) => feedRations[k].foodPerPigeon * rationCounts[k];
  const hungry = (Object.keys(feedRations) as FeedRation[]).filter((k) => rationCounts[k] > 0 && (loft.food[k] ?? 0) < weekNeed(k));

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
          <div className="tile-label">Ziek/gewond in je hok</div>
          <div className="tile-value" style={{ color: needCare > 0 ? 'var(--bad)' : 'var(--good)' }}>
            {needCare}
          </div>
          <div className="faint" style={{ fontSize: '0.8rem' }}>
            {needCare > 0 ? '⚠️ actie nodig — naar ziekenboeg' : 'niets in je hok (buiten de ziekenboeg) 🎉'}
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
        <div className="card" style={{ marginBottom: 18 }} data-tour="missions">
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
          <p className="muted" style={{ marginBottom: 6 }}>
            Gemiddelde energie <strong>{avgForm}</strong>. Voedsel wordt <strong>per type apart</strong> beheerd — elke duif eet van haar eigen type (in te stellen bij <strong>Mijn hok</strong>).
          </p>
          <p className="faint" style={{ marginBottom: 10, fontSize: '0.82rem' }}>
            Vaste weekkost: <strong><Money value={weeklyFixed} /></strong> (onderhoud
            {coachedCount > 0 ? ` + ${coachedCount} coach${coachedCount === 1 ? '' : 'es'}` : ''}) — exclusief voer & ziekenboeg.
          </p>

          {hungry.length > 0 && (
            <p className="notice err" style={{ margin: '0 0 10px' }}>
              ⚠️ Te weinig voorraad: {hungry.map((k) => `${feedRations[k].label} (${rationCounts[k]} ${rationCounts[k] === 1 ? 'duif' : 'duiven'})`).join(', ')} — koop bij of die duiven blijven onvoerd.
            </p>
          )}

          {/* Per-type stock + who eats it + effects. */}
          <div className="ration-cards" style={{ marginBottom: 10 }} data-tour="feed">
            {(Object.keys(feedRations) as FeedRation[]).map((key) => {
              const r = feedRations[key];
              const stock = loft.food[key] ?? 0;
              const low = rationCounts[key] > 0 && stock < weekNeed(key);
              return (
                <div key={key} className="ration-card" style={low ? { borderColor: 'var(--bad)' } : undefined}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                    <strong>{r.label}</strong>
                    <span className={low ? 'bad' : 'faint'}>{Math.round(stock * 10) / 10} kg{low ? ' ⚠️' : ''}</span>
                  </div>
                  <div className="faint" style={{ fontSize: '0.75rem', marginTop: 1 }}>
                    {rationCounts[key]} {rationCounts[key] === 1 ? 'duif' : 'duiven'} · {perDay(r.foodPerPigeon)} kg/dag · <Money value={r.pricePerKg} />/kg
                  </div>
                  <div className="row" style={{ gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                    <span className="chip-mini good">energie +{perDay(r.formRecovery)}</span>
                    <span className="chip-mini good">gezondheid +{perDay(r.healthRecovery)}</span>
                    {r.enduranceRecovery > 0 && <span className="chip-mini good">conditie +{perDay(r.enduranceRecovery)}</span>}
                    {r.libidoRecovery > 0 && <span className="chip-mini good">libido +{perDay(r.libidoRecovery)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="faint" style={{ margin: '0 0 12px', fontSize: '0.8rem' }}>
            Waarden per duif per <strong>dag</strong> (energie · gezondheid · conditie · libido). Geen voorraad van een type = die duiven lijden honger (−energie, −gezondheid, −conditie & −libido, oplopend tot de dood).
          </p>

          <label>Voer bijkopen</label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <select value={buyType} onChange={(e) => setBuyType(e.target.value as FeedRation)} style={{ width: 'auto' }}>
              {(Object.keys(feedRations) as FeedRation[]).map((key) => (
                <option key={key} value={key}>{feedRations[key].label} (€{feedRations[key].pricePerKg}/kg)</option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={buyKg}
              onChange={(e) => setBuyKg(Number(e.target.value))}
              style={{ maxWidth: 90 }}
            />
            <button
              className="btn"
              disabled={busy || buyKg <= 0}
              onClick={() => act(() => api('/loft/food', { method: 'POST', body: { type: buyType, kg: buyKg } }), `${buyKg} kg ${feedRations[buyType].label} gekocht`)}
            >
              Kopen · <Money value={Math.round(buyKg * feedRations[buyType].pricePerKg)} />
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
          <AdminAuctions />
        </div>
      )}
    </div>
  );
}

interface AdminAuctionRow {
  id: string;
  kind: 'sunday' | 'shelter';
  pigeonName: string;
  status: 'scheduled' | 'live' | 'completed' | 'open' | 'closed';
  startAt: string;
  endAt: string;
  bidCount: number;
  humanBidCount: number;
  bids: { name: string; amount: number; human: boolean }[];
  outcome: string;
}

/** Admin-only: recent auctions with the full bid list, so the spelleider can
 *  see who bid (or if only one person did) and where a pigeon ended up. */
function AdminAuctions() {
  const toast = useToast();
  const [rows, setRows] = useState<AdminAuctionRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const res = await api<{ auctions: AdminAuctionRow[] }>('/admin/auctions');
      setRows(res.auctions);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button className="btn ghost sm" disabled={busy} onClick={load}>
        🔨 Toon recente veilingen (wie bood wat)
      </button>
      {rows && rows.length === 0 && <p className="muted" style={{ marginTop: 8 }}>Geen veilingen in het systeem.</p>}
      {rows && rows.length > 0 && (
        <div className="stack" style={{ marginTop: 10, gap: 10 }}>
          {rows.map((a) => (
            <div key={a.id} className="card" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong>{a.kind === 'sunday' ? '🔨 Zondagveiling' : '🏠 Opvangcentrum'} · {a.pigeonName}</strong>
                <span className="faint">{formatFlightTime(a.endAt)}</span>
              </div>
              <div className="faint" style={{ fontSize: '0.85rem', marginTop: 2 }}>
                {a.status === 'open' ? 'Loopt nog' : 'Gesloten'} · {a.bidCount} bod(en), waarvan {a.humanBidCount} van echte spelers
              </div>
              {a.bids.length === 0 ? (
                <p className="muted" style={{ margin: '6px 0 0' }}>Niemand heeft geboden.</p>
              ) : (
                <table className="data" style={{ marginTop: 6 }}>
                  <tbody>
                    {a.bids.map((b, i) => (
                      <tr key={i}>
                        <td>{b.human ? '🧑 ' : '🤖 '}{b.name}</td>
                        <td className="num"><Money value={b.amount} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="faint" style={{ fontSize: '0.85rem', marginTop: 6 }}>Uitslag: {a.outcome}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
