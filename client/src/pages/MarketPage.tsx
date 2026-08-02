/** Duivenmarkt: browse and buy pigeons listed by other players, with sale history. */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Money, Spinner, countdownTo, useToast } from '../components/ui';
import { PigeonCard } from '../components/PigeonCard';
import { PigeonAvatar } from '../components/PigeonAvatar';
import type { AuctionInfo, OfferView, Pigeon, Trade } from '../types';

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
  const [biddable, setBiddable] = useState<Pigeon[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [auctions, setAuctions] = useState<AuctionInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ listings: Pigeon[]; biddable: Pigeon[]; trades: Trade[]; auctions: AuctionInfo[] }>('/market');
    setListings(res.listings);
    setBiddable(res.biddable ?? []);
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

  async function offerAct(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (ok) toast.show(ok, 'ok');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  if (!listings) return <Spinner />;
  const money = state?.loft?.money ?? 0;
  const received = state?.offers?.received ?? [];
  const sent = state?.offers?.sent ?? [];

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

      {received.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--brand)', marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>🤝 Biedingen op jouw duiven</h2>
          <div className="stack" style={{ gap: 6 }}>
            {received.map((o) => (
              <div key={o.id} className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span>
                  <strong>{o.fromUserName}</strong> biedt <strong><Money value={o.amount} /></strong> op{' '}
                  <Link to={`/duif/${o.pigeonId}`} style={{ color: 'inherit' }}>{o.pigeonName}</Link>
                  <span className="faint"> · {ago(o.createdAt)}</span>
                </span>
                <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                  <button className="btn accent sm" disabled={busy}
                    onClick={() => offerAct(() => api(`/offers/${o.id}/respond`, { method: 'POST', body: { accept: true } }), `${o.pigeonName} verkocht!`)}>
                    Accepteer
                  </button>
                  <button className="btn ghost sm" disabled={busy}
                    onClick={() => offerAct(() => api(`/offers/${o.id}/respond`, { method: 'POST', body: { accept: false } }))}>
                    Weiger
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sent.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Jouw uitgebrachte biedingen</h2>
          <div className="stack" style={{ gap: 6 }}>
            {sent.map((o) => (
              <div key={o.id} className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span>
                  Je biedt <strong><Money value={o.amount} /></strong> op{' '}
                  <Link to={`/duif/${o.pigeonId}`} style={{ color: 'inherit' }}>{o.pigeonName}</Link>
                  <span className="faint"> · van {o.toUserName}, wacht op antwoord</span>
                </span>
                <button className="btn ghost sm" disabled={busy} style={{ flexShrink: 0 }}
                  onClick={() => offerAct(() => api(`/offers/${o.id}/withdraw`, { method: 'POST' }), 'Bod ingetrokken')}>
                  Trek in
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Bid on any other player's pigeon — listed or not. */}
      <div className="page-head" style={{ marginTop: 26 }}>
        <div>
          <h2>🕊️ Bied op duiven van andere spelers</h2>
          <p className="muted">Ook duiven die niet te koop staan. Je bod blijft geldig tot de eigenaar het aanvaardt of weigert; je kan het altijd intrekken.</p>
        </div>
      </div>
      {biddable.length === 0 ? (
        <div className="card muted">Geen duiven van andere spelers om op te bieden.</div>
      ) : (
        <div className="grid pigeons">
          {biddable.map((p) => (
            <PigeonCard key={p.id} pigeon={p} showOwner>
              <BidControl
                myOffer={sent.find((o) => o.pigeonId === p.id) ?? null}
                busy={busy}
                money={money}
                onBid={(amount) => offerAct(() => api(`/pigeons/${p.id}/offer`, { method: 'POST', body: { amount } }), 'Bod uitgebracht! 🤝')}
                onWithdraw={(id) => offerAct(() => api(`/offers/${id}/withdraw`, { method: 'POST' }), 'Bod ingetrokken')}
              />
            </PigeonCard>
          ))}
        </div>
      )}

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

function BidControl({
  myOffer, busy, money, onBid, onWithdraw,
}: {
  myOffer: OfferView | null;
  busy: boolean;
  money: number;
  onBid: (amount: number) => void;
  onWithdraw: (offerId: string) => void;
}) {
  const [amount, setAmount] = useState(0);
  if (myOffer) {
    return (
      <div className="stack" style={{ gap: 4 }}>
        <span className="faint" style={{ textAlign: 'center' }}>
          Jouw bod: <strong><Money value={myOffer.amount} /></strong> · wacht op antwoord
        </span>
        <button className="btn ghost block" disabled={busy} onClick={() => onWithdraw(myOffer.id)}>Trek bod in</button>
      </div>
    );
  }
  return (
    <div className="row" style={{ gap: 6 }}>
      <input
        type="number"
        min={1}
        value={amount || ''}
        placeholder="bedrag"
        onChange={(e) => setAmount(Number(e.target.value))}
        style={{ flex: 1, minWidth: 0 }}
      />
      <button
        className="btn accent"
        style={{ flexShrink: 0 }}
        disabled={busy || !(amount > 0) || amount > money}
        onClick={() => onBid(amount)}
      >
        Bied
      </button>
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
