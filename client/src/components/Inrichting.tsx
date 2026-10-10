/**
 * Hokinrichting (⚠️ dev, nog niet live): de vier blokken van de pagina
 * Inrichting — plaatsen & hokken, hygiëne, vaccins & kuren, uitrusting — plus
 * het vakblad en de scout op de Markt en de verzorgingskaart op de pagina van
 * een duif.
 *
 * Kort, op vraag van de eigenaar: elk blok toont dicht in één regel hoe je
 * ervoor staat, open per onderdeel één zin over wat het doet, geen percentages.
 * De exacte cijfers en formules staan in de wiki (#inrichting, #hygiene); de
 * pagina verwijst ernaar.
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

const euro = (n: number) => `€${n.toLocaleString('nl-BE')}`;

const ICON: Record<string, string> = {
  ventilation: '🌬️', run: '🌳', raptorGuard: '🦅', light: '💡', irBoxes: '🔥',
  baskets: '🧺', weatherStation: '📡', magazine: '📰',
};

/** What each item does, in one short sentence. The exact numbers are in the wiki. */
const WHAT: Record<string, string> = {
  ventilation: 'Minder ornithose, het stro blijft langer proper',
  run: 'Meer energie na een rustdag en een hoger libido; trekt soms een sperwer aan',
  raptorGuard: 'Houdt de sperwer weg van de ren',
  light: 'Hoger libido: sneller een nest',
  irBoxes: 'Nesten komen sneller uit, vaker een tweeling',
  baskets: 'Elke vlucht kost minder energie en gezondheid',
  weatherStation: 'Je ziet het weer van de lossing een dag vooraf',
  magazine: 'Marktrapport, scherpere schattingen bij andermans duif en elke maandag Het Duivenblad',
};

