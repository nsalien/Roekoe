/**
 * Samen kweken — De Stem: "Broeden met de duif van een andere speler".
 *
 * One player puts a bird up ("beschikbaar om mee te kweken"), says what a
 * partner must at least have — an algemene score (★), energie and libido — and
 * decides right there whether they want THE YOUNG (a twin included, both go to
 * the same loft) or THE FEE. Another player offers one of their own birds that
 * meets it, and both see what the young are expected to score; then they
 * negotiate only the amount the one who keeps the young pays the other. Each
 * side may accept the amount the other side set last, or answer with their own.
 * The moment one of them accepts, the two birds go on the nest and EACH player
 * pays STUD.cost.
 *
 * What is different from an own nest, and why:
 *  - The pair belongs to whoever keeps the young (`BreedingPair.ownerId`); the
 *    other bird's owner is `deal.partnerId`. Everything that asks "is this bird
 *    on a nest?" looks at the BIRD, so the partner's bird is busy like any other.
 *  - The agreed fee changes hands only when young hatch (schedule.ts,
 *    tickBreedingHatch). An empty clutch pays no fee, and each player gets
 *    `studFailedRefund()` back — the same share as an own nest. Stopping the nest
 *    (either player may) or a parent dying pays nothing back and no fee.
 *  - Infrarood (hokinrichting) does nothing for this nest: the owner's wish is
 *    that breeding gear in your own loft does not count here.
 *
 * Storage: the offer to breed sits on the bird (`Pigeon.stud`, loaded with the
 * world); the negotiations sit in their own table that only the Kweek routes
 * load (`Database.studDeals`). So nothing cleans a negotiation up when a bird is
 * sold or dies — `pruneStudDeals` drops what no longer holds whenever they are
 * read.
 */

import { BOT, BREEDING, STUD } from '../config/gameConfig.js';
import type { Database, Loft, Pigeon, StudDeal, StudListing, StudWants } from '../schema.js';
import { newId } from '../store.js';
import { evaluateBadges } from './badges.js';
import { expectedYoung, inheritBreed } from './breeding.js';
import { kinship } from './pedigree.js';
import { debtBlock } from './economy.js';
import { pigeonCommittedToFlight } from './flight.js';
import { marketValue } from './market.js';
import { progressMissions } from './missions.js';
import { ageInWeeks, breedingCooldownDaysLeft, isAway, onRestCure, talent } from './pigeon.js';
import { clamp, round1 } from './util.js';

/** Her offer to breed, if it still stands (a listing by a previous owner is void). */
export function activeListing(p: Pigeon | undefined | null): StudListing | null {
  return p?.stud && p.stud.by === p.ownerId ? p.stud : null;
}

/** What the owner of a listed bird wants: the young or the fee (older listings: the fee). */
export function wantsOf(listing: StudListing): StudWants {
  return listing.wants ?? 'fee';
}

/** Who keeps the young under this listing: its owner when they want the young, else the partner. */
function keeperFor(listing: StudListing, studOwnerId: string, mateOwnerId: string): string {
  return wantsOf(listing) === 'young' ? studOwnerId : mateOwnerId;
}

/** The two as a pair: [doffer, duivin]. */
function sireAndDam(a: Pigeon, b: Pigeon): [Pigeon, Pigeon] {
  return a.sex === 'doffer' ? [a, b] : [b, a];
}

/**
 * What the young of these two are expected to score (★), inteelt included, and
 * what such a youngster is worth on the market the day she hatches — what both
 * players see before they agree. The value is the game's own valuation
 * (`marketValue`) of the average youngster (breeding.expectedYoung): her skills
 * and gene caps, a newborn, the breed she inherits, no kenmerk.
 */
export function studYoung(db: Database, a: Pigeon, b: Pigeon): { score: number; value: number } {
  const [sire, dam] = sireAndDam(a, b);
  const y = expectedYoung(sire, dam, kinship(db, sire, dam));
  const week = db.world.currentWeek;
  const young: Pigeon = {
    ...dam,
    id: `young:${sire.id}:${dam.id}`,
    speed: y.speed,
    endurance: y.endurance,
    orientation: y.orientation,
    genes: y.genes,
    experience: 0,
    birthWeek: week,
    createdAtWeek: week,
    breed: inheritBreed(sire, dam),
    trait: null,
    quirk: null,
    sireId: sire.id,
    damId: dam.id,
  };
  return { score: y.score, value: marketValue(db, young, week) };
}

