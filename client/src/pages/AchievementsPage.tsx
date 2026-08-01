/** Prestaties: player level, badges and the trophy cabinet. */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Spinner, formatFlightTime } from '../components/ui';
import type { BadgeGroup, BadgeItem, PlayerProfile, SeasonAward, WingCategory } from '../types';

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
  const [tab, setTab] = useState<'badges' | 'trophies' | 'season'>('badges');

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
      <div className="page-head" data-tour="prestige">
        <div>
          <h1>Prestaties</h1>
          <p className="muted">{profile.earnedCount} / {profile.totalBadges} badges behaald</p>
        </div>
        <div className="pill-tabs">
          <button className={tab === 'badges' ? 'active' : ''} onClick={() => setTab('badges')}>Badges</button>
          <button className={tab === 'trophies' ? 'active' : ''} onClick={() => setTab('trophies')}>Trofeeën</button>
          <button className={tab === 'season' ? 'active' : ''} onClick={() => setTab('season')} data-tour="season-prizes">Seizoensprijzen</button>
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
      ) : tab === 'trophies' ? (
        <TrophiesView profile={profile} />
      ) : (
        <SeasonPrizesView profile={profile} />
      )}
    </div>
  );
}

const WING_CAT_LABEL: Record<WingCategory, string> = {
  speed: 'snelste duif',
  podium: 'meeste podiums',
  progress: 'meeste vooruitgang',
};

function SeasonPrizesView({ profile }: { profile: PlayerProfile }) {
  const { roekoes, vleugels, awards } = profile;
  const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉');
  const roekoeName = (rank: number) => (rank === 1 ? 'Gouden' : rank === 2 ? 'Zilveren' : 'Bronzen') + ' Roekoe';
  const wingName = (rank: number) => (rank === 1 ? 'Gouden' : rank === 2 ? 'Zilveren' : 'Bronzen') + ' Vleugel';

  return (
    <>
      <div className="page-head" style={{ marginTop: 18 }}>
        <h2 style={{ margin: 0 }}>🏆 Roekoes</h2>
        <span className="faint">voor de top-3 melkers van een seizoen</span>
      </div>
      <div className="grid cols-3" style={{ marginTop: 10 }}>
        <div className="tile"><div className="tile-label">🥇 Goud</div><div className="tile-value">{roekoes.gold}</div></div>
        <div className="tile"><div className="tile-label">🥈 Zilver</div><div className="tile-value">{roekoes.silver}</div></div>
        <div className="tile"><div className="tile-label">🥉 Brons</div><div className="tile-value">{roekoes.bronze}</div></div>
      </div>

      <div className="page-head" style={{ marginTop: 22 }}>
        <h2 style={{ margin: 0 }}>🪽 Vleugels</h2>
        <span className="faint">voor top-3-duiven in de duivenrangschikkingen</span>
      </div>
      <div className="grid cols-3" style={{ marginTop: 10 }}>
        <div className="tile"><div className="tile-label">🥇 Goud</div><div className="tile-value">{vleugels.gold}</div></div>
        <div className="tile"><div className="tile-label">🥈 Zilver</div><div className="tile-value">{vleugels.silver}</div></div>
        <div className="tile"><div className="tile-label">🥉 Brons</div><div className="tile-value">{vleugels.bronze}</div></div>
      </div>

      <div className="page-head" style={{ marginTop: 22 }}>
        <h2>Erelijst</h2>
      </div>
      {awards.length === 0 ? (
        <div className="card muted">
          Nog geen seizoensprijzen. Eindig bij de beste melkers of laat een duif uitblinken — de prijzen worden
          uitgereikt zodra het seizoen afloopt.
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th></th><th>Prijs</th><th>Waarvoor</th><th className="num">Seizoen</th><th className="num">Prijzengeld</th></tr>
              </thead>
              <tbody>
                {awards.map((a: SeasonAward, i) => (
                  <tr key={a.kind + a.season + i}>
                    <td style={{ fontSize: '1.1rem' }}>{medal(a.rank)}</td>
                    <td>{a.kind === 'roekoe' ? roekoeName(a.rank) : wingName(a.rank)}</td>
                    <td className="faint">
                      {a.kind === 'roekoe'
                        ? `${a.value} seizoenspunten`
                        : `${a.pigeonName} · ${WING_CAT_LABEL[a.category ?? 'speed']}`}
                    </td>
                    <td className="num">{a.season}</td>
                    <td className="num">€{a.reward}</td>
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
