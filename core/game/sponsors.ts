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
  NEWCOMER,
  SPONSORS,
  SPONSOR_HIGH_TIER,
  SPONSOR_HIGH_TIER_DAILY_MULT,
  SPONSOR_MAX_ACTIVE,
  SPONSOR_MAX_PENDING_OFFERS,
  SPONSOR_OFFER_SPACING_HOURS,
  SPONSOR_REOFFER_COOLDOWN_HOURS,
  SPONSOR_REOFFER_MULT_MAX,
  SPONSOR_REOFFER_MULT_MIN,
  SPONSOR_REVIEW,
  sponsorPodiumBonus,
  type FlightTier,
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

/** Tier 4+ pays only a quarter of its catalogue daily stipend (seizoen 3). */
function tierDailyMult(def: SponsorDef): number {
  return def.tier >= SPONSOR_HIGH_TIER ? SPONSOR_HIGH_TIER_DAILY_MULT : 1;
}

/** The catalogue daily stipend as it is paid now (tier 4+ cut applied). */
export function catalogDaily(def: SponsorDef): number {
  return tierDailyMult(def) === 1 ? def.dailyStipend : round5(def.dailyStipend * tierDailyMult(def));
}

function baseTerms(def: SponsorDef): OfferTerms {
  return { signingBonus: def.signingBonus, dailyStipend: catalogDaily(def), podiumBase: def.podiumBase };
}

/** Read a stored term, falling back to the pre-daily shape (weekly stipend /
 *  win-only bonus) for contracts signed before that switch. Migration v32
 *  rewrites them in place; this keeps a not-yet-migrated world correct. */
function legacyDaily(a: any, def: SponsorDef): number {
  if (typeof a?.dailyStipend === 'number' && a.dailyStipend > 0) return a.dailyStipend;
  if (typeof a?.weeklyStipend === 'number' && a.weeklyStipend > 0) return Math.max(1, Math.round(a.weeklyStipend / 7));
  return catalogDaily(def); // no usable terms stored → the catalogue's own value
}
function legacyPodium(a: any, def: SponsorDef): number {
  if (typeof a?.podiumBase === 'number' && a.podiumBase > 0) return a.podiumBase;
  if (typeof a?.winBonus === 'number' && a.winBonus > 0) return Math.max(5, Math.round(a.winBonus / 5) * 5);
  return def.podiumBase;
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
      dailyStipend: legacyDaily(a, def),
      podiumBase: legacyPodium(a, def),
      refPoints: typeof a?.refPoints === 'number' ? a.refPoints : undefined,
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
      dailyStipend: legacyDaily(o, def),
      podiumBase: legacyPodium(o, def),
    });
  }
  const declined = (Array.isArray(raw.declined) ? raw.declined : [])
    .filter((d: any) => d && BY_ID.has(d.id))
    .map((d: any) => ({
      id: d.id,
      at: d.at ?? '',
      perf: typeof d.perf === 'number' ? d.perf : 0,
      ...(d.permanent ? { permanent: true as const } : {}),
    }));
  const signed = (Array.isArray(raw.signed) ? raw.signed : []).filter((id: any) => typeof id === 'string');
  const lastOfferAt = typeof raw.lastOfferAt === 'string' ? raw.lastOfferAt : undefined;

  // Cap pending offers so a legacy burst (offers banked before the cap existed)
  // never resurfaces as a wall of suitors. Keep the lowest-tier ones; the rest are
  // simply dropped and remain eligible, so they trickle back later (spaced).
  if (offers.length > SPONSOR_MAX_PENDING_OFFERS) {
    offers.sort((a, b) => (BY_ID.get(a.id)?.tier ?? 99) - (BY_ID.get(b.id)?.tier ?? 99));
    offers.length = SPONSOR_MAX_PENDING_OFFERS;
  }

  // The forced reduction ends by itself once the loft is back at the limit.
  const mustReduce = raw.mustReduce === true && active.length > SPONSOR_MAX_ACTIVE;
  const st: SponsorState = { active, offers, declined, signed, lastOfferAt, ...(mustReduce ? { mustReduce } : {}) };
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
    if (p.ownerId === userId) best = Math.max(best, talent(p));
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

/** The full podium payout grid for one contract: per tier, the 1e/2e/3e amount. */
export function podiumGrid(podiumBase: number): Record<FlightTier, number[]> {
  const tiers: FlightTier[] = ['regional', 'national', 'international'];
  const grid = {} as Record<FlightTier, number[]>;
  for (const t of tiers) grid[t] = [1, 2, 3].map((rank) => sponsorPodiumBonus(podiumBase, t, rank));
  return grid;
}