/** Just the expected score (★) — see `studYoung`. */
export function studYoungScore(db: Database, a: Pigeon, b: Pigeon): number {
  return studYoung(db, a, b).score;
}

/**
 * Why this bird cannot be put up or offered for samen kweken right now, or null.
 * The owner's rule: a bird for breeding is not sick, and is not entered for a
 * flight — and she stays off the flights while she is on offer (enterFlight).
 */
export function offerBlock(db: Database, p: Pigeon, nowMs: number = Date.now()): string | null {
  if (p.ailment) return `${p.name} is ${p.ailment.kind === 'kwetsuur' ? 'gekwetst' : 'ziek'} — een duif om mee te kweken moet gezond zijn`;
  if (p.inInfirmary) return `${p.name} ligt in de ziekenboeg — een duif om mee te kweken moet gezond zijn`;
  if (pigeonCommittedToFlight(db, p.id, nowMs)) return `${p.name} staat ingeschreven voor een vlucht — schrijf haar eerst uit`;
  return null;
}

/**
 * Why this bird may not be entered for a flight: she is put up for samen kweken,
 * or offered to someone else's bird in an open negotiation. The second only when
 * the negotiations were loaded (the entry route asks for them, see the middleware).
 */
export function studFlightBlock(db: Database, p: Pigeon): string | null {
  if (activeListing(p)) return `${p.name} wordt aangeboden om mee te kweken — haal haar eerst uit het aanbod (Kweek → Samen kweken)`;
  if (db.studDeals) {
    pruneStudDeals(db);
    if (db.studDeals.some((d) => d.mateId === p.id))
      return `${p.name} is voorgesteld om mee te kweken — trek dat voorstel eerst in (Kweek → Samen kweken)`;
  }
  return null;
}

function onNest(db: Database, pigeonId: string): boolean {
  return db.breedingPairs.some((bp) => bp.sireId === pigeonId || bp.damId === pigeonId);
}

/** Why this bird cannot go on a nest right now, or null. Same rules as an own nest (startBreeding). */
export function breedBlock(db: Database, p: Pigeon, nowMs: number = Date.now()): string | null {
  const weeks = ageInWeeks(p, db.world.currentWeek);
  if (weeks < BREEDING.minAgeWeeks) return `${p.name} is nog te jong om te kweken (${weeks} van de ${BREEDING.minAgeWeeks} weken)`;
  if (p.ailment) return `${p.name} is ziek of gekwetst`;
  if (p.inInfirmary) return `${p.name} ligt in de ziekenboeg`;
  if (onRestCure(p, nowMs)) return `${p.name} is op rustkuur`;
  if (isAway(p, nowMs)) return `${p.name} is nog niet thuis van haar vlucht`;
  if (p.form < BREEDING.minParentForm) return `${p.name} heeft minstens ${BREEDING.minParentForm} energie nodig`;
  const days = breedingCooldownDaysLeft(p, nowMs);
  if (days > 0) return `${p.name} rust nog uit van haar vorige nest — nog ${days} ${days === 1 ? 'dag' : 'dagen'}`;
  if (onNest(db, p.id)) return `${p.name} zit al op een nest`;
  if (pigeonCommittedToFlight(db, p.id, nowMs)) return `${p.name} staat ingeschreven voor een vlucht`;
  return null;
}

/** Does the offered bird meet what the owner of the listed one asks? Null = yes. */
export function criteriaGap(listing: StudListing, mate: Pigeon): string | null {
  if (talent(mate) < listing.minScore) return `${mate.name} haalt de gevraagde score niet (★${listing.minScore} of meer)`;
  if (mate.form < listing.minEnergy) return `${mate.name} heeft te weinig energie (minstens ${listing.minEnergy} gevraagd)`;
  if (mate.libido < listing.minLibido) return `${mate.name} heeft te weinig libido (minstens ${listing.minLibido} gevraagd)`;
  return null;
}

function loftOf(db: Database, userId: string): Loft | undefined {
  return db.lofts.find((l) => l.userId === userId);
}

function nameOf(db: Database, userId: string): string {
  return loftOf(db, userId)?.name ?? 'Onbekend';
}

