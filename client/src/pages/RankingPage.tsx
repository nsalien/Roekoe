/** Ranglijst: seizoensstand van de melkers + drie duivenrangschikkingen. */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGame } from '../game/GameContext';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/ui';
import type { PigeonRankRow } from '../types';

/** Days/hours remaining until an ISO instant, as a short Dutch string. */
function timeLeft(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'seizoen loopt af…';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days >= 1) return `nog ${days} dag${days === 1 ? '' : 'en'}`;
  if (hours >= 1) return `nog ${hours} uur`;
  return 'nog minder dan een uur';
}

export function RankingPage() {
  const { state, loading } = useGame();
  const { user } = useAuth();
  const [tab, setTab] = useState<'melkers' | 'duiven'>('melkers');
  if (loading || !state) return <Spinner />;

  const { seasonYear, seasonWeek, seasonEndsAt } = state.world;
  const seasonWeeks = 4;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Ranglijst</h1>
          <p className="muted">
            Seizoen {seasonYear} · week {seasonWeek}/{seasonWeeks}
            {seasonEndsAt && <> · {timeLeft(seasonEndsAt)}</>}
          </p>
        </div>
        <div className="pill-tabs">
          <button className={tab === 'melkers' ? 'active' : ''} onClick={() => setTab('melkers')}>Melkers</button>
          <button className={tab === 'duiven' ? 'active' : ''} onClick={() => setTab('duiven')}>Duiven</button>
        </div>
      </div>

      {tab === 'melkers' ? (
        <>
          <div className="card">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>#</th><th>Hok</th><th className="num">Lvl</th><th className="num">Punten</th><th className="num">Winst</th><th className="num">Duiven</th>
                  </tr>
                </thead>
                <tbody>
                  {state.rankings.map((r) => (
                    <tr key={r.userId} className={r.userId === user?.id ? 'me' : r.rank === 1 ? 'podium-1' : ''}>
                      <td>{r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank}</td>
                      <td>
                        {r.name} {r.isBot && <span className="badge bot">bot</span>}
                        {r.userId === user?.id && <span className="badge club" style={{ marginLeft: 6 }}>jij</span>}
                      </td>
                      <td className="num"><span className="level-badge sm">Lvl {r.level}</span></td>
                      <td className="num"><strong>{r.seasonPoints}</strong></td>
                      <td className="num">{r.totalWins}</td>
                      <td className="num">{r.pigeonCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="faint" style={{ marginTop: 10 }}>
            🏆 Op het einde van het seizoen winnen de top 3 <strong>de Gouden, Zilveren en Bronzen Roekoe</strong>
            {' '}(€2000 / €1500 / €1000). Daarna reset de ranglijst.
          </p>
        </>
      ) : (
        <div className="stack">
          <PigeonRankCard
            title="⚡ Snelste duiven"
            subtitle="Hoogste pieksnelheid dit seizoen"
            unit="km/u"
            rows={state.pigeonRankings.fastest}
            meId={user?.id}
          />
          <PigeonRankCard
            title="🎖️ Meeste podiums"
            subtitle="Aantal top-3-plaatsen dit seizoen"
            unit="×"
            rows={state.pigeonRankings.podiums}
            meId={user?.id}
          />
          <PigeonRankCard
            title="📈 Meeste vooruitgang"
            subtitle="Grootste algemene groei dit seizoen"
            unit="+"
            rows={state.pigeonRankings.progress}
            meId={user?.id}
          />
          <p className="faint">
            🪽 Op het einde van het seizoen winnen de top 3 van elke rangschikking <strong>de Gouden, Zilveren en
            Bronzen Vleugel</strong> (€1000 / €750 / €500 voor de eigenaar).
          </p>
        </div>
      )}
    </div>
  );
}

function PigeonRankCard({
  title, subtitle, unit, rows, meId,
}: {
  title: string;
  subtitle: string;
  unit: string;
  rows: PigeonRankRow[];
  meId?: string;
}) {
  const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank);
  const fmt = (v: number) => (unit === '+' ? `+${v}` : unit === '×' ? `${v}×` : `${v} ${unit}`);
  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="faint">{subtitle}</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="muted">Nog geen resultaten dit seizoen.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>#</th><th>Duif</th><th>Hok</th><th className="num">{unit === '×' ? 'Podiums' : unit === '+' ? 'Groei' : 'Snelheid'}</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.pigeonId} className={r.ownerId === meId ? 'me' : i === 0 ? 'podium-1' : ''}>
                  <td style={{ fontSize: i < 3 ? '1.05rem' : undefined }}>{medal(i + 1)}</td>
                  <td>
                    <Link to={`/duif/${r.pigeonId}`} style={{ color: 'inherit' }}>{r.name}</Link>
                  </td>
                  <td className="faint">
                    {r.ownerName} {r.isBot && <span className="badge bot">bot</span>}
                    {r.ownerId === meId && <span className="badge club" style={{ marginLeft: 6 }}>jij</span>}
                  </td>
                  <td className="num"><strong>{fmt(r.value)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