/** "2/3 in gebruik": green while there is room, red once everything is taken. */
function Usage({ used, total, unit }: { used: number; total: number; unit: string }) {
  if (total <= 0) return <span className="faint">nog geen</span>;
  return (
    <span>
      <span style={{ color: used >= total ? 'var(--bad)' : 'var(--good)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {used}/{total}
      </span>{' '}
      {unit}
    </span>
  );
}

/**
 * One item, always in the same shape: the name and what you have of it on top
 * ("Aparte hokken: 2/2 in gebruik"), what it does underneath, its button aside.
 */
function Item({ icon, name, status, what, more, children }: {
  icon?: string; name: string; status?: React.ReactNode; what: React.ReactNode;
  /** A third line, e.g. what the next level adds. */
  more?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Line label={
      <>
        <span><strong>{icon ? `${icon} ` : ''}{name}</strong>{status != null && <>: {status}</>}</span>
        <span className="faint" style={{ display: 'block', fontSize: '0.85rem', marginTop: 1 }}>{what}</span>
        {more && <span style={{ display: 'block', fontSize: '0.85rem', marginTop: 1, color: 'var(--good)' }}>{more}</span>}
      </>
    }>
      {children}
    </Line>
  );
}

/** A bought item with levels: where it stands, what the next level costs and what it adds. */
function levelInfo(cat: InrichtingCatalogue | null, k: string, level: number) {
  const L = cat?.levels;
  const prices = L?.prices[k];
  if (!L || !prices || level === 0) return null;
  const g = L.gain?.[k];
  const next = level < L.max ? {
    level: level + 1,
    price: prices[level],
    // "ornithose −60 % → −72 %": the main effect now, and at the next level.
    gain: g ? `${g.what} ${g.values[level - 1]} → ${g.values[level]}` : null,
  } : null;
  return { level, max: L.max, next };
}
type LevelInfo = NonNullable<ReturnType<typeof levelInfo>>;

/** The third line of a levelled item: what one level up adds to what you have now. */
const levelGain = (info: LevelInfo | null) => (info?.next?.gain ? `↑ Niveau ${info.next.level}: ${info.next.gain}` : undefined);

function LevelButton({ k, label, info, loft, busy, act }: { k: string; label: string; info: LevelInfo; loft: Loft; busy: boolean; act: Act }) {
  const n = info.next;
  if (!n) return <span className="badge">✓ hoogste niveau</span>;
  return (
    <button className="btn sm ghost" disabled={busy || loft.money < n.price} onClick={() => {
      if (!window.confirm(`${label} naar niveau ${n.level} voor ${euro(n.price)}?\n\n${n.gain ? `${n.gain[0].toUpperCase()}${n.gain.slice(1)}; ook de andere voordelen worden evenveel sterker.` : 'Het werkt dan sterker.'}\n\nDat kan je niet terugverkopen.`)) return;
      act(() => api('/loft/equipment/upgrade', { method: 'POST', body: { key: k } }), `${label}: niveau ${n.level} 🔧`);
    }}>
      Niveau {n.level} · <Money value={n.price} />
    </button>
  );
}

/** One piece of inrichting you buy once: a buy button, then its level (if it has levels). */
function EquipmentLine({ k, owned, needs, loft, cat, busy, act }: {
  k: string; owned: boolean; needs?: string;
  loft: Loft; cat: InrichtingCatalogue; busy: boolean; act: Act;
}) {
  const item = cat.equipment[k];
  const price = item.price ?? 0;
  const info = owned ? levelInfo(cat, k, loft.equipment?.levels?.[k] ?? 1) : null;
  const status = info ? `niveau ${info.level}/${info.max}` : owned ? 'in je hok' : undefined;
  return (
    <Item icon={ICON[k]} name={item.label} status={status} what={WHAT[k]} more={levelGain(info)}>
      {info ? (
        <LevelButton k={k} label={item.label} info={info} loft={loft} busy={busy} act={act} />
      ) : owned ? null : needs ? (
        <span className="faint">{needs}</span>
      ) : (
        <button className="btn sm" disabled={busy || loft.money < price} onClick={() => {
          if (!window.confirm(`${item.label} kopen voor ${euro(price)}? Dat kan je niet terugverkopen.`)) return;
          act(() => api('/loft/equipment', { method: 'POST', body: { key: k } }), `${item.label} gekocht`);
        }}>
          Kopen · <Money value={price} />
        </button>
      )}
    </Item>
  );
}

/**
 * One block of the Inrichting page: its name and, in one line, how you stand —
 * tap it to open. Only one is open at a time (the page keeps that state), so the
 * page reads as four lines instead of twenty items.
 */
function Section({ icon, title, summary, open, onToggle, tour, children }: {
  icon: string; title: string; summary: React.ReactNode; open: boolean; onToggle: () => void;
  tour?: string; children: React.ReactNode;
}) {
  return (
    <div className="card" data-tour={tour}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: 0, margin: 0, border: 0, background: 'none', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
      >
        <span aria-hidden style={{ fontSize: '1.5rem', lineHeight: 1 }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: '1.05rem' }}>{title}</strong>
          <span className="faint" style={{ fontSize: '0.85rem' }}>{summary}</span>
        </span>
        <span aria-hidden className="faint" style={{ fontSize: '1.4rem', lineHeight: 1, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

type SectionProps = { open: boolean; onToggle: () => void; busy: boolean; act: Act };

/**
 * Plaatsen & hokken: every room you add to the loft, each with how full it is —
 * plaatsen, aparte hokken, ziekenboegbedden. None of it can be sold back, so
 * each one asks first.
 */
export function RoomsSection({ loft, upkeepBands, busy, act, open, onToggle }: SectionProps & {
  loft: Loft; upkeepBands: { upTo: number; perPigeon: number }[];
}) {
  // Daily upkeep rate the NEXT bird would fall into (bands are ascending; the
  // last one also covers anything beyond it).
  const nextBirdRate = upkeepBands.length
    ? (upkeepBands.find((b) => loft.pigeonCount + 1 <= b.upTo) ?? upkeepBands[upkeepBands.length - 1]).perPigeon
    : null;
  // Bound to consts so the narrowing survives into the click handlers.
  const nextCap = loft.nextCapacity;
  const compartmentCost = loft.compartmentCost;
  const nextBeds = loft.nextInfirmary;
  const summary = (
    <>
      <Usage used={loft.pigeonCount} total={loft.capacity} unit="plaatsen" />
      {loft.compartments > 0 && <> · <Usage used={loft.compartmentsUsed} total={loft.compartments} unit="apart" /></>}
      {' · '}ziekenboeg <Usage used={loft.infirmaryCount} total={loft.infirmaryCapacity} unit="" />
    </>
  );
  return (
    <Section icon="🏠" title="Plaatsen & hokken" summary={summary} open={open} onToggle={onToggle} tour="upgrades">
      {/* Upkeep rises per band: name what the next bird costs, so a bigger loft is never a hidden recurring cost. */}
      <Item
        icon="🏠"
        name="Hokcapaciteit"
        status={<Usage used={loft.pigeonCount} total={loft.capacity} unit="bezet" />}
        what={<>Plaats voor meer duiven{nextBirdRate !== null && ` · je volgende duif kost €${nextBirdRate}/dag`}</>}
      >
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
      </Item>
      <Item
        icon="🧱"
        name="Aparte hokken"
        status={<Usage used={loft.compartmentsUsed} total={loft.compartments} unit="in gebruik" />}
        what="Sneller herstel en minder snel ziek"
      >
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
      </Item>
      <Item
        icon="🛏️"
        name="Ziekenboeg"
        status={<Usage used={loft.infirmaryCount} total={loft.infirmaryCapacity} unit="bedden bezet" />}
        what="Meer zieke duiven tegelijk verzorgen"
      >
        {nextBeds ? (
          <button className="btn sm" disabled={busy || loft.money < nextBeds.price} onClick={() => {
            if (!window.confirm(`De ziekenboeg uitbreiden naar ${nextBeds.capacity} bedden voor ${euro(nextBeds.price)}?`)) return;
            act(() => api('/loft/infirmary/upgrade', { method: 'POST' }), 'Ziekenboeg uitgebreid! 🏥');
          }}>
            Naar {nextBeds.capacity} · <Money value={nextBeds.price} />
          </button>
        ) : <span className="faint">maximum bereikt</span>}
      </Item>
    </Section>
  );
}

/** Hygiëne: the meter, fresh straw and the hokpoetser. */
export function HygieneSection({ loft, busy, act, open, onToggle }: SectionProps & { loft: Loft }) {
  const eq = loft.equipment!;
  const h = Math.round(eq.hygiene);
  const summary = (
    <>
      {h}/100 proper{eq.cleaner ? ' · de poetser is aan het werk' : h <= 50 ? ' · tijd voor vers stro' : ''}
    </>
  );
  return (
    <Section icon="🧹" title="Hygiëne" summary={summary} open={open} onToggle={onToggle}>
      <Item
        name="Hokhygiëne"
        status={<strong style={{ fontVariantNumeric: 'tabular-nums' }}>{h}/100</strong>}
        what={`${eq.illnessMult < 1 ? 'Je duiven worden minder snel ziek' : 'Pas boven 50 worden je duiven minder snel ziek'} · zakt ~${Math.round(eq.decayPerDay)} per nacht`}
      />
      <Item icon="🌾" name="Vers stro" what="Zet de hygiëne terug op 100">
        <button
          className="btn sm"
          disabled={busy || h >= 100 || loft.money < eq.strawCost}
          onClick={() => act(() => api('/loft/straw', { method: 'POST' }), 'Vers stro gestrooid 🌾')}
        >
          Strooien · <Money value={eq.strawCost} />
        </button>
      </Item>
      <Item icon="🧹" name="Hokpoetser" status={eq.cleaner ? 'aan het werk' : undefined} what="Strooit zelf stro en ontsmet het hok; hoe meer duiven, hoe duurder">
        <button
          className={`btn sm ${eq.cleaner ? 'ghost' : ''}`}
          disabled={busy}
          onClick={() => act(
            () => api('/loft/cleaner', { method: 'POST', body: { on: !eq.cleaner } }),
            eq.cleaner ? 'Hokpoetser ontslagen' : 'Hokpoetser aangenomen 🧹',
          )}
        >
          {eq.cleaner ? 'Ontslaan' : 'Aannemen'} · <Money value={eq.cleanerWage} />/dag
        </button>
      </Item>
    </Section>
  );
}

/** "Hele hok": one vaccine or kuur for every bird at home who needs it. Per bird is on her page. */
export function VaccineSection({ loft, pigeons, cat, busy, act, open, onToggle }: SectionProps & {
  loft: Loft; pigeons: Pigeon[]; cat: InrichtingCatalogue;
}) {
  const now = Date.now();
  const home = pigeons.filter((p) => !p.away);
  const until = (p: Pigeon, key: string) => p.care?.vaccines.find((v) => v.key === key)?.until;
  const covered = (key: string) => home.filter((p) => { const u = until(p, key); return !!u && Date.parse(u) > now; }).length;
  // Who "Hele hok" treats: same rule as the server (vaccinateLoft / needsCourse).
  const needs = (key: string, days: number) => home.filter((p) => {
    const u = until(p, key);
    return !u || Date.parse(u) - now < days * (cat.vaccineRenewShare ?? 0) * 86400000;
  }).length;
  const keys = Object.keys(cat.vaccines);
  const active = keys.filter((k) => covered(k) > 0).length;
  const summary = active === 0 ? 'Nog niets gegeven' : `${active} van de ${keys.length} middelen actief`;
  return (
    <Section icon="💉" title="Vaccins & kuren" summary={summary} open={open} onToggle={onToggle}>
      <p className="faint" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Elk middel beschermt tegen één ziekte. Een vaccin werkt lang, maar je duif mag 2 dagen niet vliegen; een kuur is kort.
      </p>
      {Object.entries(cat.vaccines).map(([key, v]) => {
        const n = needs(key, v.days);
        const cost = n * v.price;
        return (
          <Item
            key={key}
            name={v.label}
            status={`${covered(key)}/${home.length} beschermd`}
            what={`${v.disease} · ${v.days} dagen${v.libidoHit ? ' · verlaagt het libido' : ''}`}
          >
            {n > 0 ? (
              <button className="btn sm ghost" disabled={busy || loft.money < cost} onClick={() => {
                if (v.noFlyDays && !window.confirm(`${v.label} voor ${n} ${n === 1 ? 'duif' : 'duiven'} (${euro(cost)})? Ze mogen dan ${v.noFlyDays} dagen niet vliegen.`)) return;
                act(() => api('/loft/vaccinate', { method: 'POST', body: { key } }), `${v.label}: ${n} ${n === 1 ? 'duif' : 'duiven'} behandeld`);
              }}>
                Hele hok ({n}) · <Money value={cost} />
              </button>
            ) : <span className="faint">{home.length === 0 ? 'niemand thuis' : 'iedereen beschermd'}</span>}
          </Item>
        );
      })}
    </Section>
  );
}

/**
 * Uitrusting: what you buy once and can then take up to level 4 — the ren (and
 * the net over it), ventilatie, kunstlicht, infrarood, reismanden, weerstation.
 */
export function GearSection({ loft, cat, busy, act, open, onToggle }: SectionProps & { loft: Loft; cat: InrichtingCatalogue }) {
  const eq = loft.equipment!;
  const irInfo = eq.irBoxes > 0 ? levelInfo(cat, 'irBoxes', eq.levels?.irBoxes ?? 1) : null;
  const owned = [eq.run, eq.raptorGuard, eq.ventilation, eq.light, eq.irBoxes > 0, eq.baskets, eq.weatherStation];
  const have = owned.filter(Boolean).length;
  const summary = have === 0 ? 'Nog niets gekocht' : `${have} van de ${owned.length} gekocht`;
  return (
    <Section icon="🛠️" title="Uitrusting" summary={summary} open={open} onToggle={onToggle}>
      <p className="faint" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Koop je één keer. Het meeste kan je daarna tot niveau 4 opwaarderen: elk niveau sterker, maar 3× duurder.
      </p>
      <EquipmentLine k="run" owned={eq.run} loft={loft} cat={cat} busy={busy} act={act} />
      <EquipmentLine k="raptorGuard" owned={eq.raptorGuard} needs={eq.run ? undefined : 'eerst een buitenren'} loft={loft} cat={cat} busy={busy} act={act} />
      <EquipmentLine k="ventilation" owned={eq.ventilation} loft={loft} cat={cat} busy={busy} act={act} />
      <EquipmentLine k="light" owned={eq.light} loft={loft} cat={cat} busy={busy} act={act} />
      <Item
        icon={ICON.irBoxes}
        name={cat.equipment.irBoxes.label}
        status={<><Usage used={eq.irInUse} total={eq.irBoxes} unit="in gebruik" />{irInfo && ` · niveau ${irInfo.level}/${irInfo.max}`}</>}
        what={WHAT.irBoxes}
        more={levelGain(irInfo)}
      >
        {irInfo && <LevelButton k="irBoxes" label={cat.equipment.irBoxes.label} info={irInfo} loft={loft} busy={busy} act={act} />}
        {eq.irNextPrice != null ? (
          <button className="btn sm" disabled={busy || loft.money < eq.irNextPrice} onClick={() => {
            if (!window.confirm(`${eq.irBoxes === 0 ? 'Twee verwarmde nestbakken' : 'Een extra verwarmde nestbak'} voor ${euro(eq.irNextPrice!)}?`)) return;
            act(() => api('/loft/irbox', { method: 'POST' }), 'Infrarood geplaatst');
          }}>
            {eq.irBoxes === 0 ? '2 bakken' : '+1 bak'} · <Money value={eq.irNextPrice} />
          </button>
        ) : <span className="faint">alle bakken</span>}
      </Item>
      <EquipmentLine k="baskets" owned={eq.baskets} loft={loft} cat={cat} busy={busy} act={act} />
      <EquipmentLine k="weatherStation" owned={eq.weatherStation} loft={loft} cat={cat} busy={busy} act={act} />
    </Section>
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
        <span style={{ flex: '1 1 240px', minWidth: 0 }}>
          <span><strong>{ICON.magazine} {m.label}</strong>{on && <>: abonnee</>}</span>
          <span className="faint" style={{ display: 'block', fontSize: '0.85rem', marginTop: 1 }}>
            {on
              ? 'Het marktrapport staat hieronder · bij andermans duif (en bij een privébod) zie je bandbreedtes i.p.v. enkel ★ · Het Duivenblad komt elke maandag in je meldingen'
              : WHAT.magazine}
          </span>
        </span>
        <button className={`btn sm ${on ? 'accent' : 'ghost'}`} disabled={busy} onClick={() =>
          act(() => api('/loft/equipment', { method: 'POST', body: { key: 'magazine', on: !on } }), on ? 'Vakblad opgezegd' : 'Vakblad: welkom, abonnee 📰')}>
          {on ? 'Opzeggen' : 'Abonneren'} · <Money value={m.daily ?? 0} />/dag
        </button>
      </div>
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

/** On her own page: entingskaart and verzekering. */
export function PigeonCareCard({ p, cat, busy, run }: {
  p: Pigeon; cat: InrichtingCatalogue; busy: boolean;
  run: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const care = p.care!;
  const day = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
  return (
    <div className="card">
      <h2>💉 Verzorging &amp; verzekering</h2>
      {care.quarantineUntil && <p className="notice" style={{ marginTop: 0 }}>📦 In quarantaine tot {day(care.quarantineUntil)}: niet vliegen, niet broeden.</p>}
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

      <div className="faint" style={{ fontSize: '0.8rem', marginTop: 8 }}>
        <Link to="/wiki#inrichting">Meer info over vaccins en verzekering →</Link>
      </div>
    </div>
  );
}