/** Bell for a REAL player (bots read none). Kept to the inbox cap like the other modules. */
function notify(db: Database, userId: string, title: string, body: string): void {
  if (loftOf(db, userId)?.isBot ?? true) return;
  db.notifications.push({
    id: newId('ntf'), userId, kind: 'info', title, body,
    flightId: null, createdAt: new Date().toISOString(), read: false,
  });
  const mine = db.notifications.filter((n) => n.userId === userId);
  if (mine.length > 40) {
    const drop = new Set(mine.slice(0, mine.length - 40).map((n) => n.id));
    db.notifications = db.notifications.filter((n) => !drop.has(n.id));
  }
}

function dealsOf(db: Database): StudDeal[] {
  // Only the Kweek routes load them (D1Store.load, `studDeals`). Calling in from
  // anywhere else is a programming error, not an empty list.
  if (!db.studDeals) throw new Error('studDeals not loaded');
  return db.studDeals;
}

function otherSide(deal: StudDeal, userId: string): string {
  return userId === deal.studOwnerId ? deal.mateOwnerId : deal.studOwnerId;
}

/** "jij"/"hok X" — who keeps the young, from `viewer`'s side. */
function termsLine(db: Database, deal: StudDeal, viewer: string): string {
  const keeper = deal.youngTo === viewer ? 'jij' : nameOf(db, deal.youngTo);
  const other = deal.youngTo === viewer ? nameOf(db, otherSide(deal, viewer)) : 'jou';
  return deal.fee > 0
    ? `de jongen gaan naar ${keeper}, die €${deal.fee} betaalt aan ${other} zodra ze er zijn`
    : `de jongen gaan naar ${keeper}, zonder vergoeding`;
}

/**
 * Drop every negotiation that no longer holds: a bird gone or sold, the listed
 * bird no longer on offer, or its owner now wanting the other side of the deal.
 * Silent — what it was about is simply not there any more.
 */
export function pruneStudDeals(db: Database): void {
  if (!db.studDeals) return;
  db.studDeals = db.studDeals.filter((d) => {
    const stud = db.pigeons.find((p) => p.id === d.studId);
    const mate = db.pigeons.find((p) => p.id === d.mateId);
    const listing = activeListing(stud);
    return (
      !!stud && !!mate && !!listing &&
      stud.ownerId === d.studOwnerId && mate.ownerId === d.mateOwnerId &&
      d.youngTo === keeperFor(listing, d.studOwnerId, d.mateOwnerId)
    );
  });
}

/** End every open negotiation one of these birds is in, and tell the other players why. */
function dropDealsWith(db: Database, pigeonIds: string[], why: string, exceptDealId?: string): void {
  const ids = new Set(pigeonIds);
  const gone = dealsOf(db).filter((d) => d.id !== exceptDealId && (ids.has(d.studId) || ids.has(d.mateId)));
  for (const d of gone) {
    const stud = db.pigeons.find((p) => p.id === d.studId);
    const mate = db.pigeons.find((p) => p.id === d.mateId);
    const pair = `${mate?.name ?? '?'} × ${stud?.name ?? '?'}`;
    // The proposer always hears it; the owner of the listed bird only when it was
    // not their own doing (they unlisted her, or she went on another nest).
    notify(db, d.mateOwnerId, '🤝 Kweekvoorstel vervallen', `Je voorstel ${pair} is vervallen: ${why}.`);
  }
  const dropped = new Set(gone.map((d) => d.id));
  db.studDeals = dealsOf(db).filter((d) => !dropped.has(d.id));
}

// --- putting a bird up ---------------------------------------------------------

export interface StudCriteria {
  minScore: number;
  minEnergy: number;
  minLibido: number;
  /** Decided up front: the young or the fee. */
  wants: StudWants;
}

function cleanCriteria(c: StudCriteria): StudCriteria | string {
  const vals = [c.minScore, c.minEnergy, c.minLibido].map((v) => Math.round(Number(v)));
  if (vals.some((v) => !Number.isFinite(v) || v < 0 || v > 100)) return 'Elke minimumwaarde ligt tussen 0 en 100';
  if (c.wants !== 'young' && c.wants !== 'fee') return 'Kies of je de jongen wil of de vergoeding';
  return { minScore: vals[0], minEnergy: vals[1], minLibido: vals[2], wants: c.wants };
}

