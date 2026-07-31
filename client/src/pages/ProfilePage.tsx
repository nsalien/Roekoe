/** Profiel: your loft identity, level/XP progress and a stats overview. */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useGame } from '../game/GameContext';
import { Money, Spinner, useToast } from '../components/ui';
import type { PlayerProfile } from '../types';

export function ProfilePage() {
  const { state, refresh } = useGame();
  const { user } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  );

  function applyTheme(t: 'light' | 'dark') {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch { /* storage unavailable */ }
  }

  const load = useCallback(async () => {
    setProfile(await api<PlayerProfile>('/profile'));
  }, []);
  useEffect(() => {
    load();
  }, [load, state?.world.currentWeek]);

  if (!state || !profile) return <Spinner />;
  const { loft, rankings } = state;
  if (!loft) return <div className="card">Geen hok gevonden.</div>;
  const myRank = rankings.find((r) => r.userId === user?.id);

  async function saveName() {
    setBusy(true);
    try {
      await api('/loft/name', { method: 'POST', body: { name } });
      toast.show('Hoknaam aangepast! 🕊️', 'ok');
      setEditing(false);
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  const pct = Math.round((profile.intoLevel / profile.needForNext) * 100);

  return (
    <div>
      <div className="page-head">
        <h1>Profiel</h1>
      </div>

      {/* Identity + level */}
      <div className="card">
        <div className="row" style={{ gap: 14, alignItems: 'center' }}>
          <span className="avatar-dot" style={{ width: 52, height: 52, fontSize: '1.3rem' }}>
            {(user?.username ?? '?').charAt(0).toUpperCase()}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <div>
                <div className="row" style={{ gap: 6 }}>
                  <input
                    value={name}
                    maxLength={32}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Naam van je hok"
                    style={{ maxWidth: 260 }}
                  />
                  <button className="btn sm" disabled={busy || name.trim().length < 2} onClick={saveName}>Bewaar</button>
                  <button className="btn ghost sm" onClick={() => setEditing(false)}>Annuleer</button>
                </div>
                <div className="faint" style={{ fontSize: '0.82rem', marginTop: 4 }}>
                  Een hok hernoemen kost <Money value={state.economy.renameLoftCost} />.
                </div>
              </div>
            ) : (
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <h2 style={{ margin: 0 }}>{loft.name}</h2>
                  <div className="faint">speler: {user?.username}</div>
                </div>
                <button className="btn ghost sm" onClick={() => { setName(loft.name); setEditing(true); }}>
                  ✏️ Naam wijzigen
                </button>
              </div>
            )}
          </div>
        </div>

        <hr className="sep" />

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

      {/* Appearance / theme */}
      <div className="card" style={{ marginTop: 16 }} data-tour="profile">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <strong>🎨 Weergave</strong>
            <div className="faint" style={{ fontSize: '0.85rem' }}>
              Kies je thema. Standaard staat alles op donker; je keuze wordt op dit toestel onthouden.
            </div>
          </div>
          <div className="pill-tabs" role="group" aria-label="Thema">
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => applyTheme('dark')}>🌙 Donker</button>
            <button className={theme === 'light' ? 'active' : ''} onClick={() => applyTheme('light')}>☀️ Licht</button>
          </div>
        </div>
        <hr className="sep" />
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <strong>🧭 Rondleiding</strong>
            <div className="faint" style={{ fontSize: '0.85rem' }}>
              De uitleg over het hele spel nog eens doorlopen.
            </div>
          </div>
          <button
            className="btn ghost sm"
            onClick={() => window.dispatchEvent(new Event('roekoe:start-tour'))}
          >
            Start rondleiding
          </button>
        </div>
      </div>

      {/* Stats overview */}
      <div className="grid cols-3" style={{ marginTop: 16 }}>
        <div className="tile">
          <div className="tile-label">Rang</div>
          <div className="tile-value">{myRank ? `#${myRank.rank}` : '—'}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Seizoenspunten</div>
          <div className="tile-value">{loft.seasonPoints}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Overwinningen</div>
          <div className="tile-value">{loft.totalWins}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Duiven</div>
          <div className="tile-value">{loft.pigeonCount}<span className="faint" style={{ fontSize: '0.95rem', fontWeight: 600 }}> / {loft.capacity}</span></div>
        </div>
        <div className="tile">
          <div className="tile-label">Kassa</div>
          <div className="tile-value"><Money value={loft.money} /></div>
        </div>
        <div className="tile">
          <div className="tile-label">Badges</div>
          <div className="tile-value">{profile.earnedCount}<span className="faint" style={{ fontSize: '0.95rem', fontWeight: 600 }}> / {profile.totalBadges}</span></div>
        </div>
      </div>

      {/* Medals + link */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div className="row" style={{ gap: 14 }}>
            <span>🥇 {profile.medals.gold}</span>
            <span>🥈 {profile.medals.silver}</span>
            <span>🥉 {profile.medals.bronze}</span>
          </div>
          <Link to="/prestaties" className="btn ghost sm">Bekijk badges & trofeeën →</Link>
        </div>
      </div>
    </div>
  );
}
