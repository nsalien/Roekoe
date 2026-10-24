/** Ranglijst: seizoensstand van de melkers, de drie duivenrangschikkingen en de
 *  vier leagues (per algemene score, één seizoen lang). */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGame } from '../game/GameContext';
import { useAuth } from '../auth/AuthContext';
import { Spinner, nextPlayWeek, timeUntilOrClock } from '../components/ui';
import type { LeagueDefInfo, PigeonRankRow } from '../types';

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
  const [tab, setTab] = useState<'melkers' | 'duiven' | 'leagues'>('melkers');
  if (loading || !state) return <Spinner />;

  const { seasonYear, seasonWeek, seasonEndsAt, seasonStartedAt } = state.world;
  const seasonWeeks = 4;
  const nw = seasonStartedAt ? nextPlayWeek(seasonStartedAt, seasonWeek, seasonWeeks) : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Ranglijst</h1>
          <p className="muted" data-tour="season">
            Seizoen {seasonYear} · week {seasonWeek}/{seasonWeeks}
            {seasonEndsAt && <> · {timeLeft(seasonEndsAt)}</>}
          </p>
          {nw && (
            <p className="faint" style={{ margin: '2px 0 0', fontSize: '0.85rem' }}>
              📅 {nw.isNewSeason
                ? <>Nieuw seizoen (week 1) {timeUntilOrClock(nw.at)}</>
                : <>Volgende speelweek (week {nw.weekNum}) {timeUntilOrClock(nw.at)}</>}
            </p>
          )}
        </div>
        <div className="pill-tabs">
          <button className={tab === 'melkers' ? 'active' : ''} onClick={() => setTab('melkers')}>Melkers</button>
          <button className={tab === 'duiven' ? 'active' : ''} onClick={() => setTab('duiven')} data-tour="pigeon-ranks">Duiven</button>
          <button className={tab === 'leagues' ? 'active' : ''} onClick={() => setTab('leagues')} data-tour="leagues">Leagues</button>
        </div>
      </div>

      {tab === 'leagues' ? (
        <LeaguePanel meId={user?.id} />
      ) : tab === 'melkers' ? (
        <>
          <div className="card" data-tour="ranking">
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
            subtitle="Hoogste gemiddelde vluchtsnelheid dit seizoen"
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
  const head = unit === '×' ? 'Podiums' : unit === '+' ? 'Groei' : unit === 'pt' ? 'Punten' : 'Snelheid';
  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="faint">{subtitle}</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="muted">Nog geen resultaten.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>#</th><th>Duif</th><th>Hok</th><th className="num">{head}</th></tr>
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


/**
 * Leagues — four standings, one per score league, for the running season.
 *
 * Kept to what the player decides on here: where his birds stand and what the
 * top 3 wins at the season end. The rules (score bounds, prize tables, the
 * sprint/fond alternation, the 4-bird minimum) live in the wiki.
 */
function LeaguePanel({ meId }: { meId?: string }) {
  const { state } = useGame();
  const info = state?.leagueInfo;
  const rows = state?.leagueRankings;
  if (!info) return <div className="card muted">De leagues zijn nog niet gestart.</div>;
  return (
    <div className="stack">
      <div className="card">
        <h2 style={{ margin: '0 0 4px' }}>🏅 Leagues</h2>
        <p className="faint" style={{ margin: 0 }}>
          De stand loopt tot het einde van dit seizoen; dan wint de top {info.leagues[0]?.awards.length ?? 10} van elke league geld,
          de top 3 ook een titel op de duif.
          {' '}<Link to="/wiki#leagues">Meer info over de leagues →</Link>
        </p>
      </div>
      {info.leagues.map((lg: LeagueDefInfo) => (
        <PigeonRankCard
          key={lg.id}
          title={`${lg.icon} ${lg.label}`}
          subtitle={`Leaguepunten dit seizoen · 1e plaats €${lg.awards[0].toLocaleString('nl-BE')}`}
          unit="pt"
          rows={rows?.[lg.id] ?? []}
          meId={meId}
        />
      ))}
    </div>
  );
}
