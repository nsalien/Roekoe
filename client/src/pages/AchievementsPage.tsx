/** Prestaties: player level, badges and the trophy cabinet. */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Spinner, formatFlightTime } from '../components/ui';
import type { BadgeGroup, BadgeItem, PlayerProfile } from '../types';

const GROUP_LABEL: Record<BadgeGroup, string> = {
  race: '🏁 Vluchtoverwinningen',
  podium: '🎖️ Podium & prestaties',
  breed: '🥚 Kweek',
  market: '🛒 Markt',
  care: '💊 Verzorging',
  milestone: '📈 Mijlpalen',
  sponsor: '🤝 Sponsors',
  fun: '☠️ Speciaal',
};
const GROUP_ORDER: BadgeGroup[] = ['race', 'podium', 'breed', 'market', 'care', 'milestone', 'sponsor', 'fun'];

export function AchievementsPage() {
  const { state } = useGame();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [tab, setTab] = useState<'badges' | 'trophies'>('badges');

  const load = useCallback(async () => {
    setProfile(await api<PlayerProfile>('/profile'));
  }, []);
  useEffect(() => {
    load();
  }, [load, state?.world.currentWeek]);

  if (!profile) return <Spinner />;

  const pct = Math.round((profile.intoLevel / profile.needForNext) * 100);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Prestaties</h1>
          <p className="muted">{profile.earnedCount} / {profile.totalBadges} badges behaald</p>
        </div>
        <div className="pill-tabs">
          <button className={tab === 'badges' ? 'active' : ''} onClick={() => setTab('badges')}>Badges</button>
          <button className={tab === 'trophies' ? 'active' : ''} onClick={() => setTab('trophies')}>Trofeeën</button>
        </div>
      </div>

      {/* Level bar */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
            <span className="level-badge">Lvl {profile.level}</span>
            <span className="muted">{profile.xp} XP totaal</span>
          </div>
          <span className="faint">nog {profile.needForNext - profile.intoLevel} XP tot Lvl {profile.level + 1}</span>
        </div>
        <div className="bar" style={{ height: 10, marginTop: 8 }}>
          <span style={{ width: `${pct}%`, background: 'linear-gradient(90deg,var(--brand),var(--accent))' }} />
        </div>
      </div>

      {tab === 'badges' ? (
        <BadgesView badges={profile.badges} />
      ) : (
        <TrophiesView profile={profile} />
      )}
    </div>
  );
}

function BadgesView({ badges }: { badges: BadgeItem[] }) {
  return (
    <>
      {GROUP_ORDER.map((group) => {
        const list = badges.filter((b) => b.group === group);
        if (list.length === 0) return null;
        const earned = list.filter((b) => b.earned).length;
        return (
          <div key={group} style={{ marginTop: 18 }}>
            <div className="page-head" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>{GROUP_LABEL[group]}</h2>
              <span className="faint">{earned}/{list.length}</span>
            </div>
            <div className="grid cols-3">
              {list.map((b) => (
                <div key={b.key} className={`badge-card ${b.earned ? 'earned' : 'locked'}`}>
                  <div className="badge-ico">{b.earned ? b.icon : '🔒'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="badge-name">{b.label}</div>
                    <div className="faint badge-desc">{b.description}</div>
                    <div className="badge-xp">+{b.xp} XP{b.earned && b.earnedAt ? ` · ${formatFlightTime(b.earnedAt)}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function TrophiesView({ profile }: { profile: PlayerProfile }) {
  const { medals, trophies } = profile;
  const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉');
  return (
    <>
      <div className="grid cols-3" style={{ marginTop: 16 }}>
        <div className="tile"><div className="tile-label">🥇 Goud</div><div className="tile-value">{medals.gold}</div></div>
        <div className="tile"><div className="tile-label">🥈 Zilver</div><div className="tile-value">{medals.silver}</div></div>
        <div className="tile"><div className="tile-label">🥉 Brons</div><div className="tile-value">{medals.bronze}</div></div>
      </div>

      <div className="page-head" style={{ marginTop: 22 }}>
        <h2>Prijzenkast</h2>
      </div>
      {trophies.length === 0 ? (
        <div className="card muted">Nog geen podiumplaatsen. Schrijf een duif in en pak je eerste medaille!</div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th></th><th>Duif</th><th>Vlucht</th><th>Route</th><th className="num">Wanneer</th></tr>
              </thead>
              <tbody>
                {trophies.map((t, i) => (
                  <tr key={t.flightId + i}>
                    <td style={{ fontSize: '1.1rem' }}>{medal(t.rank)}</td>
                    <td>{t.pigeonName}</td>
                    <td>
                      <Link to={`/vluchten/${t.flightId}`} style={{ color: 'inherit' }}>{t.name}</Link>
                    </td>
                    <td className="faint">{t.fromCity} → {t.toCity}</td>
                    <td className="num faint">{formatFlightTime(t.startAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
