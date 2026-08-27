/** Overview dashboard: loft at a glance, care controls and quick links. */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGame } from '../game/GameContext';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { Money, Spinner, countdownTo, formatFlightTime, nextPlayWeek, timeUntil, useToast } from '../components/ui';
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
  /** The feed counter works both ways: buy at the list price, sell back below it. */
  const [foodMode, setFoodMode] = useState<'buy' | 'sell'>('buy');
  const [busy, setBusy] = useState(false);
  const [showCosts, setShowCosts] = useState(false);

  if (loading || !state) return <Spinner />;
  const { loft, pigeons, world, rankings, scheduledFlights, feedRations } = state;
  if (!loft) return <div className="card">Geen hok gevonden.</div>;

  const myRank = rankings.find((r) => r.userId === user?.id);
  const topPigeons = pigeons.slice(0, 3);
  const now = Date.now();
  const avgForm = pigeons.length ? Math.round(pigeons.reduce((s, p) => s + (p.form ?? 0), 0) / pigeons.length) : 0;
  const eco = state.economy;
  const inf = state.infirmary;
  // Feed counter (buy/sell). The resale rate is deliberately < 1, so selling back
  // always costs a little — see FOOD_RESALE_RATE in gameConfig.
  const selling = foodMode === 'sell';
  const resaleRate = eco.foodResaleRate ?? 0.8;
  const foodStock = loft.food[buyType] ?? 0;
  const sellValue = Math.round(buyKg * feedRations[buyType].pricePerKg * resaleRate);
  // Full cumulative daily-cost breakdown (from the loft DTO, same source as what
  // is actually deducted each day). Each row: label, count context, and amount.
  const costs = loft.dailyCosts;
  // Per-pigeon upkeep is charged in progressive bands (duif 1–8 goedkoop, daarna
  // duurder). One row per band the loft actually fills, so the numbers add up
  // visibly; a loft that stays within the first band still sees a single row.
  const bands = costs.upkeepBands ?? [];
  const bandRows = bands.length
    ? bands.map((b) => ({
        key: `band-${b.from}`,
        label: bands.length === 1 ? 'Onderhoud per duif' : `Onderhoud duif ${b.from}–${b.to}`,
        detail: `${b.birds} × `,
        unit: b.perPigeon,
        amount: b.amount,
      }))
    : [
        {
          key: 'perPigeon',
          label: 'Onderhoud per duif',
          detail: `${loft.pigeonCount} × `,
          unit: eco.dailyUpkeepPerPigeon,
          amount: costs.upkeepPerPigeon,
        },
      ];
  const costRows = [
    { key: 'base', label: 'Vast onderhoud', detail: 'basiskost van je hok', amount: costs.upkeepBase },
    ...bandRows,
    { key: 'coach', label: 'Privécoach', detail: `${loft.coachedCount} × `, unit: eco.coachSalary, amount: costs.coaches },
    { key: 'doctor', label: 'Duivendokter', detail: `${loft.doctors} × `, unit: inf.doctorSalary, amount: costs.doctors },
    { key: 'physio', label: 'Kinesist', detail: `${loft.physios} × `, unit: inf.physioSalary, amount: costs.physios },
    { key: 'medfeed', label: 'Medicatievoer', detail: loft.medicatedFood ? `${loft.infirmaryCount} × ` : 'uit', unit: loft.medicatedFood ? inf.medicatedFoodPerBird : undefined, amount: costs.medicatedFeed },
  ];
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

        {/* Full-width so the (otherwise odd) tile count fills two clean rows above. */}
        <div
          className="tile card-hover"
          role="button"
          tabIndex={0}
          aria-expanded={showCosts}
          onClick={() => setShowCosts((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowCosts((v) => !v);
            }
          }}
          style={{ gridColumn: '1 / -1', cursor: 'pointer' }}
          data-tour="daily-costs"
        >
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div className="tile-label">Dagbalans</div>
              {/* Costs AND sponsor income run on the same daily clock, so the
                  headline number is what your loft actually nets per day. */}
              <div className="tile-value" style={{ color: costs.net >= 0 ? 'var(--good)' : 'var(--bad)' }}>
                {costs.net >= 0 ? '+' : '−'}<Money value={Math.abs(costs.net)} />
              </div>
              <div className="faint" style={{ fontSize: '0.8rem' }}>
                −<Money value={costs.total} /> kosten
                {costs.sponsorTotal > 0 && <> · +<Money value={costs.sponsorTotal} /> sponsors</>}
              </div>
            </div>
            <div className="faint" style={{ fontSize: '0.85rem' }}>
              {showCosts ? '▲ verberg onderverdeling' : '▼ klik voor de onderverdeling'}
            </div>
          </div>
        </div>
      </div>

      {/* Daily-cost breakdown (toggled by the "Dagelijkse kosten" tile) */}
      {showCosts && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>💶 Dagbalans</h2>
            <button className="btn ghost sm" onClick={() => setShowCosts(false)}>Sluiten</button>
          </div>
          <p className="faint" style={{ margin: '4px 0 10px', fontSize: '0.82rem' }}>
            Elke dag automatisch verrekend. Voer, prijzengeld en podiumpremies staan hier niet in.{' '}
            <Link to="/wiki#hok">Meer over de onderhoudskosten →</Link>
          </p>
          {/* Flex rows (not a table) so it fits narrow phones: the label/detail on
              the left may wrap/shrink, the amount on the right stays put — no
              horizontal scroll. */}
          <div>
            {costRows.map((r) => (
              <div
                key={r.key}
                className={r.amount <= 0 ? 'faint' : undefined}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}
              >
                <div style={{ minWidth: 0 }}>
                  <div>{r.label}</div>
                  <div className="faint" style={{ fontSize: '0.8rem' }}>
                    {r.detail}
                    {r.unit !== undefined && <Money value={r.unit} />}
                    {r.unit !== undefined ? '/dag' : ''}
                  </div>
                </div>
                <div className="num" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>−<Money value={r.amount} /></div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '10px 0', borderTop: '2px solid var(--border)', fontWeight: 700 }}>
              <div>Totaal kosten</div>
              <div className="num" style={{ whiteSpace: 'nowrap', flexShrink: 0, color: 'var(--bad)' }}>−<Money value={costs.total} /></div>
            </div>

            {/* Income side: what your sponsors put in every single day. */}
            <div style={{ paddingTop: 6 }}>
              <div className="faint" style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Inkomsten</div>
              {costs.sponsors.length === 0 && (
                <div className="faint" style={{ padding: '8px 0', fontSize: '0.85rem' }}>
                  Nog geen sponsors. Een goede uitslag trekt er vanzelf een aan.
                </div>
              )}
              {costs.sponsors.map((s) => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ minWidth: 0 }}>{s.icon} {s.name}</div>
                  <div className="num" style={{ whiteSpace: 'nowrap', flexShrink: 0, color: 'var(--good)' }}>+<Money value={s.amount} /></div>
                </div>
              ))}
              {costs.sponsors.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '10px 0', borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                  <div>Totaal sponsors</div>
                  <div className="num" style={{ whiteSpace: 'nowrap', flexShrink: 0, color: 'var(--good)' }}>+<Money value={costs.sponsorTotal} /></div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '10px 0 0', borderTop: '2px solid var(--border)', fontWeight: 800 }}>
              <div style={{ minWidth: 0 }}>
                <div>Netto per dag</div>
                <div className="faint" style={{ fontSize: '0.8rem', fontWeight: 400 }}>
                  ≈ {costs.net >= 0 ? '+' : '−'}<Money value={Math.abs(costs.net) * 7} />/week
                </div>
              </div>
              <div className="num" style={{ whiteSpace: 'nowrap', flexShrink: 0, color: costs.net >= 0 ? 'var(--good)' : 'var(--bad)' }}>
                {costs.net >= 0 ? '+' : '−'}<Money value={Math.abs(costs.net)} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Season / next play-week */}
      {world.seasonStartedAt && (() => {
        const nw = nextPlayWeek(world.seasonStartedAt, world.seasonWeek);
        return (
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <strong>📅 Seizoen {world.seasonYear} · week {world.seasonWeek}/4</strong>
                <div className="faint" style={{ fontSize: '0.85rem' }}>
                  {nw.isNewSeason
                    ? <>Einde van het seizoen en prijsuitreiking — daarna start week 1 van seizoen {world.seasonYear + 1}.</>
                    : <>Elke speelweek duurt 7 dagen. Op het einde van week 4 volgt de prijsuitreiking.</>}
                </div>
              </div>
              <span
                className="badge"
                style={{ background: 'var(--brand-soft)', color: 'var(--brand-ink)', whiteSpace: 'nowrap' }}
                title={nw.isNewSeason ? 'Tot het nieuwe seizoen' : `Tot speelweek ${nw.weekNum}`}
              >
                {nw.isNewSeason ? '🎉 Nieuw seizoen' : `⏭️ Week ${nw.weekNum}`} · {timeUntil(nw.at)}
              </span>
            </div>
          </div>
        );
      })()}

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
          {/* Keep this to the state of the loft + the buy control. The how-it-works
              (per-type stock, honger, rustbonus) sits in the wiki; the daily money
              side already has its own Dagbalans tile above. */}
          <p className="muted" style={{ marginBottom: 8 }}>
            Gemiddelde energie <strong>{avgForm}</strong> · elke duif eet van <strong>haar eigen voertype</strong>.
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
            Waarden per duif per <strong>dag</strong>. Voorraad op = honger.{' '}
            <Link to="/wiki#energie">Meer over voer, honger &amp; rust →</Link>
          </p>

          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <label style={{ margin: 0 }}>{selling ? 'Voer verkopen' : 'Voer bijkopen'}</label>
            <div className="row" style={{ gap: 4 }}>
              <button
                className={`btn sm ${selling ? 'ghost' : ''}`}
                disabled={busy}
                onClick={() => setFoodMode('buy')}
              >
                Kopen
              </button>
              <button
                className={`btn sm ${selling ? '' : 'ghost'}`}
                disabled={busy}
                onClick={() => setFoodMode('sell')}
              >
                Verkopen
              </button>
            </div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <select value={buyType} onChange={(e) => setBuyType(e.target.value as FeedRation)} style={{ width: 'auto' }}>
              {(Object.keys(feedRations) as FeedRation[]).map((key) => (
                <option key={key} value={key}>
                  {feedRations[key].label} (€{selling ? Math.round(feedRations[key].pricePerKg * resaleRate * 100) / 100 : feedRations[key].pricePerKg}/kg)
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={buyKg}
              onChange={(e) => setBuyKg(Number(e.target.value))}
              style={{ maxWidth: 90 }}
            />
            {selling && (
              <button
                className="btn ghost sm"
                disabled={busy || foodStock <= 0}
                onClick={() => setBuyKg(Math.round(foodStock * 10) / 10)}
                title="Verkoop je hele voorraad van dit type"
              >
                Alles ({Math.round(foodStock * 10) / 10} kg)
              </button>
            )}
            {selling ? (
              <button
                className="btn"
                disabled={busy || buyKg <= 0 || buyKg > foodStock}
                onClick={() => act(
                  () => api('/loft/food/sell', { method: 'POST', body: { type: buyType, kg: buyKg } }),
                  `${buyKg} kg ${feedRations[buyType].label} verkocht`,
                )}
              >
                Verkopen · <Money value={sellValue} />
              </button>
            ) : (
              <button
                className="btn"
                disabled={busy || buyKg <= 0}
                onClick={() => act(() => api('/loft/food', { method: 'POST', body: { type: buyType, kg: buyKg } }), `${buyKg} kg ${feedRations[buyType].label} gekocht`)}
              >
                Kopen · <Money value={Math.round(buyKg * feedRations[buyType].pricePerKg)} />
              </button>
            )}
          </div>
          {selling && (
            <p className="faint" style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>
              De voerhandelaar betaalt <strong>{Math.round(resaleRate * 100)}%</strong> van de aankoopprijs terug — op
              voer verkopen verlies je dus altijd een beetje.
              {buyKg > foodStock && (
                <> Je hebt maar <strong>{Math.round(foodStock * 10) / 10} kg</strong> {feedRations[buyType].label}.</>
              )}
            </p>
          )}
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
            Alles loopt dagelijks vanzelf. <em>“Volgende week”</em> verwerkt enkel nog ziekte/sterfte. Week {world.currentWeek}.
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
