/**
 * Sponsors. Companies do not appear until a loft has earned their interest.
 * When the loft crosses a sponsor's threshold, that sponsor makes an OFFER (a
 * notification fires and it shows on the sponsor page); the player accepts or
 * refuses. A refused offer disappears, but the company may come back later —
 * with terms rescaled to how the loft has performed in the meantime (better
 * pigeons/results → a richer offer, worse → a leaner one).
 *
 * A loft may hold several contracts, but only one per category. Accepting a
 * competitor in a category you already back terminates the old contract and
 * charges its break penalty. Weekly stipends are applied in engine.advanceWeek
 * and win bonuses in schedule.tickFlights; this module owns the catalogue, the
 * offer evaluation and the accept/refuse/cancel actions.
 */

import {
  SPONSORS,
  SPONSOR_REOFFER_COOLDOWN_HOURS,
  SPONSOR_REOFFER_MULT_MAX,
  SPONSOR_REOFFER_MULT_MIN,
  type SponsorDef,
} from '../config/gameConfig.js';
import type {
  ActiveSponsorship,
  Database,
  Loft,
  OfferTerms,
  SponsorOffer,
  SponsorState,
} from '../schema.js';
import { emptySponsorState } from '../schema.js';
import { newId } from '../store.js';
import { clamp } from './util.js';
import { talent } from './pigeon.js';

const BY_ID = new Map(SPONSORS.map((s) => [s.id, s]));

export function sponsorById(id: string | null | undefined): SponsorDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

function baseTerms(def: SponsorDef): OfferTerms {
  return { signingBonus: def.signingBonus, weeklyStipend: def.weeklyStipend, winBonus: def.winBonus };
}

/**
 * Read (and normalise) a loft's sponsor state. Fills in defaults and upgrades
 * any older-shape data (string offers, term-less contracts) so every reader
 * downstream can trust the structure.
 */
function state(loft: Loft): SponsorState {
  const raw: any = loft.sponsorship ?? emptySponsorState();
  const active: ActiveSponsorship[] = [];
  for (const a of Array.isArray(raw.active) ? raw.active : []) {
    const id = typeof a === 'string' ? a : a?.id;
    const def = BY_ID.get(id);
    if (!def) continue;
    active.push({
      id,
      since: (typeof a === 'object' && a?.since) || '',
      weeklyStipend: typeof a?.weeklyStipend === 'number' ? a.weeklyStipend : def.weeklyStipend,
      winBonus: typeof a?.winBonus === 'number' ? a.winBonus : def.winBonus,
    });
  }
  const offers: SponsorOffer[] = [];
  for (const o of Array.isArray(raw.offers) ? raw.offers : []) {
    const id = typeof o === 'string' ? o : o?.id;
    const def = BY_ID.get(id);
    if (!def) continue;
    const b = baseTerms(def);
    offers.push({
      id,
      at: (typeof o === 'object' && o?.at) || '',
      signingBonus: typeof o?.signingBonus === 'number' ? o.signingBonus : b.signingBonus,
      weeklyStipend: typeof o?.weeklyStipend === 'number' ? o.weeklyStipend : b.weeklyStipend,
      winBonus: typeof o?.winBonus === 'number' ? o.winBonus : b.winBonus,
    });
  }
  const declined = (Array.isArray(raw.declined) ? raw.declined : [])
    .filter((d: any) => d && BY_ID.has(d.id))
    .map((d: any) => ({ id: d.id, at: d.at ?? '', perf: typeof d.perf === 'number' ? d.perf : 0 }));
  const signed = (Array.isArray(raw.signed) ? raw.signed : []).filter((id: any) => typeof id === 'string');

  const st: SponsorState = { active, offers, declined, signed };
  loft.sponsorship = st;
  return st;
}