/** One-line summary of what a win pays across the three tiers (for messages). */
function podiumSummary(podiumBase: number): string {
  const g = podiumGrid(podiumBase);
  return `zege: €${g.regional[0]} regionaal · €${g.national[0]} nationaal · €${g.international[0]} internationaal`;
}
function scaledTerms(def: SponsorDef, mult: number): OfferTerms {
  return {
    signingBonus: round5(def.signingBonus * mult),
    dailyStipend: round5(def.dailyStipend * mult * tierDailyMult(def)),
    podiumBase: round5(def.podiumBase * mult),
  };
}

function notify(db: Database, loft: Loft, title: string, body: string): void {
  db.notifications.push({
    id: newId('ntf'), userId: loft.userId, kind: 'info', title, body,
    flightId: null, createdAt: new Date().toISOString(), read: false,
  });
}

/**
 * Try to make ONE new sponsor offer. This is called from tickFlights right after a
 * loft's bird did well in a competition flight (and only by chance), never on a
 * timer — sponsors scout birds that just performed, they don't appear out of thin
 * air. It emits at most one offer per call and enforces two guards so a good streak
 * can't summon a wall of suitors:
 *  - `SPONSOR_MAX_PENDING_OFFERS`: never pile up more than the cap of pending offers;
 *  - `SPONSOR_OFFER_SPACING_HOURS`: a short floor between offers.
 * Lowest tier first (SPONSORS is tier-ordered), so modest local sponsors come before
 * the big prestige ones. A never-seen sponsor offers at its base terms; a
 * refused/cancelled one may re-offer once its own cooldown has passed, with terms
 * rescaled to the loft's performance since. Returns true if an offer was created.
 */
export function evaluateSponsorOffers(db: Database, loft: Loft, nowMs: number): boolean {
  if (loft.isBot) return false;
  const st = state(loft);

  // Never pile up more than the cap of pending offers at once.
  if (st.offers.length >= SPONSOR_MAX_PENDING_OFFERS) return false;

  // Space out offers: only make a new one if enough time passed since the last.
  if (st.lastOfferAt) {
    const sinceH = (nowMs - Date.parse(st.lastOfferAt)) / 3600000;
    if (!(sinceH >= SPONSOR_OFFER_SPACING_HOURS)) return false; // still spacing out
  }

  const best = ownedBestTalent(db, loft.userId);
  const perf = perfScore(loft, best);

  // Find the first qualifying candidate (never-seen, or a declined one whose
  // re-offer cooldown has elapsed). SPONSORS is tier-ordered → gentle ramp-up.
  for (const def of SPONSORS) {
    if (st.active.some((a) => a.id === def.id)) continue;
    if (st.offers.some((o) => o.id === def.id)) continue;
    if (!isSponsorUnlocked(loft, def, best)) continue;

    const declinedIdx = st.declined.findIndex((d) => d.id === def.id);
    if (declinedIdx >= 0) {
      const d = st.declined[declinedIdx];
      // Turned down as a worse competitor of a sponsor you already had: that is a
      // definitive no, so this one never knocks again (see applyRefuseSponsor).
      if (d.permanent) continue;
      const ageH = d.at ? (nowMs - Date.parse(d.at)) / 3600000 : Infinity;
      if (!(ageH >= SPONSOR_REOFFER_COOLDOWN_HOURS)) continue; // still cooling off
      const mult = clamp(perf / Math.max(1, d.perf), SPONSOR_REOFFER_MULT_MIN, SPONSOR_REOFFER_MULT_MAX);
      const terms = scaledTerms(def, mult);
      st.offers.push({ id: def.id, at: new Date(nowMs).toISOString(), ...terms });
      st.declined.splice(declinedIdx, 1);
      const richer = terms.dailyStipend >= catalogDaily(def);
      notify(db, loft, `${def.icon} ${def.name} klopt opnieuw aan`,
        `${richer ? 'Je duiven presteerden goed — het aanbod is er beter op geworden.' : 'Een nieuw, wat bescheidener aanbod.'} Bekijk het op de sponsorpagina.`);
    } else {
      const terms = scaledTerms(def, 1);
      st.offers.push({ id: def.id, at: new Date(nowMs).toISOString(), ...terms });
      notify(db, loft, `${def.icon} Sponsoraanbod: ${def.name}`,
        `${def.tagline} Bekijk en beslis op de sponsorpagina.`);
    }
    st.lastOfferAt = new Date(nowMs).toISOString();
    return true; // exactly one offer per call — the rest trickle in later
  }
  return false;
}

