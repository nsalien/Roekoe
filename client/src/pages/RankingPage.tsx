/** Ranglijst: season standings for all lofts (players and bots). */

import { useGame } from '../game/GameContext';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/ui';

export function RankingPage() {
  const { state, loading } = useGame();
  const { user } = useAuth();
  if (loading || !state) return <Spinner />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Ranglijst</h1>
          <p className="muted">Seizoen {state.world.seasonYear} · week {state.world.currentWeek}</p>
        </div>
      </div>

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
    </div>
  );
}
