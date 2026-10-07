/**
 * Hokinrichting (⚠️ dev, nog niet live), op de pagina Inrichting en de Markt: de inrichting kopen, het
 * hele hok inenten of kuren, en de scout. Tekst en knoppen — de regels zelf
 * staan in de wiki (#inrichting).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from './ui';
import type { InrichtingCatalogue, Loft, Pigeon } from '../types';

type Act = (fn: () => Promise<unknown>, ok?: string) => void;

function Line({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--border)' }}>
      <span style={{ flex: '1 1 180px', minWidth: 0 }}>{label}</span>
      <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{children}</span>
    </div>
  );
}

const euro = (n: number) => `€${n.toLocaleString('nl-BE')}`;

export function InrichtingCard({ loft, cat, busy, act }: { loft: Loft; cat: InrichtingCatalogue; busy: boolean; act: Act }) {
  const eq = loft.equipment!;
  const items: { key: string; owned: boolean; what: string; needs?: string }[] = [
    { key: 'ventilation', owned: eq.ventilation, what: 'minder ornithose, droger stro, iets beter herstel' },
    { key: 'run', owned: eq.run, what: 'grotere rustbonus, hoger libido' },
    { key: 'raptorGuard', owned: eq.raptorGuard, what: 'net + lokuil: geen sperwer meer', needs: eq.run ? undefined : 'eerst een ren' },
    { key: 'light', owned: eq.light, what: 'hoger libido, vlotter kweken' },
    { key: 'baskets', owned: eq.baskets, what: 'elke vlucht kost minder energie en gezondheid' },
    { key: 'weatherStation', owned: eq.weatherStation, what: 'weervoorspelling 24 u vóór de lossing' },
  ];
  const buy = (key: string, label: string, price: number) => {
    if (!window.confirm(`${label} kopen voor ${euro(price)}? Dat kan je niet terugverkopen.`)) return;
    act(() => api('/loft/equipment', { method: 'POST', body: { key } }), `${label} gekocht`);
  };
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h2 style={{ marginTop: 0 }}>🛠️ Hokinrichting</h2>
      {items.map((it) => {
        const item = cat.equipment[it.key];
        return (
          <Line key={it.key} label={<><strong>{item.label}</strong> <span className="faint">— {it.what}</span></>}>
            {it.owned ? (
              <span className="badge">✓ in je hok{item.daily ? <> · <Money value={item.daily} />/dag</> : null}</span>
            ) : it.needs ? (
              <span className="faint">{it.needs}</span>
            ) : (
              <button className="btn sm" disabled={busy || loft.money < (item.price ?? 0)} onClick={() => buy(it.key, item.label, item.price ?? 0)}>
                Kopen · <Money value={item.price ?? 0} />{item.daily ? <> + <Money value={item.daily} />/dag</> : null}
              </button>
            )}
          </Line>
        );
      })}
      <Line label={<><strong>{cat.equipment.irBoxes.label}</strong> <span className="faint">— koppels komen sneller uit, meer tweelingen · {eq.irBoxes} {eq.irBoxes === 1 ? 'bak' : 'bakken'}, {eq.irInUse} in gebruik</span></>}>
        {eq.irNextPrice != null ? (
          <button className="btn sm" disabled={busy || loft.money < eq.irNextPrice} onClick={() => {
            if (!window.confirm(`${eq.irBoxes === 0 ? 'Twee verwarmde nestbakken' : 'Een extra verwarmde nestbak'} voor ${euro(eq.irNextPrice!)}?`)) return;
            act(() => api('/loft/irbox', { method: 'POST' }), 'Infrarood geplaatst');
          }}>
            {eq.irBoxes === 0 ? '2 bakken' : '+1 bak'} · <Money value={eq.irNextPrice} />
          </button>
        ) : <span className="faint">maximum bereikt</span>}
        <span className="faint" style={{ fontSize: '0.8rem' }}><Money value={cat.equipment.irBoxes.dailyPerBoxInUse ?? 0} />/dag per bak in gebruik</span>
      </Line>
      <Line label={<><strong>{cat.equipment.magazine.label}</strong> <span className="faint">— bandbreedtes bij een privébod, marktrapport, elke maandag Het Duivenblad</span></>}>
        <button className={`btn sm ${eq.magazine ? 'accent' : 'ghost'}`} disabled={busy} onClick={() =>
          act(() => api('/loft/equipment', { method: 'POST', body: { key: 'magazine', on: !eq.magazine } }), eq.magazine ? 'Vakblad opgezegd' : 'Vakblad: welkom, abonnee 📰')}>
          {eq.magazine ? 'Opzeggen' : 'Abonneren'} · <Money value={cat.equipment.magazine.daily ?? 0} />/dag
        </button>
      </Line>
      <div className="faint" style={{ fontSize: '0.8rem', marginTop: 8 }}>
        <Link to="/wiki#inrichting">Meer info over de hokinrichting →</Link>
      </div>
    </div>
  );
}

/** "Hele hok": one vaccine or kuur for every bird at home. Per bird is on her page. */
export function VaccineCard({ loft, pigeons, cat, busy, act }: { loft: Loft; pigeons: Pigeon[]; cat: InrichtingCatalogue; busy: boolean; act: Act }) {
  const home = pigeons.filter((p) => !p.away);
  const covered = (key: string) => home.filter((p) => p.care?.vaccines.some((v) => v.key === key)).length;
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h2 style={{ marginTop: 0 }}>💉 Vaccins &amp; kuren</h2>
      <p className="faint" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Elk middel beschermt tegen één ziekte. Een vaccin houdt een duif 2 dagen aan de grond. Per duif kan het ook op haar pagina.
      </p>
      {Object.entries(cat.vaccines).map(([key, v]) => {
        const cost = home.length * v.price;
        return (
          <Line key={key} label={<><strong>{v.label}</strong> <span className="faint">— {v.disease} · {v.days} dagen · {covered(key)}/{home.length} beschermd{v.libidoHit ? ' · libido omlaag' : ''}</span></>}>
            <button className="btn sm ghost" disabled={busy || home.length === 0 || loft.money < cost} onClick={() => {
              if (v.noFlyDays && !window.confirm(`${v.label} voor het hele hok? Al je duiven mogen dan ${v.noFlyDays} dagen niet vliegen.`)) return;
              act(() => api('/loft/vaccinate', { method: 'POST', body: { key } }), `${v.label}: hele hok behandeld`);
            }}>
              Hele hok · <Money value={cost} />
            </button>
          </Line>
        );
      })}
    </div>
  );
}