/**
 * Put one of your birds up for samen kweken (or change what you ask). Free, and
 * she keeps flying: only an agreement puts her on a nest. The owner decides here
 * whether they want the young or the fee; changing that ends the negotiations
 * about her, since they were about the other side. `criteria = null` takes her
 * off again — the open negotiations about her end too.
 */
export function setStudListing(
  db: Database,
  userId: string,
  pigeonId: string,
  criteria: StudCriteria | null,
  nowMs: number = Date.now(),
): string | null {
  const p = db.pigeons.find((x) => x.id === pigeonId && x.ownerId === userId);
  if (!p) return 'Duif niet gevonden';
  if (criteria === null) {
    if (!activeListing(p)) return 'Deze duif wordt niet aangeboden';
    p.stud = null;
    if (db.studDeals) dropDealsWith(db, [p.id], `${p.name} wordt niet meer aangeboden`);
    return null;
  }
  const weeks = ageInWeeks(p, db.world.currentWeek);
  if (weeks < BREEDING.minAgeWeeks) return `${p.name} is nog te jong om te kweken (${weeks} van de ${BREEDING.minAgeWeeks} weken)`;
  // Only for a NEW offer: changing what you ask of an existing one stays possible
  // (she cannot have been entered since — enterFlight refuses her).
  if (!activeListing(p)) {
    const blocked = offerBlock(db, p, nowMs);
    if (blocked) return blocked;
  }
  const c = cleanCriteria(criteria);
  if (typeof c === 'string') return c;
  const before = activeListing(p);
  const switched = !!before && wantsOf(before) !== c.wants;
  p.stud = {
    by: userId, ...c,
    // The bots answer again once the owner wants the other side of the deal.
    asked: switched ? [] : before?.asked ?? [],
    at: before?.at ?? new Date(nowMs).toISOString(),
  };
  if (switched && db.studDeals) {
    dropDealsWith(db, [p.id], `${nameOf(db, userId)} wil voor ${p.name} nu ${c.wants === 'young' ? 'zelf de jongen' : 'de vergoeding'}`);
  }
  // The bots that have a fitting bird answer right away (botsProposeTo).
  if (db.studDeals) botsProposeTo(db, p, nowMs);
  return null;
}

// --- negotiating -----------------------------------------------------------------

function cleanFee(fee: number): number | string {
  const f = Math.round(Number(fee));
  if (!Number.isFinite(f) || f < 0) return 'Ongeldige vergoeding';
  if (f > STUD.maxFee) return `De vergoeding kan hoogstens €${STUD.maxFee} zijn`;
  return f;
}

/**
 * Offer one of your birds to a bird that was put up, with the amount you propose.
 * Who keeps the young is not up for discussion: the owner of the listed bird
 * decided that when they put her up. They answer.
 */
