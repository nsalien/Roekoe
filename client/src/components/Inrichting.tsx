/**
 * Hokinrichting (⚠️ dev, nog niet live): de kaarten van de pagina Inrichting,
 * gegroepeerd op waarvoor iets dient — bouwen & uitbreiden, hygiëne & klimaat,
 * vaccins, kweek en vluchten — plus het vakblad en de scout op de Markt en de
 * verzorgingskaart op de pagina van een duif. Tekst en knoppen; de regels zelf
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
      <span style={{ flex: '1 1 240px', minWidth: 0 }}>{label}</span>
      <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{children}</span>
    </div>
  );
}

function Card({ title, tour, children }: { title: string; tour?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 18 }} data-tour={tour}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </div>
  );
}

const euro = (n: number) => `€${n.toLocaleString('nl-BE')}`;

const ICON: Record<string, string> = {
  ventilation: '🌬️', run: '🌳', raptorGuard: '🦅', light: '💡', irBoxes: '🔥',
  baskets: '🧺', weatherStation: '📡', partnerhok: '💑', magazine: '📰',
};

/** One piece of inrichting you buy once: in your loft, waiting on another, or a buy button. */
function EquipmentLine({ k, owned, what, needs, loft, cat, busy, act }: {
  k: string; owned: boolean; what: string; needs?: string;
  loft: Loft; cat: InrichtingCatalogue; busy: boolean; act: Act;
}) {
  const item = cat.equipment[k];
  const price = item.price ?? 0;
  return (
    <Line label={<><strong>{ICON[k]} {item.label}</strong> <span className="faint">— {what}</span></>}>
      {owned ? (
        <span className="badge">✓ in je hok{item.daily ? <> · <Money value={item.daily} />/dag</> : null}</span>
      ) : needs ? (
        <span className="faint">{needs}</span>
      ) : (
        <button className="btn sm" disabled={busy || loft.money < price} onClick={() => {
          if (!window.confirm(`${item.label} kopen voor ${euro(price)}? Dat kan je niet terugverkopen.`)) return;
          act(() => api('/loft/equipment', { method: 'POST', body: { key: k } }), `${item.label} gekocht`);
        }}>
          Kopen · <Money value={price} />{item.daily ? <> + <Money value={item.daily} />/dag</> : null}
        </button>
      )}
    </Line>
  );
}

/**
 * Bouwen & uitbreiden: every room and structure you add to the loft, side by
 * side — plaatsen, aparte hokken, partnerhokken, ziekenboegbedden, the buitenren
 * and the net over it. None of it can be sold back, so each one asks first.
 */