/** The active sponsorship contracts backing this loft (with agreed terms). */
export function activeContracts(loft: Loft): { def: SponsorDef; contract: ActiveSponsorship }[] {
  return state(loft)
    .active.map((c) => {
      const def = BY_ID.get(c.id);
      return def ? { def, contract: c } : null;
    })
    .filter((x): x is { def: SponsorDef; contract: ActiveSponsorship } => x != null);
}

/** The talent of the loft's best (non-retired) pigeon, 0 if none. */
export function ownedBestTalent(db: Database, userId: string): number {
  let best = 0;
  for (const p of db.pigeons) {
    if (p.ownerId === userId && !p.retired) best = Math.max(best, talent(p));
  }
  return Math.round(best);
}

/** A single scalar capturing how strong the loft is right now. */
function perfScore(loft: Loft, bestTalent: number): number {
  return Math.round(
    bestTalent +
      loft.totalWins * 8 +
      loft.seasonPoints * 0.5 +
      (loft.stats?.gold ?? 0) * 10 +
      (loft.level ?? 1) * 5,
  );
}

/** Whether the loft currently meets every threshold of a sponsor. */
export function isSponsorUnlocked(loft: Loft, def: SponsorDef, bestTalent: number): boolean {
  const r = def.req;
  if (r.level != null && (loft.level ?? 1) < r.level) return false;
  if (r.totalWins != null && loft.totalWins < r.totalWins) return false;
  if (r.entries != null && (loft.stats?.entries ?? 0) < r.entries) return false;
  if (r.seasonPoints != null && loft.seasonPoints < r.seasonPoints) return false;
  if (r.gold != null && (loft.stats?.gold ?? 0) < r.gold) return false;
  if (r.bestTalent != null && bestTalent < r.bestTalent) return false;
  return true;
}

/** A short human description of what earned this sponsor's interest. */
export function requirementLabel(def: SponsorDef): string {
  const r = def.req;
  const parts: string[] = [];
  if (r.level != null) parts.push(`niveau ${r.level}`);
  if (r.totalWins != null) parts.push(`${r.totalWins} overwinning${r.totalWins === 1 ? '' : 'en'}`);
  if (r.entries != null) parts.push(`${r.entries} vluchtdeelnames`);
  if (r.seasonPoints != null) parts.push(`${r.seasonPoints} seizoenspunten`);
  if (r.bestTalent != null) parts.push(`een duif met talent ${r.bestTalent}`);
  if (r.gold != null) parts.push(`${r.gold} gouden medailles`);
  if (parts.length === 0) return 'Meteen geïnteresseerd';
  return parts.join(' · ');
}

function round5(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5);
}
function scaledTerms(def: SponsorDef, mult: number): OfferTerms {
  return {
    signingBonus: round5(def.signingBonus * mult),
    weeklyStipend: round5(def.weeklyStipend * mult),
    winBonus: Math.max(5, Math.round(def.winBonus * mult)),
  };
}

function notify(db: Database, loft: Loft, title: string, body: string): void {
  db.notifications.push({
    id: newId('ntf'), userId: loft.userId, kind: 'info', title, body,
    flightId: null, createdAt: new Date().toISOString(), read: false,
  });
}

/**
 * Make new offers for any qualifying sponsor. A sponsor that has never been
 * seen offers at its base terms; one that was refused/cancelled may re-offer
 * once the cooldown has passed, with terms rescaled to the loft's performance
 * since. Returns true if any offer was created (so the caller can persist).
 */