export function proposeStud(
  db: Database,
  userId: string,
  studId: string,
  mateId: string,
  fee: number,
  nowMs: number = Date.now(),
): string | null {
  pruneStudDeals(db);
  const deals = dealsOf(db);
  const stud = db.pigeons.find((p) => p.id === studId);
  const listing = activeListing(stud);
  if (!stud || !listing) return 'Deze duif wordt niet (meer) aangeboden';
  if (stud.ownerId === userId) return 'Dit is je eigen duif';
  const mate = db.pigeons.find((p) => p.id === mateId && p.ownerId === userId);
  if (!mate) return 'Kies een van je eigen duiven';
  if (mate.sex === stud.sex) return `${stud.name} is een ${stud.sex} — kies een ${stud.sex === 'doffer' ? 'duivin' : 'doffer'}`;
  const weeks = ageInWeeks(mate, db.world.currentWeek);
  if (weeks < BREEDING.minAgeWeeks) return `${mate.name} is nog te jong om te kweken (${weeks} van de ${BREEDING.minAgeWeeks} weken)`;
  const unfit = offerBlock(db, mate, nowMs);
  if (unfit) return unfit;
  const gap = criteriaGap(listing, mate);
  if (gap) return gap;
  const loft = loftOf(db, userId);
  if (!loft) return 'Geen hok gevonden';
  const debt = debtBlock(loft); if (debt) return debt;
  const f = cleanFee(fee);
  if (typeof f === 'string') return f;
  if (deals.some((d) => d.studId === studId && d.mateId === mateId))
    return `Je hebt met ${mate.name} al een voorstel lopen bij ${stud.name}`;
  if (deals.filter((d) => d.mateOwnerId === userId).length >= STUD.maxOpenProposals)
    return `Je hebt al ${STUD.maxOpenProposals} voorstellen lopen — wacht op een antwoord of trek er een in`;

  const now = new Date(nowMs).toISOString();
  const deal: StudDeal = {
    id: newId('stud'),
    studId, studOwnerId: stud.ownerId,
    mateId, mateOwnerId: userId,
    youngTo: keeperFor(listing, stud.ownerId, userId),
    fee: f,
    turn: stud.ownerId,
    createdAt: now,
    updatedAt: now,
  };
  deals.push(deal);
  const young = studYoung(db, stud, mate);
  notify(
    db, stud.ownerId, `🤝 Kweekvoorstel voor ${stud.name}`,
    `${loft.name} stelt ${mate.name} (★${Math.round(talent(mate))}) voor als partner van ${stud.name} — ` +
      `het jong scoort naar schatting ★${Math.round(young.score)} (marktwaarde ±€${young.value}): ` +
      `${termsLine(db, deal, stud.ownerId)}. Antwoord bij Kweek → Samen kweken.`,
  );
  if (loftOf(db, stud.ownerId)?.isBot) botAnswer(db, deal, nowMs);
  return null;
}

/** Answer with your own amount. Only when it is your turn: the other side set the current one. */
export function counterStud(
  db: Database,
  userId: string,
  dealId: string,
  fee: number,
  nowMs: number = Date.now(),
): string | null {
  pruneStudDeals(db);
  const deal = dealsOf(db).find((d) => d.id === dealId && (d.studOwnerId === userId || d.mateOwnerId === userId));
  if (!deal) return 'Dit voorstel bestaat niet (meer)';
  const other = otherSide(deal, userId);
  if (deal.turn !== userId) return `Je wacht nog op het antwoord van ${nameOf(db, other)}`;
  const f = cleanFee(fee);
  if (typeof f === 'string') return f;
  if (f === deal.fee) return 'Dat is hetzelfde bedrag — aanvaard het dan gewoon';
  deal.fee = f;
  deal.turn = other;
  deal.updatedAt = new Date(nowMs).toISOString();
  const stud = db.pigeons.find((p) => p.id === deal.studId);
  const mate = db.pigeons.find((p) => p.id === deal.mateId);
  notify(
    db, other, `🤝 Tegenvoorstel: ${mate?.name ?? '?'} × ${stud?.name ?? '?'}`,
    `${nameOf(db, userId)} stelt voor: ${termsLine(db, deal, other)}. Antwoord bij Kweek → Samen kweken.`,
  );
  if (loftOf(db, other)?.isBot) botAnswer(db, deal, nowMs);
  return null;
}

/** Decline (the owner of the listed bird) or withdraw (the proposer). Either side, any time. */
export function closeStud(db: Database, userId: string, dealId: string): string | null {
  pruneStudDeals(db);
  const deal = dealsOf(db).find((d) => d.id === dealId && (d.studOwnerId === userId || d.mateOwnerId === userId));
  if (!deal) return 'Dit voorstel bestaat niet (meer)';
  db.studDeals = dealsOf(db).filter((d) => d.id !== dealId);
  const stud = db.pigeons.find((p) => p.id === deal.studId);
  const mate = db.pigeons.find((p) => p.id === deal.mateId);
  const pair = `${mate?.name ?? '?'} × ${stud?.name ?? '?'}`;
  const other = otherSide(deal, userId);
  notify(
    db, other, '🤝 Geen akkoord',
    userId === deal.studOwnerId
      ? `${nameOf(db, userId)} ging niet in op je voorstel ${pair}.`
      : `${nameOf(db, userId)} trok het voorstel ${pair} in.`,
  );
  return null;
}

/**
 * Accept the terms on the table — the other side set them. Both birds go on the
 * nest right away and each player pays STUD.cost; the fee follows at the hatch.
 */
