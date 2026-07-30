/**
 * Sponsors. Companies do not appear until a loft has earned their interest.
 * When the loft crosses a sponsor's threshold, that sponsor makes an OFFER (a
 * notification fires and it shows up on the sponsor page); the player accepts
 * or refuses. Better pigeons and results attract bigger sponsors.
 *
 * A loft may hold several contracts, but only one per category. Accepting a
 * competitor in a category you already back terminates the old contract and
 * charges its break penalty. Weekly stipends are applied in engine.advanceWeek
 * and win bonuses in schedule.tickFlights; this module owns the catalogue, the
 * offer evaluation and the accept/refuse/cancel actions.
 */

import { SPONSORS, type SponsorDef } from '../config/gameConfig.js';
import type { Database, Loft, SponsorState } from '../schema.js';
import { emptySponsorState } from '../schema.js';
import { newId } from '../store.js';
import { talent } from './pigeon.js';

const BY_ID = new Map(SPONSORS.map((s) => [s.id, s]));

export function sponsorById(id: string | null | undefined): SponsorDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Safely get a loft's sponsor state, initialising it if missing (legacy). */
function state(loft: Loft): SponsorState {
  if (!loft.sponsorship) loft.sponsorship = emptySponsorState();
  return loft.sponsorship;
}

/** The active sponsor definitions currently backing this loft. */
export function activeSponsorDefs(loft: Loft): SponsorDef[] {
  const defs: SponsorDef[] = [];
  for (const a of loft.sponsorship?.active ?? []) {
    const def = BY_ID.get(a.id);
    if (def) defs.push(def);
  }
  return defs;
}

