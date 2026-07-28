/** App chrome: sticky top bar with navigation, money purse and admin control. */

import { NavLink, Link, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useGame } from '../game/GameContext';
import { api } from '../api/client';
import { useToast } from './ui';

const NAV = [
  { to: '/', label: 'Overzicht', icon: '🏠', end: true },
  { to: '/hok', label: 'Mijn hok', icon: '🕊️' },
  { to: '/vluchten', label: 'Vluchten', icon: '🏁' },
  { to: '/markt', label: 'Markt', icon: '🛒' },
  { to: '/kweek', label: 'Kweek', icon: '🥚' },
  { to: '/ranglijst', label: 'Rang', icon: '🏆' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { state, refresh } = useGame();
  const toast = useToast();
  const [advancing, setAdvancing] = useState(false);

  async function advanceWeek() {
    setAdvancing(true);
    try {
      const res = await api<{ summary: { hatched: number; seasonRolledOver: boolean } }>(
        '/admin/advance-week',
        { method: 'POST' },
      );
      const h = res.summary.hatched;
      toast.show(
        `Nieuwe week! Duiven gevoerd${h > 0 ? `, ${h} jong${h === 1 ? '' : 'en'} geboren` : ''}.`,
        'ok',
      );
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setAdvancing(false);
    }
  }

  const initial = (user?.username ?? '?').charAt(0).toUpperCase();

  return (
    <div className="app">
      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/" className="brand">
            <span className="logo">🕊️</span> Roekoe
          </Link>
          <nav className="nav">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            {state && (
              <span className="chip week" title="Speelweek">
                {state.world.currentWeek === 0 ? '' : `Week ${state.world.currentWeek}`}
              </span>
            )}
            {state?.loft && (
              <span className="chip money" title="Kassa">
                <span className="coin">◎</span> {state.loft.money.toLocaleString('nl-NL')}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="subhead">
        <div className="container subhead-inner">
          <div className="row" style={{ gap: 10 }}>
            <span className="muted">
              {state && <>Seizoen {state.world.seasonYear} · week {state.world.currentWeek}</>}
            </span>
            {state?.isAdmin && (
              <button className="btn accent sm" onClick={advanceWeek} disabled={advancing}>
                {advancing ? 'Bezig…' : 'Volgende week ›'}
              </button>
            )}
          </div>
          <div className="who">
            <span className="avatar-dot">{initial}</span>
            <span className="muted">{user?.username}</span>
            <button className="btn ghost sm" onClick={logout}>Uitloggen</button>
          </div>
        </div>
      </div>

      <main className="container page">
        <Outlet />
      </main>

      {/* Bottom tab bar — only shown on phones (see global.css). */}
      <nav className="bottomnav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="ico">{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
