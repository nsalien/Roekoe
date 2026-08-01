/** App chrome: sticky top bar with navigation, money purse and admin control. */

import { NavLink, Link, Outlet } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useGame } from '../game/GameContext';
import { api } from '../api/client';
import { useToast } from './ui';
import { NotificationsBell } from './NotificationsBell';
import { Tour } from './Tour';
import { FeatureTour, FEATURE_NEWS } from './FeatureTour';

const NAV = [
  { to: '/', label: 'Overzicht', short: 'Start', icon: '🏠', end: true },
  { to: '/hok', label: 'Mijn hok', short: 'Hok', icon: '🕊️' },
  { to: '/vluchten', label: 'Vluchten', short: 'Vlucht', icon: '🏁' },
  { to: '/markt', label: 'Markt', short: 'Markt', icon: '🛒' },
  { to: '/kweek', label: 'Kweek', short: 'Kweek', icon: '🥚' },
  { to: '/ziekenboeg', label: 'Ziekenboeg', short: 'Zieken', icon: '🏥' },
  { to: '/sponsors', label: 'Sponsors', short: 'Sponsor', icon: '🤝' },
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

  // One-time welcome tour, remembered per player (per browser). Closing it —
  // even early — counts as seen, so it never returns on its own. The profile
  // page can restart it via a 'roekoe:start-tour' event (this component stays
  // mounted while the tour navigates between pages).
  const tourKey = user?.id ? `roekoe.tourSeen.${user.id}` : null;
  const [showTour, setShowTour] = useState(false);
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    if (tourKey && state?.loft && !localStorage.getItem(tourKey)) {
      autoStarted.current = true;
      setShowTour(true);
    }
  }, [tourKey, state?.loft]);
  useEffect(() => {
    const start = () => setShowTour(true);
    window.addEventListener('roekoe:start-tour', start);
    return () => window.removeEventListener('roekoe:start-tour', start);
  }, []);
  function closeTour() {
    if (tourKey) { try { localStorage.setItem(tourKey, '1'); } catch { /* private mode */ } }
    setShowTour(false);
  }

  // One-time "what's new" announcement (oefenvluchten + rustkuur). Separate key
  // so it also reaches players who already finished the main welcome tour. It
  // waits until the welcome tour is not showing, so a brand-new player sees the
  // full tour first and then the news. Bump the key suffix for a next announcement.
  const newsKey = user?.id ? `roekoe.newsSeen.oefenrust.${user.id}` : null;
  const [showNews, setShowNews] = useState(false);
  useEffect(() => {
    if (newsKey && state?.loft && !showTour && !localStorage.getItem(newsKey)) {
      setShowNews(true);
    }
  }, [newsKey, state?.loft, showTour]);
  function closeNews() {
    if (newsKey) { try { localStorage.setItem(newsKey, '1'); } catch { /* private mode */ } }
    setShowNews(false);
  }

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
            {NAV.map((n) => {
              const offers = n.to === '/sponsors' ? state?.loft?.sponsorOfferCount ?? 0 : 0;
              return (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {n.label}
                  {offers > 0 && <span className="nav-dot" title={`${offers} nieuw aanbod`}>{offers}</span>}
                </NavLink>
              );
            })}
          </nav>
          <div className="topbar-right">
            {state && (
              <span className="chip week" title="Seizoensweek">
                {`Week ${state.world.seasonWeek}/4`}
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
              {state && <>Seizoen {state.world.seasonYear} · week {state.world.seasonWeek}/4</>}
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

      {showTour && <Tour onClose={closeTour} />}
      {showNews && !showTour && <FeatureTour steps={FEATURE_NEWS} onClose={closeNews} />}
      {state?.pendingEvent && !showTour && !showNews && <EventModal />}
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
      {/* The overflow row stays open while you navigate; it only collapses when
          you tap "Minder" (no scrim, no auto-close on a nav tap). */}
      {open && (
        <div className="bottomnav-sheet">
          {overflow.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <span className="ico">{n.icon}</span>
              <span>{n.short}</span>
            </NavLink>
          ))}
        </div>
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
            aria-label={open ? 'Minder' : 'Meer'}
          >
            <span className="ico">{open ? '▾' : '›'}</span>
            <span>{open ? 'Minder' : 'Meer'}</span>
          </button>
        )}
      </nav>
    </>
  );
}