export function evaluateSponsorOffers(db: Database, loft: Loft, nowMs: number): boolean {
  if (loft.isBot) return false;
  const st = state(loft);
  const best = ownedBestTalent(db, loft.userId);
  const perf = perfScore(loft, best);
  let added = false;

  for (const def of SPONSORS) {
    if (st.active.some((a) => a.id === def.id)) continue;
    if (st.offers.some((o) => o.id === def.id)) continue;
    if (!isSponsorUnlocked(loft, def, best)) continue;

    const declinedIdx = st.declined.findIndex((d) => d.id === def.id);
    if (declinedIdx >= 0) {
      const d = st.declined[declinedIdx];
      const ageH = d.at ? (nowMs - Date.parse(d.at)) / 3600000 : Infinity;
      if (!(ageH >= SPONSOR_REOFFER_COOLDOWN_HOURS)) continue; // still cooling off
      const mult = clamp(perf / Math.max(1, d.perf), SPONSOR_REOFFER_MULT_MIN, SPONSOR_REOFFER_MULT_MAX);
      const terms = scaledTerms(def, mult);
      st.offers.push({ id: def.id, at: new Date(nowMs).toISOString(), ...terms });
      st.declined.splice(declinedIdx, 1);
      const richer = terms.weeklyStipend >= def.weeklyStipend;
      notify(db, loft, `${def.icon} ${def.name} klopt opnieuw aan`,
        `${richer ? 'Je duiven presteerden goed — het aanbod is er beter op geworden.' : 'Een nieuw, wat bescheidener aanbod.'} Bekijk het op de sponsorpagina.`);
      added = true;
    } else {
      const terms = scaledTerms(def, 1);
      st.offers.push({ id: def.id, at: new Date(nowMs).toISOString(), ...terms });
      notify(db, loft, `${def.icon} Sponsoraanbod: ${def.name}`,
        `${def.tagline} Bekijk en beslis op de sponsorpagina.`);
      added = true;
    }
  }
  return added;
}

/** The active sponsor in the same category as `def`, if any (a competitor). */
function rivalFor(st: SponsorState, def: SponsorDef): SponsorDef | undefined {
  for (const a of st.active) {
    const d = BY_ID.get(a.id);
    if (d && d.id !== def.id && d.category === def.category) return d;
  }
  return undefined;
}

/**
 * Accept a sponsor's offer. If a competitor in the same category is active it
 * is terminated (only with `replace`) and its break penalty is charged. Pays
 * the signing bonus the first time this sponsor is ever accepted. Returns a
 * result message or an error string prefixed with '!'.
 */
export function applyAcceptSponsor(db: Database, loft: Loft, sponsorId: string, replace: boolean): string {
  const def = BY_ID.get(sponsorId);
  if (!def) return '!Onbekende sponsor';
  const st = state(loft);
  const offer = st.offers.find((o) => o.id === sponsorId);
  if (!offer) return '!Deze sponsor heeft momenteel geen aanbod openstaan';

  const rival = rivalFor(st, def);
  if (rival) {
    if (!replace) {
      return `!Je hebt al ${rival.name} in de categorie ${def.categoryLabel}. Bevestig de overstap (verbrekingsvergoeding €${rival.breakPenalty}).`;
    }
    if (loft.money < rival.breakPenalty) {
      return `!Je hebt €${rival.breakPenalty} nodig om het contract met ${rival.name} te verbreken`;
    }
    loft.money -= rival.breakPenalty;
    st.active = st.active.filter((a) => a.id !== rival.id);
    st.declined = st.declined.filter((d) => d.id !== rival.id);
    st.declined.push({ id: rival.id, at: new Date().toISOString(), perf: perfScore(loft, ownedBestTalent(db, loft.userId)) });
    notify(db, loft, `🤝 Overstap in categorie ${def.categoryLabel}`,
      `Contract met ${rival.name} verbroken (boete €${rival.breakPenalty}) om bij ${def.name} te tekenen.`);
  }

  st.offers = st.offers.filter((o) => o.id !== sponsorId);
  st.active.push({ id: sponsorId, since: new Date().toISOString(), weeklyStipend: offer.weeklyStipend, winBonus: offer.winBonus });
  if (!st.signed.includes(sponsorId)) {
    st.signed.push(sponsorId);
    loft.money += offer.signingBonus;
    notify(db, loft, `${def.icon} ${def.name} tekent bij jou`,
      `Welkomstpremie €${offer.signingBonus}. Vanaf nu €${offer.weeklyStipend}/week en €${offer.winBonus} per overwinning.`);
    return `${def.name} is nu een van je sponsors! Tekengeld: €${offer.signingBonus}.`;
  }
  notify(db, loft, `${def.icon} ${def.name} weer aan boord`,
    `Je tekent opnieuw — geen tekengeld, wel €${offer.weeklyStipend}/week en €${offer.winBonus} per overwinning.`);
  return `${def.name} is opnieuw een van je sponsors (geen nieuw tekengeld).`;
}

