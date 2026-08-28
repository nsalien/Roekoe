/** Ranglijst: seizoensstand van de melkers, de drie duivenrangschikkingen en de
 *  vier leeftijdsklassen van het criterium (die over drie seizoenen lopen). */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGame } from '../game/GameContext';
import { useAuth } from '../auth/AuthContext';
import { Spinner, nextPlayWeek, timeUntil } from '../components/ui';
import type { AgeCategoryInfo, PigeonRankRow } from '../types';

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
  const [tab, setTab] = useState<'melkers' | 'duiven' | 'criterium'>('melkers');
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
                ? <>Nieuw seizoen (week 1) {timeUntil(nw.at)}</>
                : <>Volgende speelweek (week {nw.weekNum}) {timeUntil(nw.at)}</>}
            </p>
          )}
        </div>
        <div className="pill-tabs">
          <button className={tab === 'melkers' ? 'active' : ''} onClick={() => setTab('melkers')}>Melkers</button>
          <button className={tab === 'duiven' ? 'active' : ''} onClick={() => setTab('duiven')} data-tour="pigeon-ranks">Duiven</button>
          <button className={tab === 'criterium' ? 'active' : ''} onClick={() => setTab('criterium')} data-tour="age-cup">Criterium</button>
        </div>
      </div>

      {tab === 'criterium' ? (
        <AgeCupPanel meId={user?.id} />
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
 * Leeftijdscriterium — four standings, one per age bracket, that run for three
 * seasons instead of one.
 *
 * The long horizon is the whole point and has to be visible: with a single race
 * per bracket per week, a season is four results, which is nowhere near enough to
 * separate a field. So the header leads with how far the cycle has come, and the
 * detail (rules, prize money, the sprint/fond alternation) lives in the wiki.
 */
function AgeCupPanel({ meId }: { meId?: string }) {
  const { state } = useGame();
  const cup = state?.ageCup;
  const rows = state?.cupRankings;
  // A world whose cached leaderboard predates the criterium has no standings yet;
  // it fills in on the next full engine run.
  if (!cup) return <div className="card muted">Het leeftijdscriterium is nog niet gestart.</div>;

  const started = cup.startedAt ? Date.parse(cup.startedAt) : NaN;
  const notYet = Number.isFinite(started) && started > Date.now();
  const seasonOf = cup.seasonsDone + 1;

  return (
    <div className="stack">
      <div className="card">
        <h2 style={{ margin: '0 0 4px' }}>🏆 Leeftijdscriterium</h2>
        <p className="faint" style={{ margin: 0 }}>
          Elke week één vlucht per leeftijdsklasse — de ene week een <strong>sprint</strong> (100–300 km),
          de volgende een <strong>grote fond</strong> (400–1000 km). Inschrijven kost €{cup.entryFee}.
          Er is <strong>prijzengeld</strong>, maar geen seizoenspunten: deze stand telt enkel voor de duif.
        </p>
        <p className="faint" style={{ margin: '8px 0 0' }}>
          {notYet
            ? <>De eerste editie start bij het nieuwe seizoen.</>
            : <>De stand loopt <strong>{cup.seasons} seizoenen</strong> door — nu bezig aan seizoen{' '}
                <strong>{Math.min(seasonOf, cup.seasons)} van {cup.seasons}</strong>. Pas daarna volgt de
                prijsuitreiking en een reset.</>}
        </p>
        <p className="faint" style={{ margin: '8px 0 0' }}>
          🥇 €{cup.awards[0]} · 🥈 €{cup.awards[1]} · 🥉 €{cup.awards[2]} per klasse bij de reset, plus een
          titel op de duif zelf. <Link to="/wiki#criterium">Meer info over het criterium →</Link>
        </p>
      </div>
      {cup.categories.map((cat: AgeCategoryInfo) => (
        <PigeonRankCard
          key={cat.id}
          title={`${cat.icon} ${cat.label}`}
          subtitle={`Criteriumpunten over ${cup.seasons} seizoenen`}
          unit="pt"
          rows={rows?.[cat.id] ?? []}
          meId={meId}
        />
      ))}
    </div>
  );
}