export function acceptStud(db: Database, userId: string, dealId: string, nowMs: number = Date.now()): string | null {
  pruneStudDeals(db);
  const deal = dealsOf(db).find((d) => d.id === dealId && (d.studOwnerId === userId || d.mateOwnerId === userId));
  if (!deal) return 'Dit voorstel bestaat niet (meer)';
  const other = otherSide(deal, userId);
  if (deal.turn !== userId) return `Je wacht nog op het antwoord van ${nameOf(db, other)}`;
  const stud = db.pigeons.find((p) => p.id === deal.studId)!;
  const mate = db.pigeons.find((p) => p.id === deal.mateId)!;
  const listing = activeListing(stud)!; // pruneStudDeals guarantees all three
  // Energie and libido move every day: what she had at the proposal is not enough.
  const gap = criteriaGap(listing, mate);
  if (gap) return gap;
  for (const bird of [stud, mate]) {
    const why = breedBlock(db, bird, nowMs);
    if (why) return why;
  }
  const keeper = loftOf(db, deal.youngTo);
  const partnerId = otherSide(deal, deal.youngTo);
  const partner = loftOf(db, partnerId);
  if (!keeper || !partner) return 'Speler niet gevonden';
  // Same rule as an own nest: a clutch waiting on a choice blocks the next one.
  if (keeper.pendingBroods?.some((b) => (b.origin ?? 'nest') === 'nest'))
    return deal.youngTo === userId
      ? 'Er wacht nog een nest op je keuze — beslis eerst welke jongen je houdt'
      : `${keeper.name} moet eerst nog beslissen over een nest dat op een keuze wacht`;
  // A bot drops young it has no perch for (tickBreedingHatch), so it does not
  // take a nest it cannot house.
  if (keeper.isBot && !botHasRoom(db, keeper)) return `${keeper.name} heeft geen plaats meer voor de jongen`;
  for (const l of [keeper, partner]) {
    const debt = debtBlock(l);
    if (debt) return l.userId === userId ? debt : `${l.name} staat in het rood en kan nu niet kweken`;
  }
  // Whoever keeps the young must also be able to cover the fee they promised.
  const need = (l: Loft) => STUD.cost + (l === keeper ? deal.fee : 0);
  for (const l of [keeper, partner]) {
    if (l.money < need(l))
      return l.userId === userId ? `Niet genoeg geld: je hebt €${need(l)} nodig` : `${l.name} heeft niet genoeg geld meer`;
  }

  for (const l of [keeper, partner]) l.money -= STUD.cost;
  for (const bird of [stud, mate]) bird.form = round1(clamp(bird.form - 15, 0, 100));
  const [sire, dam] = sireAndDam(stud, mate);
  db.breedingPairs.push({
    id: newId('brd'),
    ownerId: keeper.userId,
    sireId: sire.id,
    damId: dam.id,
    hatchAt: new Date(nowMs).toISOString(),
    createdAtWeek: db.world.currentWeek,
    deal: { partnerId: partner.userId, fee: deal.fee },
  });
  for (const l of [keeper, partner]) {
    l.stats.broods += 1;
    progressMissions(db, l, 'brood', 1);
    evaluateBadges(db, l);
  }
  db.studDeals = dealsOf(db).filter((d) => d.id !== deal.id);
  notify(
    db, other, `🤝 Akkoord: ${mate.name} × ${stud.name} broeden`,
    `${nameOf(db, userId)} ging akkoord: ${termsLine(db, deal, other)}. Het nest is gestart; ` +
      `jullie betaalden elk €${STUD.cost}.`,
  );
  // Both birds are on a nest now: whatever else was being discussed about them ends.
  dropDealsWith(db, [stud.id, mate.id], `${stud.name} en ${mate.name} zitten nu samen op een nest`, deal.id);
  return null;
}

// --- bots ------------------------------------------------------------------------

/** What a bot asks for its bird's young: a share of her market value, rounded to €50. */
export function botStudFee(db: Database, p: Pigeon): number {
  const raw = Math.max(STUD.botMinFee, marketValue(db, p, db.world.currentWeek) * STUD.botFeeShare);
  return Math.round(raw / 50) * 50;
}

const round50 = (v: number) => Math.round(v / 50) * 50;

/**
 * What a bot pays for young it keeps: it opens with STUD.botBidShare of what such
 * a youngster is worth at birth and goes up to STUD.botMaxBidShare.
 */