export function BuildCard({ loft, cat, upkeepBands, busy, act }: {
  loft: Loft; cat: InrichtingCatalogue | null; upkeepBands: { upTo: number; perPigeon: number }[]; busy: boolean; act: Act;
}) {
  const eq = loft.equipment;
  // Daily upkeep rate the NEXT bird would fall into (bands are ascending; the
  // last one also covers anything beyond it).
  const nextBirdRate = upkeepBands.length
    ? (upkeepBands.find((b) => loft.pigeonCount + 1 <= b.upTo) ?? upkeepBands[upkeepBands.length - 1]).perPigeon
    : null;
  // Bound to consts so the narrowing survives into the click handlers.
  const nextCap = loft.nextCapacity;
  const compartmentCost = loft.compartmentCost;
  const nextBeds = loft.nextInfirmary;
  return (
    <Card title="🏗️ Bouwen & uitbreiden" tour="upgrades">
      <Line label={
        <>
          <strong>🏠 Hokcapaciteit</strong>{' '}
          <span className="faint">
            — nu {loft.capacity} plaatsen
            {/* Upkeep rises per band: name what the next bird costs, so a bigger
                loft is never a hidden recurring cost. */}
            {nextBirdRate !== null && <> · je volgende duif kost €{nextBirdRate}/dag aan onderhoud (<Link to="/wiki#hok">schijven</Link>)</>}
          </span>
        </>
      }>
        {nextCap ? (
          <button
            className="btn accent sm"
            disabled={busy || loft.money < nextCap.price}
            onClick={() => {
              if (!window.confirm(
                `Ben je zeker dat je je hok wil uitbreiden naar ${nextCap.capacity} plaatsen voor ${euro(nextCap.price)}?\n\n`
                + `Dat bedrag gaat er meteen af.`
                + (nextBirdRate !== null ? ` Je volgende duif kost daarna €${nextBirdRate}/dag aan onderhoud.` : ''),
              )) return;
              act(() => api('/loft/capacity', { method: 'POST' }), 'Hok uitgebreid! 🏠');
            }}
          >
            Naar {nextCap.capacity} · <Money value={nextCap.price} />
          </button>
        ) : <span className="faint">maximum bereikt</span>}
      </Line>
      <Line label={<><strong>🧱 Aparte hokken</strong> <span className="faint">— {loft.compartmentsUsed}/{loft.compartments} in gebruik · beter energieherstel en minder ziekte; wie apart zit kies je op <Link to="/hok">Mijn hok</Link></span></>}>
        {compartmentCost != null ? (
          <button
            className="btn sm"
            disabled={busy || loft.money < compartmentCost}
            onClick={() => {
              if (!window.confirm(
                `Ben je zeker dat je een apart hok wil bijbouwen voor ${euro(compartmentCost)}?\n\n`
                + `Dat bedrag gaat er meteen af, en elk volgend apart hok wordt duurder.`,
              )) return;
              act(() => api('/loft/compartment', { method: 'POST' }), 'Apart hok gebouwd! 🧱');
            }}
          >
            Bijbouwen · <Money value={compartmentCost} />
          </button>
        ) : <span className="faint">elke plaats heeft er al een</span>}
      </Line>
      {eq && cat && (
        <Line label={<><strong>{ICON.partnerhok} {cat.equipment.partnerhok.label}</strong> <span className="faint">— twee duiven wennen er samen aan elkaar, ook vanuit een apart hok: sneller en minder kans op weigeren · {eq.partnerhokken === 0 ? 'nog geen' : `${eq.partnerhokken} gebouwd, ${eq.partnerhokInUse} in gebruik`}</span></>}>
          {eq.partnerhokNextPrice != null ? (
            <button className="btn sm" disabled={busy || loft.money < eq.partnerhokNextPrice} onClick={() => {
              if (!window.confirm(`Een partnerhok bouwen voor ${euro(eq.partnerhokNextPrice!)}?`)) return;
              act(() => api('/loft/partnerhok', { method: 'POST' }), 'Partnerhok gebouwd');
            }}>
              +1 · <Money value={eq.partnerhokNextPrice} /> + <Money value={cat.equipment.partnerhok.dailyPerBox ?? 0} />/dag
            </button>
          ) : <span className="faint">maximum bereikt</span>}
        </Line>
      )}
      <Line label={<><strong>🛏️ Ziekenboeg</strong> <span className="faint">— {loft.infirmaryCapacity} bedden, {loft.infirmaryCount} bezet · dokters, kinesisten en medicinaal voer op de <Link to="/ziekenboeg">ziekenboeg</Link></span></>}>
        {nextBeds ? (
          <button className="btn sm" disabled={busy || loft.money < nextBeds.price} onClick={() => {
            if (!window.confirm(`De ziekenboeg uitbreiden naar ${nextBeds.capacity} bedden voor ${euro(nextBeds.price)}?`)) return;
            act(() => api('/loft/infirmary/upgrade', { method: 'POST' }), 'Ziekenboeg uitgebreid! 🏥');
          }}>
            Naar {nextBeds.capacity} · <Money value={nextBeds.price} />
          </button>
        ) : <span className="faint">maximum bereikt</span>}
      </Line>
      {eq && cat && (
        <>
          <EquipmentLine k="run" owned={eq.run} what="grotere rustbonus, hoger libido; trekt soms een sperwer aan" loft={loft} cat={cat} busy={busy} act={act} />
          <EquipmentLine k="raptorGuard" owned={eq.raptorGuard} what="net + lokuil boven de ren: geen sperwer meer" needs={eq.run ? undefined : 'eerst een buitenren'} loft={loft} cat={cat} busy={busy} act={act} />
        </>
      )}
    </Card>
  );
}

/**
 * Hygiëne & klimaat: the meter, what it does now, fresh straw, the hokpoetser
 * and the dakventilatie (drier straw: the meter drops slower). The rule itself
 * (decay, the ×0,8, the floor) is in the wiki.
 */
