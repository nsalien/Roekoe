/** Route table. Unauthenticated users see the login screen; everyone else the
 * game, wrapped in the Layout chrome. */

import { Suspense, lazy, type ComponentType } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Spinner } from './components/ui';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoftPage } from './pages/LoftPage';
import { PigeonPage } from './pages/PigeonPage';
import { MarketPage } from './pages/MarketPage';
import { FlightsPage } from './pages/FlightsPage';
import { LiveFlightPage } from './pages/LiveFlightPage';

/**
 * A page that is fetched when it is first opened, instead of riding along in the
 * start bundle. The screens you land on and live in (overzicht, hok, duif,
 * vluchten, live, markt) stay in the main bundle; the rest — the wiki alone was
 * a quarter of it — loads on demand.
 *
 * ⚠️ A tab that was open across a deploy asks for a chunk that no longer exists.
 * One reload fetches the new index.html (and with it the new chunk names); the
 * sessionStorage mark keeps that from ever becoming a loop.
 */
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(async () => {
    try {
      const mod = await load();
      try { sessionStorage.removeItem('roekoe.chunkReload'); } catch { /* private mode */ }
      return { default: mod[name] };
    } catch (e) {
      let tried = true;
      try {
        tried = sessionStorage.getItem('roekoe.chunkReload') === '1';
        sessionStorage.setItem('roekoe.chunkReload', '1');
      } catch { /* private mode: do not risk a loop */ }
      if (!tried) {
        window.location.reload();
        return new Promise<{ default: ComponentType }>(() => { /* the page is reloading */ });
      }
      throw e;
    }
  });
}

const InrichtingPage = lazyPage(() => import('./pages/InrichtingPage'), 'InrichtingPage');
const BreedingPage = lazyPage(() => import('./pages/BreedingPage'), 'BreedingPage');
const InfirmaryPage = lazyPage(() => import('./pages/InfirmaryPage'), 'InfirmaryPage');
const SponsorsPage = lazyPage(() => import('./pages/SponsorsPage'), 'SponsorsPage');
const BankPage = lazyPage(() => import('./pages/BankPage'), 'BankPage');
const AchievementsPage = lazyPage(() => import('./pages/AchievementsPage'), 'AchievementsPage');
const ProfilePage = lazyPage(() => import('./pages/ProfilePage'), 'ProfilePage');
const RankingPage = lazyPage(() => import('./pages/RankingPage'), 'RankingPage');
const StemPage = lazyPage(() => import('./pages/StemPage'), 'StemPage');
const LokaalPage = lazyPage(() => import('./pages/LokaalPage'), 'LokaalPage');
const WikiPage = lazyPage(() => import('./pages/WikiPage'), 'WikiPage');
const AdminPage = lazyPage(() => import('./pages/AdminPage'), 'AdminPage');

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="center-screen">
        <Spinner />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="/hok" element={<LoftPage />} />
        <Route path="/inrichting" element={<InrichtingPage />} />
        <Route path="/duif/:id" element={<PigeonPage />} />
        <Route path="/markt" element={<MarketPage />} />
        <Route path="/kweek" element={<BreedingPage />} />
        <Route path="/vluchten" element={<FlightsPage />} />
        <Route path="/vluchten/:id" element={<LiveFlightPage />} />
        <Route path="/ziekenboeg" element={<InfirmaryPage />} />
        <Route path="/sponsors" element={<SponsorsPage />} />
        <Route path="/bank" element={<BankPage />} />
        <Route path="/prestaties" element={<AchievementsPage />} />
        <Route path="/profiel" element={<ProfilePage />} />
        <Route path="/ranglijst" element={<RankingPage />} />
        <Route path="/lokaal" element={<LokaalPage />} />
        <Route path="/stem" element={<StemPage />} />
        <Route path="/wiki" element={<WikiPage />} />
        <Route path="/beheer" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