/** The talent of the loft's best (non-retired) pigeon, 0 if none. */
export function ownedBestTalent(db: Database, userId: string): number {
  let best = 0;
  for (const p of db.pigeons) {
    if (p.ownerId === userId && !p.retired) best = Math.max(best, talent(p));
  }
  return Math.round(best);
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

function notify(db: Database, loft: Loft, title: string, body: string): void {
  db.notifications.push({
    id: newId('ntf'), userId: loft.userId, kind: 'info', title, body,
    flightId: null, createdAt: new Date().toISOString(), read: false,
  });
}

/**
 * Generate new offers for any sponsor whose threshold is freshly met. Each
 * sponsor is only ever offered once (tracked via `seen`). Returns true if any
 * new offer was created (so the caller can persist).
 */
export function evaluateSponsorOffers(db: Database, loft: Loft, _nowMs: number): boolean {
  if (loft.isBot) return false;
  const st = state(loft);
  const best = ownedBestTalent(db, loft.userId);
  let added = false;
  for (const def of SPONSORS) {
    if (st.seen.includes(def.id)) continue;
    if (!isSponsorUnlocked(loft, def, best)) continue;
    st.seen.push(def.id);
    st.offers.push(def.id);
    notify(db, loft, `${def.icon} Sponsoraanbod: ${def.name}`,
      `${def.tagline} Bekijk en beslis op de sponsorpagina.`);
    added = true;
  }
  return added;
}

/** The active sponsor in the same category as `def`, if any (a competitor). */
function rivalFor(loft: Loft, def: SponsorDef): SponsorDef | undefined {
  for (const a of state(loft).active) {
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
  if (st.active.some((a) => a.id === sponsorId)) return '!Deze sponsor is al actief';
  if (!st.seen.includes(sponsorId)) return '!Deze sponsor heeft je (nog) geen aanbod gedaan';

  const rival = rivalFor(loft, def);
  if (rival) {
    if (!replace) {
      return `!Je hebt al ${rival.name} in de categorie ${def.categoryLabel}. Bevestig de overstap (verbrekingsvergoeding €${rival.breakPenalty}).`;
    }
    if (loft.money < rival.breakPenalty) {
      return `!Je hebt €${rival.breakPenalty} nodig om het contract met ${rival.name} te verbreken`;
    }
    loft.money -= rival.breakPenalty;
    st.active = st.active.filter((a) => a.id !== rival.id);
    notify(db, loft, `🤝 Overstap in categorie ${def.categoryLabel}`,
      `Contract met ${rival.name} verbroken (boete €${rival.breakPenalty}) om bij ${def.name} te tekenen.`);
  }

  st.active.push({ id: sponsorId, since: new Date().toISOString() });
  st.offers = st.offers.filter((id) => id !== sponsorId);
  if (!st.signed.includes(sponsorId)) {
    st.signed.push(sponsorId);
    loft.money += def.signingBonus;
    notify(db, loft, `${def.icon} ${def.name} tekent bij jou`,
      `Welkomstpremie €${def.signingBonus}. Vanaf nu €${def.weeklyStipend}/week en €${def.winBonus} per overwinning.`);
    return `${def.name} is nu een van je sponsors! Tekengeld: €${def.signingBonus}.`;
  }
  notify(db, loft, `${def.icon} ${def.name} weer aan boord`,
    `Je tekent opnieuw — geen tekengeld, wel weer €${def.weeklyStipend}/week en €${def.winBonus} per overwinning.`);
  return `${def.name} is opnieuw een van je sponsors (geen nieuw tekengeld).`;
}

/** Refuse a pending offer (it stays available to reconsider later). */
export function applyRefuseSponsor(db: Database, loft: Loft, sponsorId: string): string {
  const st = state(loft);
  if (!st.offers.includes(sponsorId)) return '!Er is geen openstaand aanbod van deze sponsor';
  st.offers = st.offers.filter((id) => id !== sponsorId);
  const def = BY_ID.get(sponsorId);
  return `Aanbod van ${def?.name ?? 'de sponsor'} geweigerd. Je kan later nog van gedacht veranderen.`;
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
  notify(db, loft, `🤝 Contract met ${def?.name ?? 'sponsor'} beëindigd`,
    `Je zegde het sponsorcontract op. Verbrekingsvergoeding €${penalty} betaald.`);
  return `Contract met ${def?.name ?? 'de sponsor'} stopgezet (boete €${penalty}).`;
}

function sponsorDTO(def: SponsorDef, loft: Loft) {
  return {
    id: def.id,
    name: def.name,
    icon: def.icon,
    tagline: def.tagline,
    tier: def.tier,
    category: def.category,
    categoryLabel: def.categoryLabel,
    signingBonus: def.signingBonus,
    weeklyStipend: def.weeklyStipend,
    winBonus: def.winBonus,
    breakPenalty: def.breakPenalty,
    requirement: requirementLabel(def),
    signedBefore: state(loft).signed.includes(def.id),
  };
}

/** DTO for the sponsor page: active contracts, new offers and reconsiderables. */
export function sponsorView(db: Database, loft: Loft) {
  const st = state(loft);
  const best = ownedBestTalent(db, loft.userId);
  const activeIds = new Set(st.active.map((a) => a.id));
  const offerSet = new Set(st.offers);

  const withConflict = (def: SponsorDef) => {
    const rival = rivalFor(loft, def);
    return { ...sponsorDTO(def, loft), conflictWith: rival?.name ?? null, conflictPenalty: rival?.breakPenalty ?? 0 };
  };
  const byTier = (a: { tier: number }, b: { tier: number }) => a.tier - b.tier;

  const active = st.active
    .map((a) => {
      const def = BY_ID.get(a.id);
      return def ? { ...sponsorDTO(def, loft), since: a.since } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort(byTier);

  const offers = st.offers
    .map((id) => BY_ID.get(id))
    .filter((d): d is SponsorDef => !!d)
    .map(withConflict)
    .sort(byTier);

  const available = st.seen
    .filter((id) => !activeIds.has(id) && !offerSet.has(id))
    .map((id) => BY_ID.get(id))
    .filter((d): d is SponsorDef => !!d)
    .map(withConflict)
    .sort(byTier);

  return { bestTalent: best, active, offers, available };
}