export function HygieneCard({ loft, cat, busy, act }: { loft: Loft; cat: InrichtingCatalogue | null; busy: boolean; act: Act }) {
  const eq = loft.equipment!;
  const h = Math.round(eq.hygiene);
  const effect = eq.illnessMult < 1
    ? `Minder kans op ziekte (×${eq.illnessMult.toLocaleString('nl-BE')})`
    : 'Geen effect: onder 50 is het zoals altijd';
  return (
    <Card title="🧹 Hygiëne & klimaat">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong>Hokhygiëne</strong>
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{h}</strong>
      </div>
      <div className="faint" style={{ fontSize: '0.8rem' }}>
        {effect} · zakt vannacht ~{Math.round(eq.decayPerDay)}
        {eq.lastStrawAt ? '' : ' · nog nooit stro gestrooid'}
      </div>
      <div className="row" style={{ gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
        <button
          className="btn sm"
          disabled={busy || h >= 100 || loft.money < eq.strawCost}
          onClick={() => act(() => api('/loft/straw', { method: 'POST' }), 'Vers stro gestrooid 🌾')}
        >
          🌾 Vers stro · <Money value={eq.strawCost} />
        </button>
        <button
          className={`btn sm ${eq.cleaner ? 'accent' : 'ghost'}`}
          disabled={busy}
          onClick={() => act(
            () => api('/loft/cleaner', { method: 'POST', body: { on: !eq.cleaner } }),
            eq.cleaner ? 'Hokpoetser ontslagen' : 'Hokpoetser aangenomen 🧹',
          )}
        >
          {eq.cleaner ? '🧹 Hokpoetser ontslaan' : '🧹 Hokpoetser aannemen'} · <Money value={eq.cleanerWage} />/dag
        </button>
      </div>
      {cat && (
        <EquipmentLine k="ventilation" owned={eq.ventilation} what="droger stro (de hygiëne zakt trager), minder ornithose, iets beter herstel" loft={loft} cat={cat} busy={busy} act={act} />
      )}
      <div className="faint" style={{ fontSize: '0.8rem', marginTop: 8 }}>
        <Link to="/wiki#hygiene">Meer info over hokhygiëne →</Link>
      </div>
    </Card>
  );
}

/** Kweek: what makes breeding go faster. Koppels and nests themselves are on the Kweek page. */
export function BreedingGearCard({ loft, cat, busy, act }: { loft: Loft; cat: InrichtingCatalogue; busy: boolean; act: Act }) {
  const eq = loft.equipment!;
  return (
    <Card title="🥚 Kweek">
      <EquipmentLine k="light" owned={eq.light} what="hoger libido, vlotter kweken" loft={loft} cat={cat} busy={busy} act={act} />
      <Line label={<><strong>{ICON.irBoxes} {cat.equipment.irBoxes.label}</strong> <span className="faint">— koppels komen sneller uit, meer tweelingen · {eq.irBoxes} {eq.irBoxes === 1 ? 'bak' : 'bakken'}, {eq.irInUse} in gebruik</span></>}>
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
      <div className="faint" style={{ fontSize: '0.8rem', marginTop: 8 }}>
        Koppels en nesten start je op de pagina <Link to="/kweek">Kweek</Link>; het partnerhok staat bij Bouwen &amp; uitbreiden.
      </div>
    </Card>
  );
}

/** Vluchten: what you buy for the races themselves. */
export function FlightGearCard({ loft, cat, busy, act }: { loft: Loft; cat: InrichtingCatalogue; busy: boolean; act: Act }) {
  const eq = loft.equipment!;
  return (
    <Card title="🏁 Vluchten">
      <EquipmentLine k="baskets" owned={eq.baskets} what="elke vlucht kost minder energie en gezondheid" loft={loft} cat={cat} busy={busy} act={act} />
      <EquipmentLine k="weatherStation" owned={eq.weatherStation} what="weervoorspelling 24 u vóór de lossing" loft={loft} cat={cat} busy={busy} act={act} />
    </Card>
  );
}

/**
 * Vakblad, on the Markt: all it gives is market news (bands on a private offer,
 * the marktrapport, Het Duivenblad), so it sits with the report it unlocks.
 */
export function MagazineCard({ loft, cat, busy, act }: { loft: Loft; cat: InrichtingCatalogue; busy: boolean; act: Act }) {
  const on = loft.equipment!.magazine;
  const m = cat.equipment.magazine;
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <span style={{ flex: '1 1 180px', minWidth: 0 }}>
          <strong>{ICON.magazine} {m.label}</strong>{' '}
          <span className="faint">— {on ? 'je bent abonnee: ' : ''}bandbreedtes bij een privébod, het marktrapport en elke maandag Het Duivenblad</span>
        </span>
        <button className={`btn sm ${on ? 'accent' : 'ghost'}`} disabled={busy} onClick={() =>
          act(() => api('/loft/equipment', { method: 'POST', body: { key: 'magazine', on: !on } }), on ? 'Vakblad opgezegd' : 'Vakblad: welkom, abonnee 📰')}>
          {on ? 'Opzeggen' : 'Abonneren'} · <Money value={m.daily ?? 0} />/dag
        </button>
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
        <p style={{ margin: 0 }}>
          Je scout is in <strong>{scout.market}</strong> ({scout.tier}) · dag {scout.day}
          {scout.maxDays ? <> van hoogstens {scout.maxDays}</> : null}. Elke dag wordt de kans groter dat hij terugkomt.
        </p>
      )}
      {scout?.status === 'report' && (
        <>
          <p style={{ marginTop: 0 }}>
            Scoutrapport · <strong>{scout.market}</strong> · {scout.tier}
            {scout.offers.length > 0 && <> · kiezen tot {when(scout.expiresAt!)} · {free} vrije {free === 1 ? 'plaats' : 'plaatsen'}</>}
          </p>
          {scout.offers.length === 0 && (
            <p className="muted">Je scout kwam met lege handen terug: er was niets te koop dat aan je budget beantwoordde.</p>
          )}
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
            <button className="btn ghost sm" disabled={busy} onClick={() => act(() => api('/scout/dismiss', { method: 'POST' }), 'Rapport gesloten')}>
              {scout.offers.length === 0 ? 'Rapport sluiten' : 'Niets kopen'}
            </button>
          </div>
        </>
      )}
      {(!scout || scout.status === 'expired') && loft.equipment!.scoutUsed && (
        <p className="muted" style={{ margin: 0 }}>
          {scout?.status === 'expired' && 'Het rapport is verlopen. '}Je scout ging dit seizoen al op pad — volgend seizoen kan het weer.
        </p>
      )}
      {(!scout || scout.status === 'expired') && !loft.equipment!.scoutUsed && (
        <>
          <p className="faint" style={{ marginTop: 0, fontSize: '0.85rem' }}>
            Eén keer per seizoen. Hij blijft 1 dag tot {cat.scout.tiers[tier].maxDays} dagen weg en kan met lege handen
            terugkomen ({Math.round(cat.scout.tiers[tier].emptyChance * 100)} %). Anders koop je één duif of geen; het
            scoutloon krijg je niet terug. <Link to="/wiki#inrichting">Meer info →</Link>
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

      <div style={{ marginTop: 12 }}><strong>💑 Partner</strong></div>
      <p style={{ margin: '4px 0' }}>
        {care.partner ? <>Gekoppeld met <Link to={`/duif/${care.partner.id}`}>{care.partner.name}</Link>.</>
          : care.wennenWith ? <>Aan het wennen aan <Link to={`/duif/${care.wennenWith.id}`}>{care.wennenWith.name}</Link>.</>
          : <span className="faint">Geen partner. Een koppel vorm je op de pagina <Link to="/kweek">Kweek</Link>.</span>}
      </p>

      {p.sex === 'doffer' && (
        <>
          <div style={{ marginTop: 12 }}><strong>❤️ Weduwschap</strong></div>
          {!care.partner ? (
            <p className="faint" style={{ margin: '4px 0' }}>Hij vliegt naar zijn partner — vorm eerst een koppel.</p>
          ) : !p.compartment ? (
            <p className="faint" style={{ margin: '4px 0' }}>Een weduwnaar heeft een apart hok nodig (zijn woonhok).</p>
          ) : (
            <Line label={
              care.widow.on
                ? <>Aan · {care.widow.level === 2 ? <>{care.partner.name.split(' ')[0]} en hun jongen wachten thuis (sterk)</> : care.widow.level === 1 ? <>{care.partner.name.split(' ')[0]} wacht thuis</> : <>vandaag geen effect (partner niet thuis of op nest)</>} · <Money value={cat.widowFee} /> per vlucht</>
                : <>Uit · <Money value={cat.widowFee} /> per vlucht als het werkt</>
            }>
              <button className={`btn sm ${care.widow.on ? 'ghost' : ''}`} disabled={busy} onClick={() =>
                run(() => api(`/pigeons/${p.id}/widow`, { method: 'POST', body: { on: !care.widow.on } }), care.widow.on ? 'Weduwschap gestopt' : 'Weduwschap aan ❤️')}>
                {care.widow.on ? 'Stoppen' : 'Aanzetten'}
              </button>
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