export function botYoungBid(youngValue: number): { offer: number; max: number } {
  return { offer: round50(youngValue * STUD.botBidShare), max: round50(youngValue * STUD.botMaxBidShare) };
}

/** Can this bot house another clutch? Same rule as its own nests (bots.maybeBreed). */
function botHasRoom(db: Database, loft: Loft, perches = 1): boolean {
  const owned = db.pigeons.filter((p) => p.ownerId === loft.userId).length;
  const pairs = db.breedingPairs.filter((bp) => bp.ownerId === loft.userId).length;
  return owned + pairs + perches <= loft.capacity;
}

/** Can this bot pay for a samen-kweken nest (and `fee` on top) without touching its reserve? */
function botCanPay(loft: Loft, fee = 0): boolean {
  return loft.money - BOT.breedReserve >= STUD.cost + fee;
}

/** What the bot settles for in this deal: [accept when the amount is …, the amount it answers with]. */
function botTerms(db: Database, deal: StudDeal, bot: string): { ok: (fee: number) => boolean; answer: number } | null {
  const stud = db.pigeons.find((p) => p.id === deal.studId);
  const mate = db.pigeons.find((p) => p.id === deal.mateId);
  if (!stud || !mate) return null;
  if (deal.youngTo === bot) {
    // The bot keeps the young and pays: up to its maximum bid.
    const { max } = botYoungBid(studYoung(db, stud, mate).value);
    return { ok: (fee) => fee <= max, answer: max };
  }
  // The player keeps the young and pays the bot: at least its asking fee.
  const ask = botStudFee(db, bot === deal.studOwnerId ? stud : mate);
  return { ok: (fee) => fee >= ask, answer: ask };
}

/**
 * A bot answers on the spot, in either role. When it is paid (the player keeps
 * the young) it wants at least its asking fee; when it keeps the young it pays at
 * most its maximum bid. Terms it likes are accepted — or, if a bird cannot go on
 * a nest right now, handed back so the player can start once she can; anything
 * else gets its own amount as the answer. A bot that would keep the young but has
 * no perch or money left for them declines.
 */
function botAnswer(db: Database, deal: StudDeal, nowMs: number): void {
  const bot = deal.turn;
  const human = otherSide(deal, bot);
  const loft = loftOf(db, bot);
  const terms = botTerms(db, deal, bot);
  if (!loft || !terms) return;
  if (deal.youngTo === bot && (!botHasRoom(db, loft) || !botCanPay(loft, Math.min(deal.fee, terms.answer)))) {
    closeStud(db, bot, deal.id);
    return;
  }
  if (terms.ok(deal.fee)) {
    if (!acceptStud(db, bot, deal.id, nowMs)) return;
    deal.turn = human; // agreed, but not now: the player starts it when both birds can
    deal.updatedAt = new Date(nowMs).toISOString();
    return;
  }
  deal.fee = terms.answer;
  deal.turn = human;
  deal.updatedAt = new Date(nowMs).toISOString();
}

/**
 * The bots answer a player's bird with their own: a bot whose bird on offer is of
 * the other sex, healthy, free today, not family and good enough for what the
 * player asks, proposes — once per offer (`StudListing.asked`), at most
 * STUD.botMaxProposals bots per offer, the best expected young first. It offers
 * its asking fee when the player keeps the young, and its opening bid when the
 * player wants the fee (it needs a free perch and the money for that).
 * Runs when a player puts a bird up and whenever the Kweek page is opened.
 * Returns whether anything changed.
 */