export function ScoutCard({ loft, cat, busy, act }: { loft: Loft; cat: InrichtingCatalogue; busy: boolean; act: Act }) {
  const scout = loft.equipment!.scout;
  const [market, setMarket] = useState(Object.keys(cat.scout.markets)[0]);
  const [tier, setTier] = useState(Object.keys(cat.scout.tiers)[0]);
  const free = loft.capacity - loft.pigeonCount;
  const when = (iso: string) => new Date(iso).toLocaleString('nl-BE', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h2 style={{ marginTop: 0 }}>🔭 Scout op buitenlandse markten</h2>
      {scout?.status === 'away' && (
        <p style={{ margin: 0 }}>Je scout is in <strong>{scout.market}</strong> ({scout.tier}) en is terug op <strong>{when(scout.readyAt)}</strong>.</p>
      )}
      {scout?.status === 'report' && (
        <>
          <p style={{ marginTop: 0 }}>
            Scoutrapport · <strong>{scout.market}</strong> · {scout.tier} · kiezen tot {when(scout.expiresAt)} · {free} vrije {free === 1 ? 'plaats' : 'plaatsen'}
          </p>
          {scout.offers.map((o) => (
            <Line key={o.index} label={
              <span>
                <strong>{o.name}</strong> {o.sex === 'doffer' ? '♂' : '♀'} ★ {o.talent}
                {o.trait && <> · ✨ {o.trait.name}</>}
                <br />
                <span className="faint" style={{ fontSize: '0.85rem' }}>
                  snelheid {o.speed} · conditie {o.endurance} · oriëntatie {o.orientation} · gen-caps ±{o.capsEstimate.speed}/{o.capsEstimate.endurance}/{o.capsEstimate.orientation} · markt <Money value={o.marketValue} />
                </span>
              </span>
            }>
              <button className="btn sm" disabled={busy || free <= 0 || loft.money < o.price} onClick={() => {
                if (!window.confirm(`${o.name} kopen voor ${euro(o.price)}? Ze zit eerst ${cat.scout.quarantineDays} dagen in quarantaine.`)) return;
                act(() => api('/scout/buy', { method: 'POST', body: { index: o.index } }), `${o.name} komt naar je hok`);
              }}>
                Kopen · <Money value={o.price} />
              </button>
            </Line>
          ))}
          <div style={{ marginTop: 8 }}>
            <button className="btn ghost sm" disabled={busy} onClick={() => act(() => api('/scout/dismiss', { method: 'POST' }), 'Rapport gesloten')}>Niets kopen</button>
          </div>
        </>
      )}
      {(!scout || scout.status === 'expired') && (
        <>
          {scout?.status === 'expired' && <p className="faint" style={{ marginTop: 0 }}>Het vorige rapport is verlopen.</p>}
          <p className="faint" style={{ marginTop: 0, fontSize: '0.85rem' }}>
            Na {cat.scout.travelHours / 24} dagen komt hij terug met hoogstens drie duiven. Je koopt er één of geen; het scoutloon krijg je niet terug.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select value={market} onChange={(e) => setMarket(e.target.value)} style={{ width: 'auto', maxWidth: '100%', minWidth: 0 }}>
              {Object.entries(cat.scout.markets).map(([k, m]) => <option key={k} value={k}>{m.label} — {m.blurb}</option>)}
            </select>
            <select value={tier} onChange={(e) => setTier(e.target.value)} style={{ width: 'auto', maxWidth: '100%', minWidth: 0 }}>
              {Object.entries(cat.scout.tiers).map(([k, t]) => <option key={k} value={k}>{t.label} · ★ {t.scoreMin}–{t.scoreMax} · €{t.wage}</option>)}
            </select>
            <button className="btn sm" disabled={busy || loft.money < cat.scout.tiers[tier].wage} onClick={() =>
              act(() => api('/scout/send', { method: 'POST', body: { market, tier } }), 'Je scout is vertrokken ✈️')}>
              Scout sturen · <Money value={cat.scout.tiers[tier].wage} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** On her own page: entingskaart, verzekering, weduwschap. */
export function PigeonCareCard({ p, flock, cat, busy, run }: {
  p: Pigeon; flock: Pigeon[]; cat: InrichtingCatalogue; busy: boolean;
  run: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const care = p.care!;
  const day = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
  const duivinnen = flock.filter((x) => x.sex === 'duivin' && x.id !== p.id);
  return (
    <div className="card">
      <h2>💉 Verzorging &amp; verzekering</h2>
      {care.quarantineUntil && <p className="notice" style={{ marginTop: 0 }}>📦 In quarantaine tot {day(care.quarantineUntil)}: niet vliegen, niet koppelen.</p>}
      {care.noFlyUntil && <p className="notice" style={{ marginTop: 0 }}>💉 Net ingeënt: mag vliegen vanaf {day(care.noFlyUntil)}.</p>}
      <strong>Entingskaart</strong>
      {Object.entries(cat.vaccines).map(([key, v]) => {
        const has = care.vaccines.find((x) => x.key === key);
        return (
          <Line key={key} label={<>{v.label} <span className="faint">— {v.disease}{has ? ` · werkt tot ${day(has.until)}` : ''}</span></>}>
            <button className={`btn sm ${has ? 'ghost' : ''}`} disabled={busy || p.away} onClick={() => {
              if (v.noFlyDays && !window.confirm(`${v.label}? ${p.name} mag dan ${v.noFlyDays} dagen niet vliegen.`)) return;
              run(() => api(`/pigeons/${p.id}/vaccinate`, { method: 'POST', body: { key } }), `${v.label} gegeven`);
            }}>
              {has ? 'Vernieuwen' : 'Geven'} · <Money value={v.price} />
            </button>
          </Line>
        );
      })}

      <div style={{ marginTop: 12 }}><strong>🛡️ Verzekering</strong></div>
      {care.insurance ? (
        <Line label={<>Verzekerd: uitkering <Money value={care.insurance.payout} /> · premie <Money value={care.insurance.premium} />/dag</>}>
          <button className="btn ghost sm" disabled={busy} onClick={() => run(() => api(`/pigeons/${p.id}/insurance`, { method: 'POST', body: { on: false } }), 'Verzekering opgezegd')}>Opzeggen</button>
        </Line>
      ) : care.insuranceQuote && care.insuranceQuote.payout > 0 ? (
        <Line label={<>Uitkering <Money value={care.insuranceQuote.payout} /> ({Math.round(cat.insurancePayoutRate * 100)}% van haar marktwaarde) · premie <Money value={care.insuranceQuote.premium} />/dag</>}>
          <button className="btn sm" disabled={busy} onClick={() => run(() => api(`/pigeons/${p.id}/insurance`, { method: 'POST', body: { on: true } }), 'Verzekerd 🛡️')}>Verzekeren</button>
        </Line>
      ) : <p className="faint" style={{ margin: '4px 0' }}>Geen marktwaarde om te verzekeren.</p>}

      {p.sex === 'doffer' && (
        <>
          <div style={{ marginTop: 12 }}><strong>❤️ Weduwschap</strong></div>
          {!p.compartment ? (
            <p className="faint" style={{ margin: '4px 0' }}>Een weduwnaar heeft een apart hok nodig.</p>
          ) : (
            <Line label={care.widow ? <>Vliegt naar <strong>{care.widow.name}</strong> · <Money value={cat.widowFee} /> per vlucht</> : <>Kies een duivin die thuis op hem wacht · <Money value={cat.widowFee} /> per vlucht</>}>
              <select
                value={care.widow?.id ?? ''}
                disabled={busy}
                onChange={(e) => run(() => api(`/pigeons/${p.id}/widow`, { method: 'POST', body: { duivinId: e.target.value || null } }), e.target.value ? 'Weduwschap ingesteld' : 'Weduwschap gestopt')}
                style={{ width: 'auto' }}
              >
                <option value="">Geen weduwschap</option>
                {duivinnen.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Line>
          )}
        </>
      )}
      <div className="faint" style={{ fontSize: '0.8rem', marginTop: 8 }}>
        <Link to="/wiki#inrichting">Meer info over vaccins, verzekering en weduwschap →</Link>
      </div>
    </div>
  );
}