/**
 * Put ONE random tier-1 sponsor on the table for a brand-new loft.
 *
 * Sponsors normally only come knocking after a podium finish in a competition
 * flight (see `evaluateSponsorOffers`) — which a newcomer flying against
 * month-old birds simply cannot get. Without this the entire sponsor system,
 * and the income that comes with it, would stay invisible for weeks. Terms are
 * the catalogue terms, unscaled; the player still chooses to accept or refuse.
 */
export function offerStarterSponsor(db: Database, loft: Loft, nowMs: number): boolean {
  if (loft.isBot) return false;
  const st = state(loft);
  const candidates = SPONSORS.filter(
    (d) => d.tier === NEWCOMER.sponsorTier && !st.active.some((a) => a.id === d.id) && !st.offers.some((o) => o.id === d.id),
  );
  if (candidates.length === 0) return false;
  const def = candidates[Math.floor(Math.random() * candidates.length)];
  st.offers.push({ id: def.id, at: new Date(nowMs).toISOString(), ...scaledTerms(def, 1) });
  st.lastOfferAt = new Date(nowMs).toISOString();
  notify(db, loft, `${def.icon} Sponsoraanbod: ${def.name}`,
    `${def.tagline} Een eerste sponsor voor je nieuwe hok — bekijk en beslis op de sponsorpagina.`);
  return true;
}

/** The active sponsor in the same category as `def`, if any (a competitor). */
function rivalFor(st: SponsorState, def: SponsorDef): SponsorDef | undefined {
  for (const a of st.active) {
    const d = BY_ID.get(a.id);
    if (d && d.id !== def.id && d.category === def.category) return d;
  }
  return undefined;
}

/** The running contract in the same category as `def`, if any. */
function rivalContract(st: SponsorState, def: SponsorDef): ActiveSponsorship | undefined {
  for (const a of st.active) {
    const d = BY_ID.get(a.id);
    if (d && d.id !== def.id && d.category === def.category) return a;
  }
  return undefined;
}

/**
 * Is refusing this offer a DEFINITIVE no?
 *
 * Only when the offer competes with a sponsor you already have (same category,
 * so switching costs a break fee) **and** pays no better than that sponsor. Then
 * saying no is not a matter of timing or budget — the deal is simply worse, and
 * having them keep knocking is nagging, not opportunity. So they never return.
 *
 * A competitor that pays BETTER is deliberately excluded: a player may well
 * refuse it today only because the break fee is out of reach right now, and
 * locking the best sponsor of a category out forever over that would be a trap.
 * Comparison is on the daily stipend first — the recurring money the player sees
 * — with the podium premium as the tie-breaker.
 */
function refusalIsFinal(st: SponsorState, def: SponsorDef, offer: SponsorOffer): boolean {
  const rival = rivalContract(st, def);
  if (!rival) return false; // no conflict, no break fee — a normal "not now"
  // A sponsor from a HIGHER tier may always come back: since seizoen 3 a tier-4
  // pays less per day than some tier-3 rivals, but it is still the bigger name
  // (signing bonus, podium premium) — refusing it now must not lock it out.
  if (def.tier > (BY_ID.get(rival.id)?.tier ?? 0)) return false;
  if (offer.dailyStipend !== rival.dailyStipend) return offer.dailyStipend < rival.dailyStipend;
  return offer.podiumBase <= rival.podiumBase;
}

/**
 * Accept a sponsor's offer. If a competitor in the same category is active it
 * is terminated (only with `replace`) and its break penalty is charged. Pays
 * the signing bonus the first time this sponsor is ever accepted. Returns a
 * result message or an error string prefixed with '!'.
 */
