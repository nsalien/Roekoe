/** Route table. Unauthenticated users see the login screen; everyone else the
 * game, wrapped in the Layout chrome. */

import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Spinner } from './components/ui';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoftPage } from './pages/LoftPage';
import { PigeonPage } from './pages/PigeonPage';
import { MarketPage } from './pages/MarketPage';
import { BreedingPage } from './pages/BreedingPage';
import { FlightsPage } from './pages/FlightsPage';
import { LiveFlightPage } from './pages/LiveFlightPage';
import { InfirmaryPage } from './pages/InfirmaryPage';
import { RankingPage } from './pages/RankingPage';

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
        <Route path="/duif/:id" element={<PigeonPage />} />
        <Route path="/markt" element={<MarketPage />} />
        <Route path="/kweek" element={<BreedingPage />} />
        <Route path="/vluchten" element={<FlightsPage />} />
        <Route path="/vluchten/:id" element={<LiveFlightPage />} />
        <Route path="/ziekenboeg" element={<InfirmaryPage />} />
        <Route path="/ranglijst" element={<RankingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