/** Refuse a pending offer. It disappears but may return later (rescaled). */
export function applyRefuseSponsor(db: Database, loft: Loft, sponsorId: string): string {
  const st = state(loft);
  if (!st.offers.some((o) => o.id === sponsorId)) return '!Er is geen openstaand aanbod van deze sponsor';
  st.offers = st.offers.filter((o) => o.id !== sponsorId);
  st.declined = st.declined.filter((d) => d.id !== sponsorId);
  st.declined.push({ id: sponsorId, at: new Date().toISOString(), perf: perfScore(loft, ownedBestTalent(db, loft.userId)) });
  const def = BY_ID.get(sponsorId);
  return `Aanbod van ${def?.name ?? 'de sponsor'} geweigerd. Misschien komen ze later met een nieuw voorstel.`;
}

/** Terminate an active contract, paying its break penalty. */
export function applyCancelSponsor(db: Database, loft: Loft, sponsorId: string): string {
  const st = state(loft);
  const idx = st.active.findIndex((a) => a.id === sponsorId);
  if (idx === -1) return '!Deze sponsor is niet actief';
  const def = BY_ID.get(sponsorId);
  const penalty = def?.breakPenalty ?? 0;
  if (loft.money < penalty) return `!Je hebt €${penalty} nodig om dit contract te verbreken`;
  loft.money -= penalty;
  st.active.splice(idx, 1);
  st.declined = st.declined.filter((d) => d.id !== sponsorId);
  st.declined.push({ id: sponsorId, at: new Date().toISOString(), perf: perfScore(loft, ownedBestTalent(db, loft.userId)) });
  notify(db, loft, `🤝 Contract met ${def?.name ?? 'sponsor'} beëindigd`,
    `Je zegde het sponsorcontract op. Verbrekingsvergoeding €${penalty} betaald.`);
  return `Contract met ${def?.name ?? 'de sponsor'} stopgezet (boete €${penalty}).`;
}

function sponsorDTO(def: SponsorDef, terms: OfferTerms, signed: boolean) {
  return {
    id: def.id,
    name: def.name,
    icon: def.icon,
    tagline: def.tagline,
    tier: def.tier,
    category: def.category,
    categoryLabel: def.categoryLabel,
    signingBonus: terms.signingBonus,
    weeklyStipend: terms.weeklyStipend,
    winBonus: terms.winBonus,
    breakPenalty: def.breakPenalty,
    requirement: requirementLabel(def),
    signedBefore: signed,
  };
}

/** DTO for the sponsor page: active contracts and pending offers. */
export function sponsorView(db: Database, loft: Loft) {
  const st = state(loft);
  const best = ownedBestTalent(db, loft.userId);
  const byTier = (a: { tier: number }, b: { tier: number }) => a.tier - b.tier;

  const active = st.active
    .map((c) => {
      const def = BY_ID.get(c.id);
      if (!def) return null;
      return {
        ...sponsorDTO(def, { signingBonus: def.signingBonus, weeklyStipend: c.weeklyStipend, winBonus: c.winBonus }, st.signed.includes(c.id)),
        since: c.since,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort(byTier);

  const offers = st.offers
    .map((o) => {
      const def = BY_ID.get(o.id);
      if (!def) return null;
      const rival = rivalFor(st, def);
      return {
        ...sponsorDTO(def, o, st.signed.includes(o.id)),
        conflictWith: rival?.name ?? null,
        conflictPenalty: rival?.breakPenalty ?? 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort(byTier);

  return { bestTalent: best, active, offers };
}