export function botsProposeTo(db: Database, stud: Pigeon, nowMs: number = Date.now()): boolean {
  const listing = activeListing(stud);
  const owner = loftOf(db, stud.ownerId);
  if (!listing || !owner || owner.isBot || offerBlock(db, stud, nowMs)) return false;
  const deals = dealsOf(db);
  const asked = new Set(listing.asked ?? []);
  let open = deals.filter((d) => d.studId === stud.id && loftOf(db, d.mateOwnerId)?.isBot).length;
  const wantsFee = wantsOf(listing) === 'fee';
  const options = db.lofts
    .filter((l) => l.isBot && !asked.has(l.userId))
    .map((l) => {
      const bird = db.pigeons.find((p) => p.ownerId === l.userId && activeListing(p) && p.sex !== stud.sex);
      if (!bird || breedBlock(db, bird, nowMs) || offerBlock(db, bird, nowMs) || criteriaGap(listing, bird)) return null;
      const [sire, dam] = sireAndDam(stud, bird);
      if (kinship(db, sire, dam)) return null; // bots never breed with family
      if (deals.some((d) => d.studId === stud.id && d.mateId === bird.id)) return null;
      const young = studYoung(db, stud, bird);
      const fee = wantsFee ? botYoungBid(young.value).offer : botStudFee(db, bird);
      if (wantsFee ? !botHasRoom(db, l) || !botCanPay(l, fee) : !botCanPay(l)) return null;
      return { loft: l, bird, fee, score: young.score };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.score - a.score);
  let changed = false;
  for (const o of options) {
    if (open >= STUD.botMaxProposals) break;
    const now = new Date(nowMs).toISOString();
    const deal: StudDeal = {
      id: newId('stud'),
      studId: stud.id, studOwnerId: stud.ownerId,
      mateId: o.bird.id, mateOwnerId: o.loft.userId,
      youngTo: keeperFor(listing, stud.ownerId, o.loft.userId),
      fee: o.fee,
      turn: stud.ownerId,
      createdAt: now,
      updatedAt: now,
    };
    deals.push(deal);
    asked.add(o.loft.userId);
    open++;
    changed = true;
    notify(
      db, stud.ownerId, `🤝 Kweekvoorstel voor ${stud.name}`,
      `${o.loft.name} stelt ${o.bird.name} (★${Math.round(talent(o.bird))}) voor als partner van ${stud.name} — ` +
        `het jong scoort naar schatting ★${Math.round(o.score)}: ${termsLine(db, deal, stud.ownerId)}. ` +
        'Antwoord bij Kweek → Samen kweken.',
    );
  }
  if (changed) stud.stud = { ...listing, asked: [...asked] };
  return changed;
}

/** Let the bots answer every bird a player has on offer (see botsProposeTo). */
export function botsAnswerListings(db: Database, nowMs: number = Date.now()): boolean {
  if (!db.studDeals) return false;
  pruneStudDeals(db);
  let changed = false;
  for (const p of db.pigeons) {
    if (activeListing(p) && botsProposeTo(db, p, nowMs)) changed = true;
  }
  return changed;
}

/**
 * A bot keeps one bird up for samen kweken: its best-gened adult of at least
 * STUD.botMinScore, asking a partner up to STUD.botScoreMargin below her. It
 * wants the young when it has STUD.botYoungFreePerches perches to spare and the
 * money, else the fee. The same bird is the one it offers to players' birds. It
 * keeps her home from the flights and from its own nests (bots.ts), so a player
 * who comes to an agreement finds her free. Runs on the daily tick; writes only
 * when the listing changes.
 */
export function botOfferStud(db: Database, loft: Loft, pigeons: Pigeon[], nowMs: number = Date.now()): void {
  if (pigeons.some((p) => activeListing(p))) return;
  const genes = (p: Pigeon) => ((p.genes?.speed ?? 0) + (p.genes?.endurance ?? 0) + (p.genes?.orientation ?? 0)) / 3;
  const pick = pigeons
    // Same rule as a player: healthy and not entered for a flight.
    .filter((p) => ageInWeeks(p, db.world.currentWeek) >= BREEDING.minAgeWeeks && talent(p) >= STUD.botMinScore && !offerBlock(db, p, nowMs))
    // Prefer a bird that is free today, so a player can start without waiting.
    .sort((a, b) => Number(!!breedBlock(db, a, nowMs)) - Number(!!breedBlock(db, b, nowMs)) || genes(b) - genes(a) || talent(b) - talent(a))[0];
  if (!pick) return;
  pick.stud = {
    by: loft.userId,
    minScore: Math.max(0, Math.floor((talent(pick) - STUD.botScoreMargin) / 5) * 5),
    minEnergy: STUD.botMinEnergy,
    minLibido: STUD.botMinLibido,
    wants: botHasRoom(db, loft, STUD.botYoungFreePerches) && botCanPay(loft) ? 'young' : 'fee',
    at: new Date(nowMs).toISOString(),
  };
}
