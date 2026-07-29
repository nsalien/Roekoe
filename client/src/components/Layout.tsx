/** App chrome: sticky top bar with navigation, money purse and admin control. */

import { NavLink, Link, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useGame } from '../game/GameContext';
import { api } from '../api/client';
import { useToast } from './ui';
import { NotificationsBell } from './NotificationsBell';

const NAV = [
  { to: '/', label: 'Overzicht', short: 'Start', icon: '🏠', end: true },
  { to: '/hok', label: 'Mijn hok', short: 'Hok', icon: '🕊️' },
  { to: '/vluchten', label: 'Vluchten', short: 'Vlucht', icon: '🏁' },
  { to: '/markt', label: 'Markt', short: 'Markt', icon: '🛒' },
  { to: '/kweek', label: 'Kweek', short: 'Kweek', icon: '🥚' },
  { to: '/ziekenboeg', label: 'Ziekenboeg', short: 'Zieken', icon: '🏥' },
  { to: '/prestaties', label: 'Prestaties', short: 'Prestige', icon: '🎖️' },
  { to: '/ranglijst', label: 'Rang', short: 'Rang', icon: '🏆' },
  { to: '/profiel', label: 'Profiel', short: 'Profiel', icon: '👤' },
];

// On phones the bottom bar shows the first PRIMARY items; the rest hide behind
// a "› Meer" button so the bar has room to grow with new sections.
const PRIMARY = 5;

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
      toast.show('Nieuwe week! Onkosten verrekend en gezondheid bijgewerkt.', 'ok');
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
            {state && <NotificationsBell />}
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
      <BottomNav />

      {state?.pendingEvent && <EventModal />}
    </div>
  );
}

function EventModal() {
  const { state, refresh } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const event = state?.pendingEvent;
  if (!event) return null;

  async function choose(i: number) {
    setBusy(true);
    try {
      const res = await api<{ result: string }>('/event/choose', { method: 'POST', body: { choice: i } });
      toast.show(res.result || 'Afgehandeld', 'ok');
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2 style={{ marginTop: 0 }}>{event.icon} {event.title}</h2>
        <p className="muted">{event.text}</p>
        <div className="stack" style={{ marginTop: 12, gap: 8 }}>
          {event.options.map((o, i) => (
            <button key={i} className="btn block" disabled={busy} onClick={() => choose(i)}>{o.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BottomNav() {
  const [open, setOpen] = useState(false);
  const primary = NAV.slice(0, PRIMARY);
  const overflow = NAV.slice(PRIMARY);
  return (
    <>
      {open && (
        <>
          <div className="bottomnav-scrim" onClick={() => setOpen(false)} />
          <div className="bottomnav-sheet">
            {overflow.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => (isActive ? 'active' : '')}
                onClick={() => setOpen(false)}
              >
                <span className="ico">{n.icon}</span>
                <span>{n.short}</span>
              </NavLink>
            ))}
          </div>
        </>
      )}
      <nav className="bottomnav">
        {primary.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="ico">{n.icon}</span>
            <span>{n.short}</span>
          </NavLink>
        ))}
        {overflow.length > 0 && (
          <button
            type="button"
            className={`morebtn ${open ? 'active' : ''}`}
            onClick={() => setOpen((o) => !o)}
            aria-label="Meer"
          >
            <span className="ico">{open ? '×' : '›'}</span>
            <span>Meer</span>
          </button>
        )}
      </nav>
    </>
  );
}
