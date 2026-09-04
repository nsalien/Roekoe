/** App chrome: sticky top bar with navigation, money purse and admin control. */

import { NavLink, Link, Outlet } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useGame } from '../game/GameContext';
import { MARKET_SEEN_EVENT, hasMarketNews, marketSeenAt } from '../game/marketSeen';
import { api } from '../api/client';
import { useToast } from './ui';
import { NotificationsBell } from './NotificationsBell';
import { Tour, PEDIGREE_NEWS_STEPS } from './Tour';
import { PrizeCeremony } from './PrizeCeremony';

interface NavItem { to: string; label: string; short: string; icon: string; end?: boolean }

/**
 * What a nav button nags about. Two different things, so two markers:
 * `count` is a numbered pill for items waiting on a decision of yours (a bid on
 * your bird, a nest, a sponsor offer), `news` a plain dot for "something new to
 * look at" — no action needed, and no honest number to put on it.
 */
interface NavBadge { count: number; news: boolean; title: string }

/**
 * When this player last looked at the market. The value lives in localStorage
 * (game/marketSeen.ts), which re-renders nothing on its own, so this listens for
 * the event the market page fires — and for `storage`, so a second tab that
 * looked clears the dot here too.
 */
function useMarketSeenAt(userId: string | null | undefined): number {
  const [at, setAt] = useState(() => marketSeenAt(userId));
  useEffect(() => {
    const sync = () => setAt(marketSeenAt(userId));
    sync();
    window.addEventListener(MARKET_SEEN_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(MARKET_SEEN_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [userId]);
  return at;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Overzicht', short: 'Start', icon: '🏠', end: true },
  { to: '/hok', label: 'Mijn hok', short: 'Hok', icon: '🕊️' },
  { to: '/vluchten', label: 'Vluchten', short: 'Vlucht', icon: '🏁' },
  { to: '/markt', label: 'Markt', short: 'Markt', icon: '🛒' },
  { to: '/kweek', label: 'Kweek', short: 'Kweek', icon: '🥚' },
  { to: '/ziekenboeg', label: 'Ziekenboeg', short: 'Zieken', icon: '🏥' },
  { to: '/sponsors', label: 'Sponsors', short: 'Sponsor', icon: '🤝' },
  { to: '/prestaties', label: 'Prestaties', short: 'Prestige', icon: '🎖️' },
  { to: '/ranglijst', label: 'Rang', short: 'Rang', icon: '🏆' },
  { to: '/wiki', label: 'Wiki', short: 'Wiki', icon: '📖' },
  { to: '/profiel', label: 'Profiel', short: 'Profiel', icon: '👤' },
];

// Only admins see the beheer-console link.
const ADMIN_NAV: NavItem = { to: '/beheer', label: 'Beheer', short: 'Beheer', icon: '🛠️' };

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
  // One-time "what's new" announcement — reuses the tour's spotlight mechanism
  // with just the new steps (currently: the leeftijdscriterium — four age brackets
  // with a weekly race each, standings that run three seasons). Separate key so it
  // also reaches players who already finished the main welcome tour or an earlier
  // announcement. Bump the key suffix for a next announcement.
  //
  // `agecup2`, not `agecup`: the first run was too wordy to read (and its card
  // could not be scrolled to the buttons), so the shortened version has to reach
  // the players who already clicked the old one away.
  const newsKey = user?.id ? `roekoe.newsSeen.stamboom.${user.id}` : null;
  const [showNews, setShowNews] = useState(false);

  function closeTour() {
    if (tourKey) { try { localStorage.setItem(tourKey, '1'); } catch { /* private mode */ } }
    // A brand-new player just saw everything in the full tour — don't also pop
    // the "what's new" run at them afterwards.
    if (newsKey) { try { localStorage.setItem(newsKey, '1'); } catch { /* private mode */ } }
    setShowTour(false);
  }

  useEffect(() => {
    if (newsKey && state?.loft && !showTour && !localStorage.getItem(newsKey)) {
      setShowNews(true);
    }
  }, [newsKey, state?.loft, showTour]);
  function closeNews() {
    if (newsKey) { try { localStorage.setItem(newsKey, '1'); } catch { /* private mode */ } }
    setShowNews(false);
  }

  // Prijsuitreiking: de prizes of the season that just ended, one screen each.
  // No server state — `loft.ceremony` carries the last season's awards and this
  // remembers which season was already celebrated. A player who wins nothing has
  // no awards for that season, so nothing pops up.
  const ceremony = state?.loft?.ceremony ?? null;
  const ceremonyKey = user?.id ? `roekoe.ceremonySeen.${user.id}` : null;
  const [ceremonyDone, setCeremonyDone] = useState(false);
  const showCeremony = (() => {
    if (!ceremony || !ceremonyKey || ceremonyDone || ceremony.awards.length === 0) return false;
    // Alleen het seizoen dat NET is afgelopen. `loft.ceremony` draagt de laatste
    // prijzen die dit hok won, en dat kan seizoenen geleden zijn — zonder deze
    // check vierde een verse browser een overwinning van maanden terug opnieuw.
    if (ceremony.season !== (state?.world.seasonYear ?? 0) - 1) return false;
    try { return Number(localStorage.getItem(ceremonyKey) ?? '0') < ceremony.season; } catch { return false; }
  })();
  function closeCeremony() {
    if (ceremonyKey && ceremony) {
      try { localStorage.setItem(ceremonyKey, String(ceremony.season)); } catch { /* private mode */ }
    }
    setCeremonyDone(true);
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
  const navItems = state?.isAdmin ? [...NAV, ADMIN_NAV] : NAV;

  // A bird going up for sale had no signal at all: the market sends no bell
  // notification, so you only found out by opening the page on the off chance.
  // The dot stays until this player has actually looked (per browser — see
  // game/marketSeen.ts; it is a convenience, not game state).
  const marketSeenAt = useMarketSeenAt(user?.id);
  const marketNews = hasMarketNews(
    state?.world.marketNewsAt, state?.world.marketNewsBy, user?.id, marketSeenAt,
  );

  function badgeFor(n: NavItem): NavBadge {
    if (n.to === '/sponsors') {
      const count = state?.loft?.sponsorOfferCount ?? 0;
      return { count, news: false, title: `${count} nieuw aanbod` };
    }
    if (n.to === '/markt') {
      const count = state?.offers?.received.length ?? 0;
      const parts = [];
      if (count > 0) parts.push(`${count} nieuw bod op je duiven`);
      if (marketNews) parts.push('nieuw op de markt — er staat een duif te koop die je nog niet zag');
      return { count, news: marketNews, title: parts.join(' · ') };
    }
    if (n.to === '/kweek') {
      // A held clutch is waiting on a decision and blocks new pairs, so Kweek
      // nags until it is resolved.
      const count = state?.pendingNests ?? 0;
      return {
        count,
        news: false,
        title: `${count} nest${count === 1 ? '' : 'en'} wacht${count === 1 ? '' : 'en'} op je keuze`,
      };
    }
    return { count: 0, news: false, title: '' };
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/" className="brand">
            <span className="logo">🕊️</span> Roekoe
          </Link>
          <nav className="nav">
            {navItems.map((n) => {
              const badge = badgeFor(n);
              return (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {n.label}
                  {badge.count > 0 && <span className="nav-dot" title={badge.title}>{badge.count}</span>}
                  {badge.news && (
                    <span className="nav-dot plain" title={badge.title} aria-label={badge.title} />
                  )}
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
      <BottomNav items={navItems} badgeFor={badgeFor} />

      {showTour && <Tour onClose={closeTour} />}
      {/* De ceremonie gaat vóór de "wat is nieuw"-run: net gewonnen weegt zwaarder
          dan een aankondiging, en ze is maar één seizoen relevant. */}
      {showCeremony && !showTour && ceremony && (
        <PrizeCeremony season={ceremony.season} awards={ceremony.awards} onClose={closeCeremony} />
      )}
      {showNews && !showTour && !showCeremony && <Tour steps={PEDIGREE_NEWS_STEPS} onClose={closeNews} />}
      {state?.pendingEvent && !showTour && !showNews && !showCeremony && <EventModal />}
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

/**
 * The icon of a bottom-bar tab, with its markers pinned to it. The phone bar has
 * no room for a label badge, so the count rides the top-right corner and the
 * "something new" dot the top-left — the same two signals as the desktop nav.
 */
function NavIcon({ icon, badge }: { icon: string; badge: NavBadge }) {
  return (
    <span className="ico">
      {icon}
      {badge.news && <span className="bn-dot news" aria-label={badge.title} />}
      {badge.count > 0 && <span className="bn-dot" aria-label={badge.title}>{badge.count}</span>}
    </span>
  );
}

function BottomNav({ items, badgeFor }: { items: NavItem[]; badgeFor: (n: NavItem) => NavBadge }) {
  const [open, setOpen] = useState(false);
  const primary = items.slice(0, PRIMARY);
  const overflow = items.slice(PRIMARY);
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
              <NavIcon icon={n.icon} badge={badgeFor(n)} />
              <span>{n.short}</span>
            </NavLink>
          ))}
        </div>
      )}
      <nav className="bottomnav">
        {primary.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <NavIcon icon={n.icon} badge={badgeFor(n)} />
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