export function applyAcceptSponsor(
  db: Database,
  loft: Loft,
  sponsorId: string,
  replace: boolean,
  /** At the limit (SPONSOR_MAX_ACTIVE): the contract to end to make room. It
   *  costs its normal break fee — a seventh sponsor is the player's own choice. */
  dropSponsorId?: string,
): string {
  const def = BY_ID.get(sponsorId);
  if (!def) return '!Onbekende sponsor';
  const st = state(loft);
  const offer = st.offers.find((o) => o.id === sponsorId);
  if (!offer) return '!Deze sponsor heeft momenteel geen aanbod openstaan';
  if (st.mustReduce) return `!Je hebt meer dan ${SPONSOR_MAX_ACTIVE} sponsors. Kies eerst welke je laat gaan.`;

  const rival = rivalFor(st, def);
  // Room check. Switching to a competitor keeps the count the same; anything else
  // needs a free place, or a contract to drop (checked before any money moves).
  let drop: SponsorDef | undefined;
  if (!rival && st.active.length >= SPONSOR_MAX_ACTIVE) {
    drop = dropSponsorId ? BY_ID.get(dropSponsorId) : undefined;
    if (!drop || !st.active.some((a) => a.id === drop!.id)) {
      return `!Je hebt al ${SPONSOR_MAX_ACTIVE} sponsors. Kies eerst welke je laat gaan.`;
    }
    if (loft.money < drop.breakPenalty) {
      return `!Je hebt €${drop.breakPenalty} nodig om het contract met ${drop.name} te verbreken`;
    }
  }
  if (drop) {
    loft.money -= drop.breakPenalty;
    st.active = st.active.filter((a) => a.id !== drop!.id);
    st.declined = st.declined.filter((d) => d.id !== drop!.id);
    st.declined.push({ id: drop.id, at: new Date().toISOString(), perf: perfScore(loft, ownedBestTalent(db, loft.userId)) });
    notify(db, loft, `🤝 Contract met ${drop.name} beëindigd`,
      `Je zegde ${drop.name} op (verbrekingsvergoeding €${drop.breakPenalty}) om plaats te maken voor ${def.name}.`);
  }
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
  st.active.push({ id: sponsorId, since: new Date().toISOString(), dailyStipend: offer.dailyStipend, podiumBase: offer.podiumBase });
  if (!st.signed.includes(sponsorId)) {
    st.signed.push(sponsorId);
    loft.money += offer.signingBonus;
    notify(db, loft, `${def.icon} ${def.name} tekent bij jou`,
      `Welkomstpremie €${offer.signingBonus}. Vanaf nu €${offer.dailyStipend} per dag, plus een podiumpremie per wedstrijdvlucht (${podiumSummary(offer.podiumBase)}).`);
    return `${def.name} is nu een van je sponsors! Tekengeld: €${offer.signingBonus}.`;
  }
  notify(db, loft, `${def.icon} ${def.name} weer aan boord`,
    `Je tekent opnieuw — geen tekengeld, wel €${offer.dailyStipend} per dag en de podiumpremie (${podiumSummary(offer.podiumBase)}).`);
  return `${def.name} is opnieuw een van je sponsors (geen nieuw tekengeld).`;
}

/**
 * Refuse a pending offer. It disappears and normally may return later (rescaled
 * to how the loft performed since) — unless it was a worse competitor of a
 * sponsor you already hold, in which case no means no (see `refusalIsFinal`).
 */
export function applyRefuseSponsor(db: Database, loft: Loft, sponsorId: string): string {
  const st = state(loft);
  const offer = st.offers.find((o) => o.id === sponsorId);
  if (!offer) return '!Er is geen openstaand aanbod van deze sponsor';
  const def = BY_ID.get(sponsorId);
  const final = def ? refusalIsFinal(st, def, offer) : false;
  st.offers = st.offers.filter((o) => o.id !== sponsorId);
  st.declined = st.declined.filter((d) => d.id !== sponsorId);
  st.declined.push({
    id: sponsorId,
    at: new Date().toISOString(),
    perf: perfScore(loft, ownedBestTalent(db, loft.userId)),
    ...(final ? { permanent: true as const } : {}),
  });
  const name = def?.name ?? 'de sponsor';
  return final
    ? `Aanbod van ${name} geweigerd. Ze boden minder dan je huidige sponsor in dezelfde sector — ze komen niet meer terug.`
    : `Aanbod van ${name} geweigerd. Misschien komen ze later met een nieuw voorstel.`;
}

/**
 * Migration v54 (seizoen 3), per loft: tier 4+ contracts and pending offers pay a
 * quarter of their daily stipend from now on, and a loft above the limit is put
 * in the forced reduction. Returns the number of contracts above the limit (0 =
 * nothing to do) so the caller can send the action notification.
 */
