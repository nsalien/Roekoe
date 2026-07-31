/** Duivenmarkt: browse and buy pigeons listed by other players, with sale history. */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Money, Spinner, countdownTo, useToast } from '../components/ui';
import { PigeonCard } from '../components/PigeonCard';
import { PigeonAvatar } from '../components/PigeonAvatar';
import type { AuctionInfo, Pigeon, Trade } from '../types';

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
  const [auctions, setAuctions] = useState<AuctionInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ listings: Pigeon[]; trades: Trade[]; auctions: AuctionInfo[] }>('/market');
    setListings(res.listings);
    setTrades(res.trades ?? []);
    setAuctions(res.auctions ?? []);
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

  async function bid(auctionId: string, amount: number) {
    setBusy(true);
    try {
      await api('/auction/bid', { method: 'POST', body: { auctionId, amount } });
      toast.show('Bod geplaatst! 🔨', 'ok');
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
      <div className="page-head" data-tour="market">
        <div>
          <h1>Duivenmarkt</h1>
          <p className="muted">
            Koop van andere spelers of bied op de veilingen (zondagveiling &amp; opvangcentrum). Jouw kassa: <Money value={money} />
          </p>
        </div>
      </div>

      {auctions.filter((a) => a.pigeon).map((a) => (
        <AuctionCard key={a.id} auction={a} money={money} busy={busy} onBid={bid} />
      ))}

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

function AuctionCard({
  auction,
  money,
  busy,
  onBid,
}: {
  auction: AuctionInfo;
  money: number;
  busy: boolean;
  onBid: (auctionId: string, amount: number) => void;
}) {
  const p = auction.pigeon!;
  const shelter = auction.kind === 'shelter';
  const [amount, setAmount] = useState(auction.minNextBid);
  // Keep the input at least the minimum next bid as it rises.
  useEffect(() => {
    setAmount((a) => Math.max(a, auction.minNextBid));
  }, [auction.minNextBid]);

  const accent = shelter ? 'var(--good)' : 'var(--accent)';
  return (
    <div className="card" style={{ borderColor: accent, marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="badge" style={{ background: accent, color: '#fff' }}>
            {shelter ? '🏠 OPVANGCENTRUM' : '🔨 ZONDAGVEILING'}
          </span>
          <strong>{shelter ? 'Duif zoekt een baasje' : 'Topduif onder de hamer'}</strong>
        </div>
        <span className="faint">sluit {countdownTo(auction.endAt)}</span>
      </div>

      {shelter && (
        <p className="faint" style={{ margin: '8px 0 0', fontSize: '0.85rem' }}>
          Geen renduif, maar met wat training en geduld groeit die er wel bovenop — en later weer te koop.
        </p>
      )}

      <div className="row" style={{ gap: 14, alignItems: 'center', marginTop: 12 }}>
        <PigeonAvatar pigeon={p} size={72} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/duif/${p.id}`} style={{ color: 'inherit' }}><strong style={{ fontSize: '1.05rem' }}>{p.name}</strong></Link>
          <div className="faint">★ talent {p.talent} · {p.sex} · geschatte waarde <Money value={p.value} /></div>
          <div style={{ marginTop: 4 }}>
            {auction.currentBid > 0 ? (
              <>Hoogste bod: <strong><Money value={auction.currentBid} /></strong> <span className="faint">door {auction.currentBidderName}</span></>
            ) : (
              <span className="faint">Nog geen bod — startbod <Money value={auction.minNextBid} /></span>
            )}
          </div>
        </div>
      </div>

      <hr className="sep" />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          type="number"
          value={amount}
          min={auction.minNextBid}
          step={5}
          onChange={(e) => setAmount(Number(e.target.value))}
          style={{ maxWidth: 140 }}
        />
        <button
          className="btn accent"
          disabled={busy || amount < auction.minNextBid || amount > money}
          onClick={() => onBid(auction.id, amount)}
        >
          Bied <Money value={amount} />
        </button>
        <span className="faint" style={{ alignSelf: 'center' }}>min. {auction.minNextBid}</span>
      </div>
    </div>
  );
}
