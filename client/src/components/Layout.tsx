/** App chrome: sticky top bar with navigation, money purse and admin control. */

import { NavLink, Link, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useGame } from '../game/GameContext';
import { api } from '../api/client';
import { Money, useToast } from './ui';

const NAV = [
  { to: '/', label: 'Overzicht', end: true },
  { to: '/hok', label: 'Mijn hok' },
  { to: '/vluchten', label: 'Vluchten' },
  { to: '/markt', label: 'Markt' },
  { to: '/kweek', label: 'Kweek' },
  { to: '/ranglijst', label: 'Ranglijst' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { state, refresh } = useGame();
  const toast = useToast();
  const [advancing, setAdvancing] = useState(false);

  async function advanceWeek() {
    setAdvancing(true);
    try {
      const res = await api<{ summary: { ranFlights: { name: string; winner: string }[]; hatched: number } }>(
        '/admin/advance-week',
        { method: 'POST' },
      );
      const ran = res.summary.ranFlights.length;
      toast.show(`Nieuwe week! ${ran} vlucht${ran === 1 ? '' : 'en'} gevlogen.`, 'ok');
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setAdvancing(false);
    }
  }

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
          {state?.loft && (
            <span className="purse" title="Kassa">
              <Money value={state.loft.money} />
            </span>
          )}
        </div>
      </header>

      <div className="container" style={{ paddingTop: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', fontSize: '0.85rem' }}>
          <span className="muted">
            {state && (
              <>📅 Week {state.world.currentWeek} · Seizoen {state.world.seasonYear}</>
            )}
          </span>
          <span className="row" style={{ gap: 10 }}>
            {state?.isAdmin && (
              <button className="btn accent sm" onClick={advanceWeek} disabled={advancing}>
                {advancing ? 'Bezig…' : '⏭ Volgende week'}
              </button>
            )}
            <span className="muted">{user?.username}</span>
            <button className="btn ghost sm" onClick={logout}>Uitloggen</button>
          </span>
        </div>
      </div>

      <main className="container page">
        <Outlet />
      </main>
    </div>
  );
}
