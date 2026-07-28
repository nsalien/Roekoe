/** Duivenmarkt: browse and buy pigeons listed by other players, with sale history. */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Money, Spinner, useToast } from '../components/ui';
import { PigeonCard } from '../components/PigeonCard';
import type { Pigeon, Trade } from '../types';

/** A short "x min geleden" style relative time. */
function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'net';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min geleden`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} u geleden`;
  return `${Math.floor(h / 24)} d geleden`;
}

export function MarketPage() {
  const { state, refresh } = useGame();
  const toast = useToast();
  const [listings, setListings] = useState<Pigeon[] | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ listings: Pigeon[]; trades: Trade[] }>('/market');
    setListings(res.listings);
    setTrades(res.trades ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load, state?.world.currentWeek]);

  async function buy(p: Pigeon) {
    setBusy(true);
    try {
      await api('/market/buy', { method: 'POST', body: { pigeonId: p.id } });
      toast.show(`${p.name} gekocht! 🕊️`, 'ok');
      await load();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  if (!listings) return <Spinner />;
  const money = state?.loft?.money ?? 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Duivenmarkt</h1>
          <p className="muted">
            Enkel duiven van echte spelers. Jouw kassa: <Money value={money} />
          </p>
        </div>
      </div>

      {listings.length === 0 && (
        <div className="card muted">
          Geen duiven te koop op dit moment. Zet er zelf een te koop vanuit je hok!
        </div>
      )}

      <div className="grid pigeons">
        {listings.map((p) => (
          <PigeonCard key={p.id} pigeon={p} showOwner>
            <button
              className="btn accent block"
              disabled={busy || money < (p.price ?? 0)}
              onClick={() => buy(p)}
            >
              Koop · <Money value={p.price ?? 0} />
            </button>
          </PigeonCard>
        ))}
      </div>

      {/* Buy/sell history */}
      <div className="page-head" style={{ marginTop: 26 }}>
        <h2>Verkoopgeschiedenis</h2>
      </div>
      <div className="card">
        {trades.length === 0 ? (
          <p className="muted">Nog geen transacties. Wees de eerste die handelt!</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Duif</th>
                  <th>Verkoper</th>
                  <th>Koper</th>
                  <th className="num">Prijs</th>
                  <th className="num">Wanneer</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id}>
                    <td>{t.pigeonName}</td>
                    <td>{t.sellerName}</td>
                    <td>{t.buyerName}</td>
                    <td className="num"><Money value={t.price} /></td>
                    <td className="num faint">{ago(t.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
