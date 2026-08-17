/** Duivenmarkt: browse and buy pigeons listed by other players, with sale history. */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { BreedBadge, Money, PigeonStats, Spinner, countdownTo, useToast } from '../components/ui';
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

  // While any auction is in its final minutes, gently poll the board so other
  // players' bids and anti-snipe extensions appear without a manual refresh.
  useEffect(() => {
    const soon = auctions.some((a) => {
      const r = Date.parse(a.endAt) - Date.now();
      return r > 0 && r <= 6 * 60 * 1000;
    });
    if (!soon) return;
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [auctions, load]);

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

  // When an auction's countdown reaches zero, reload the board so the closed
  // auction settles/disappears and any winnings show up — no manual refresh.
  const onAuctionExpire = useCallback(() => {
    void load();
    void refresh();
  }, [load, refresh]);

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
        <AuctionCard key={a.id} auction={a} money={money} busy={busy} onBid={bid} onExpire={onAuctionExpire} />
      ))}

      {listings.length === 0 && (
        <div className="card muted">
          Geen duiven te koop op dit moment. Zet er zelf een te koop vanuit je hok!
        </div>
      )}

      <div className="grid pigeons">
        {listings.map((p) => (
          <PigeonCard key={p.id} pigeon={p} showOwner showBreed showcase avatarSize={104}>
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
      <div className="page-head" style={{ marginTop: 26 }} data-tour="market-bid">
        <div>
          <h2>🕊️ Bied op duiven van andere spelers</h2>
          <p className="muted">
            Kies een speler, vervolgens een van zijn duiven en bepaal je bedrag.
          </p>
        </div>
      </div>
      <BidCascade
        biddable={biddable}
        sent={sent}
        busy={busy}
        money={money}
        onBid={(pigeonId, amount) => offerAct(() => api(`/pigeons/${pigeonId}/offer`, { method: 'POST', body: { amount } }), 'Bod uitgebracht! 🤝')}
        onWithdraw={(id) => offerAct(() => api(`/offers/${id}/withdraw`, { method: 'POST' }), 'Bod ingetrokken')}
      />

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

/**
 * Player → pigeon → amount cascade for bidding on another player's bird.
 * Only the general score (talent) is shown for the chosen pigeon; the precise
 * attributes are withheld server-side (revealed=false), so the bidder never
 * knows exactly what they buy.
 */
function BidCascade({
  biddable, sent, busy, money, onBid, onWithdraw,
}: {
  biddable: Pigeon[];
  sent: OfferView[];
  busy: boolean;
  money: number;
  onBid: (pigeonId: string, amount: number) => void;
  onWithdraw: (offerId: string) => void;
}) {
  const [ownerId, setOwnerId] = useState('');
  const [pigeonId, setPigeonId] = useState('');
  const [amount, setAmount] = useState(0);

  // Distinct owners of biddable pigeons, alphabetical.
  const owners = Array.from(
    new Map(biddable.map((p) => [p.ownerId, p.ownerName])).entries(),
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const ownerPigeons = biddable
    .filter((p) => p.ownerId === ownerId)
    .sort((a, b) => b.talent - a.talent);
  const selected = ownerPigeons.find((p) => p.id === pigeonId) ?? null;
  const myOffer = selected ? sent.find((o) => o.pigeonId === selected.id) ?? null : null;

  if (biddable.length === 0) {
    return <div className="card muted">Geen duiven van andere spelers om op te bieden.</div>;
  }

  return (
    <div className="card">
      <div className="field">
        <label>1. Kies een speler</label>
        <select
          value={ownerId}
          disabled={busy}
          onChange={(e) => { setOwnerId(e.target.value); setPigeonId(''); setAmount(0); }}
        >
          <option value="">— kies een speler —</option>
          {owners.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </div>

      {ownerId && (
        <div className="field">
          <label>2. Kies een duif</label>
          <select
            value={pigeonId}
            disabled={busy}
            onChange={(e) => { setPigeonId(e.target.value); setAmount(0); }}
          >
            <option value="">— kies een duif —</option>
            {ownerPigeons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · ★{p.talent} · {p.sex}
              </option>
            ))}
          </select>
        </div>
      )}

      {selected && (
        <>
          <div className="row" style={{ gap: 12, alignItems: 'center', margin: '10px 0' }}>
            <PigeonAvatar pigeon={selected} size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link to={`/duif/${selected.id}`} style={{ color: 'inherit' }}>
                <strong style={{ fontSize: '1.05rem' }}>{selected.name}</strong>
              </Link>
              <div className="faint">★ talent {selected.talent} · {selected.sex} · {selected.ageWeeks} wk</div>
              <div className="faint" style={{ fontSize: '0.82rem', marginTop: 2 }}>
                🔒 Precieze eigenschappen onbekend — bekijk de <Link to="/ranglijst">ranglijst</Link> of vluchtresultaten.
              </div>
            </div>
          </div>

          {myOffer ? (
            <div className="stack" style={{ gap: 4 }}>
              <span className="faint">
                Jouw bod: <strong><Money value={myOffer.amount} /></strong> · wacht op antwoord van {selected.ownerName}.
              </span>
              <button className="btn ghost block" disabled={busy} onClick={() => onWithdraw(myOffer.id)}>Trek bod in</button>
            </div>
          ) : (
            <div className="field">
              <label>3. Jouw bod</label>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="number"
                  min={1}
                  value={amount || ''}
                  placeholder="bedrag"
                  onChange={(e) => setAmount(Number(e.target.value))}
                  style={{ maxWidth: 160 }}
                />
                <button
                  className="btn accent"
                  disabled={busy || !(amount > 0) || amount > money}
                  onClick={() => { onBid(selected.id, amount); setAmount(0); }}
                >
                  Bied <Money value={amount || 0} />
                </button>
                <span className="faint" style={{ alignSelf: 'center' }}>je kassa: <Money value={money} /></span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AuctionCard({
  auction,
  money,
  busy,
  onBid,
  onExpire,
}: {
  auction: AuctionInfo;
  money: number;
  busy: boolean;
  onBid: (auctionId: string, amount: number) => void;
  onExpire: () => void;
}) {
  const p = auction.pigeon!;
  const shelter = auction.kind === 'shelter';
  const [amount, setAmount] = useState(auction.minNextBid);
  // Keep the input at least the minimum next bid as it rises.
  useEffect(() => {
    setAmount((a) => Math.max(a, auction.minNextBid));
  }, [auction.minNextBid]);

  // Live-ticking countdown so no manual refresh is needed. We self-schedule the
  // next tick from the time left: coarse (30 s) when the close is far off, then
  // once per second in the final 5 minutes for a smooth real-time countdown.
  // When the auction closes we ask the parent to reload so it disappears/settles.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const endMs = Date.parse(auction.endAt);
    let timer: ReturnType<typeof setTimeout>;
    let expired = false;
    const tick = () => {
      const now = Date.now();
      setNowMs(now);
      const remaining = endMs - now;
      if (remaining <= 0) {
        if (!expired) { expired = true; onExpire(); }
        return; // stop ticking once closed
      }
      timer = setTimeout(tick, remaining <= 5 * 60 * 1000 ? 1000 : 30000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [auction.endAt, onExpire]);

  const remainingMs = Date.parse(auction.endAt) - nowMs;
  const closingSoon = remainingMs > 0 && remainingMs <= auction.antiSnipeMinutes * 60 * 1000;
  // Endgame: inside the final phase every player has a hard bid budget on this
  // bird, so we show what is left instead of letting them find out on a refusal.
  const finalPhase = remainingMs > 0 && remainingMs <= auction.finalPhaseMinutes * 60 * 1000;
  const outOfBids = finalPhase && auction.bidsLeft <= 0;

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
        <span className="faint" style={closingSoon ? { color: 'var(--accent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' } : undefined}>
          {remainingMs <= 0 ? '🔨 sluit nu…' : <>{closingSoon ? '⏳ ' : ''}sluit {countdownTo(auction.endAt, nowMs)}</>}
        </span>
      </div>

      {shelter && (
        <p className="faint" style={{ margin: '8px 0 0', fontSize: '0.85rem' }}>
          Geen renduif, maar met wat training en geduld groeit die er wel bovenop — en later weer te koop.
        </p>
      )}

      <div className="row" style={{ gap: 14, alignItems: 'center', marginTop: 12 }}>
        <PigeonAvatar pigeon={p} size={112} shape="showcase" />
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

      {/* Full width, so a long breed name never wraps in the narrow column. */}
      <div style={{ marginTop: 8 }}><BreedBadge breed={p.breed} /></div>

      {/* You must be able to see what you are bidding on: an auction bird shows
          its full attributes, just like a bird listed on the market. */}
      <div style={{ marginTop: 10 }}>
        <PigeonStats pigeon={p} />
      </div>

      <hr className="sep" />

      {/* Bid budget for the endgame */}
      {finalPhase ? (
        <div
          className="row"
          style={{
            justifyContent: 'space-between', gap: 8, marginBottom: 10, padding: '8px 10px',
            borderRadius: 8, background: outOfBids ? 'var(--bad-soft)' : 'var(--gold-soft)',
            color: outOfBids ? 'var(--bad)' : 'var(--gold)', fontSize: '0.84rem', flexWrap: 'wrap',
          }}
        >
          <strong>⏱️ Slotfase — nog {auction.bidsLeft} van je {auction.maxBids} biedingen</strong>
          <span>
            {outOfBids
              ? 'Je biedingen zijn op voor deze duif.'
              : `Je bood al ${auction.bidsUsed}× sinds de laatste ${auction.finalPhaseMinutes} minuten. Bied meteen je maximum.`}
          </span>
        </div>
      ) : (
        <p className="faint" style={{ margin: '0 0 10px', fontSize: '0.8rem' }}>
          Vrij bieden tot {auction.finalPhaseMinutes} minuten voor het einde. Daarna heeft
          elke speler nog maar <strong>{auction.maxBids}</strong> biedingen op deze duif.
        </p>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          type="number"
          value={amount}
          min={auction.minNextBid}
          step={5}
          onChange={(e) => setAmount(Number(e.target.value))}
          style={{ maxWidth: 140 }}
          disabled={outOfBids}
        />
        <button
          className="btn accent"
          disabled={busy || outOfBids || amount < auction.minNextBid || amount > money}
          onClick={() => onBid(auction.id, amount)}
        >
          Bied <Money value={amount} />
        </button>
        <span className="faint" style={{ alignSelf: 'center' }}>min. {auction.minNextBid}</span>
      </div>
      {closingSoon && !outOfBids && (
        <p className="faint" style={{ margin: '8px 0 0', fontSize: '0.78rem' }}>
          Bied je nu nog, dan schuift de klok terug naar {auction.antiSnipeMinutes} minuten —
          winnen op de valreep lukt dus niet.
        </p>
      )}
    </div>
  );
}