export function applySponsorLimitMigration(loft: Loft): number {
  if (loft.isBot) return 0;
  const st = state(loft);
  const cut = (id: string, daily: number) => {
    const def = BY_ID.get(id);
    return def && tierDailyMult(def) !== 1 ? round5(daily * tierDailyMult(def)) : daily;
  };
  for (const c of st.active) c.dailyStipend = cut(c.id, c.dailyStipend);
  for (const o of st.offers) o.dailyStipend = cut(o.id, o.dailyStipend);
  const over = st.active.length - SPONSOR_MAX_ACTIVE;
  if (over > 0) st.mustReduce = true;
  return Math.max(0, over);
}

/** True while the loft must drop sponsors: then NO sponsor pays anything. */
export function sponsorsPaused(loft: Loft): boolean {
  return state(loft).mustReduce === true;
}

/**
 * The forced reduction (seizoen 3): a loft with more than SPONSOR_MAX_ACTIVE
 * contracts drops the given ones — FREE of break fees — and must end at or
 * below the limit in one go. Until then no sponsor pays (see sponsorsPaused).
 */
export function applyReduceSponsors(db: Database, loft: Loft, sponsorIds: string[]): string {
  const st = state(loft);
  if (!st.mustReduce) return '!Je hoeft geen sponsors op te zeggen';
  const ids = [...new Set(sponsorIds)].filter((id) => st.active.some((a) => a.id === id));
  const left = st.active.length - ids.length;
  if (left > SPONSOR_MAX_ACTIVE) {
    return `!Kies er nog ${left - SPONSOR_MAX_ACTIVE} meer: je mag hoogstens ${SPONSOR_MAX_ACTIVE} sponsors houden`;
  }
  if (ids.length === 0) return '!Kies welke sponsors je laat gaan';
  const perf = perfScore(loft, ownedBestTalent(db, loft.userId));
  const at = new Date().toISOString();
  for (const id of ids) {
    st.active = st.active.filter((a) => a.id !== id);
    st.declined = st.declined.filter((d) => d.id !== id);
    st.declined.push({ id, at, perf }); // may come back later, like any cancellation
  }
  delete st.mustReduce;
  const names = ids.map((id) => BY_ID.get(id)?.name ?? id);
  notify(db, loft, '🤝 Je sponsors zijn weer in orde',
    `Je liet ${names.join(', ')} gaan, zonder verbrekingsvergoeding. Je andere sponsors betalen vanaf nu weer uit.`);
  return `Klaar: ${names.length} sponsor${names.length === 1 ? '' : 's'} opgezegd, je andere sponsors betalen weer uit.`;
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

/**
 * Season review: at each rollover a sponsor compares the loft's just-ended season
 * points to the previous season's (its stored `refPoints`). If they fell below
 * `keepRatio` of that reference, the sponsor ends the contract itself — no break
 * penalty for the player — and drops back into the re-offer pool (it may return
 * once the loft climbs back up). The first review after signing only records the
 * baseline. Call this at a season rollover, BEFORE season points are reset.
 */
export function reviewSponsorContracts(db: Database, loft: Loft, endedSeason: number, nowMs: number): void {
  if (loft.isBot) return;
  const st = state(loft);
  if (st.active.length === 0) return;
  const current = loft.seasonPoints;
  const perf = perfScore(loft, ownedBestTalent(db, loft.userId));
  const keep: ActiveSponsorship[] = [];

  for (const c of st.active) {
    const def = BY_ID.get(c.id);
    // First rollover for this contract → just establish the baseline, no verdict.
    if (c.refPoints == null) { c.refPoints = current; keep.push(c); continue; }
    const underperforming =
      c.refPoints >= SPONSOR_REVIEW.minReviewPoints &&
      current < c.refPoints * SPONSOR_REVIEW.keepRatio;
    if (underperforming && def) {
      st.declined = st.declined.filter((d) => d.id !== c.id);
      st.declined.push({ id: c.id, at: new Date(nowMs).toISOString(), perf });
      const noteId = `ntf:sponsorend:${loft.userId}:${c.id}:${endedSeason}`;
      const existing = db.notifications.find((n) => n.id === noteId);
      const note = {
        id: noteId, userId: loft.userId, kind: 'info' as const,
        title: `${def.icon} ${def.name} beëindigt het contract`,
        body: `${def.name} vindt dat je prestaties gezakt zijn tegenover vorig seizoen (${current} punten dit seizoen, ${c.refPoints} vorig seizoen) en trekt zich terug — geen verbrekingsvergoeding voor jou. Presteer je weer sterk, dan kloppen ze misschien opnieuw aan.`,
        flightId: null, createdAt: new Date(nowMs).toISOString(), read: existing?.read ?? false,
      };
      if (existing) Object.assign(existing, note); else db.notifications.push(note);
      continue; // contract dropped
    }
    // Kept: roll the reference forward to this season for next time.
    c.refPoints = current;
    keep.push(c);
  }
  st.active = keep;
}

/** A contract `restoreSeasonReviewDrops` put back, with the stipend it made good. */
export interface RestoredSponsor {
  def: SponsorDef;
  dailyStipend: number;
  backPay: number; // daily stipends missed between the walk-out and now
}

/**
 * Undo the season review's walk-outs at the rollover that STARTED the current
 * season (owner request: the review of seizoen 2 was too strict).
 *
 * A walk-out leaves only a `declined` row stamped with the exact rollover moment
 * (`reviewSponsorContracts` is called with `atMs = start + SEASON_MS`, which is
 * also the new `world.seasonStartedAt`), so that stamp identifies them — a
 * player's own refusal can't land on that same millisecond.
 *
 * ⚠️ The dropped contract's own terms were NOT kept, so the sponsor comes back on
 * its catalogue terms. That is identical for every contract signed on a first
 * offer or as the starter sponsor; a contract signed on a re-offer (×0.7–1.5)
 * gets the catalogue value instead of its scaled one.
 *
 * - `refPoints` is left empty, so the next rollover only records a baseline: the
 *   restored sponsor cannot walk out again at the end of this season.
 * - Daily stipends missed since the walk-out (midnights up to `lastDailyTick`)
 *   are paid out once. Podium premiums of races in between are not.
 * - Skipped when another sponsor of the same category is active now (the player
 *   signed a rival in the meantime — one per category).
 * - No signing bonus: the sponsor was already signed.
 */
export function restoreSeasonReviewDrops(
  loft: Loft,
  seasonStartedAt: string,
  lastDailyTick: string | undefined,
): RestoredSponsor[] {
  if (loft.isBot) return [];
  const st = state(loft);
  const dropAt = Date.parse(seasonStartedAt);
  if (Number.isNaN(dropAt)) return [];
  const drops = st.declined.filter((d) => Date.parse(d.at) === dropAt && !d.permanent);
  if (drops.length === 0) return [];

  const last = lastDailyTick ? Date.parse(lastDailyTick) : NaN;
  const missedDays = !Number.isNaN(last) && last > dropAt ? Math.floor((last - dropAt) / 86400000) + 1 : 0;

  const restored: RestoredSponsor[] = [];
  for (const d of drops) {
    const def = BY_ID.get(d.id);
    if (!def) continue;
    if (st.active.some((c) => c.id === d.id)) continue; // already back (signed again)
    if (st.active.some((c) => BY_ID.get(c.id)?.category === def.category)) continue; // rival signed since
    st.active.push({ id: d.id, since: seasonStartedAt, dailyStipend: def.dailyStipend, podiumBase: def.podiumBase });
    st.declined = st.declined.filter((x) => x.id !== d.id);
    st.offers = st.offers.filter((o) => o.id !== d.id);
    const backPay = def.dailyStipend * missedDays;
    loft.money += backPay;
    restored.push({ def, dailyStipend: def.dailyStipend, backPay });
  }
  return restored;
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
    dailyStipend: terms.dailyStipend,
    podiumBase: terms.podiumBase,
    // The full payout grid (tier × placing), so the client never has to know
    // the factors — see config sponsorPodiumBonus().
    podium: podiumGrid(terms.podiumBase),
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
        ...sponsorDTO(def, { signingBonus: def.signingBonus, dailyStipend: c.dailyStipend, podiumBase: c.podiumBase }, st.signed.includes(c.id)),
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
        // Refusing this one is definitive (it pays less than the sponsor you
        // already have in this category). The page warns before you click, so a
        // permanent no is never a surprise.
        refusalIsFinal: refusalIsFinal(st, def, o),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort(byTier);

  return {
    bestTalent: best, active, offers,
    // Seizoen 3 limit: how many contracts a loft may hold, and whether it must
    // drop some first (then no sponsor pays until it has).
    maxActive: SPONSOR_MAX_ACTIVE,
    mustReduce: st.mustReduce === true,
  };
}
