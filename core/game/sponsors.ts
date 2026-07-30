/**
 * Sponsors. When a loft performs well, companies want to invest in the melker.
 * Each sponsor unlocks at a prestige threshold; signing one as your head
 * sponsor pays a one-time signing bonus and then a weekly stipend plus a bonus
 * for every flight you win. Only one sponsor is active at a time.
 *
 * The weekly stipend is applied in engine.advanceWeek and the win bonus in
 * schedule.tickFlights; this module owns the catalogue lookups, the unlock
 * rules and the sign/cancel actions.
 */

import { SPONSORS, type SponsorDef } from '../config/gameConfig.js';
import type { Database, Loft } from '../schema.js';
import { newId } from '../store.js';
import { talent } from './pigeon.js';

const BY_ID = new Map(SPONSORS.map((s) => [s.id, s]));

export function sponsorById(id: string | null | undefined): SponsorDef | undefined {
  return id ? BY_ID.get(id) : undefined;
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
  if (r.seasonPoints != null && loft.seasonPoints < r.seasonPoints) return false;
  if (r.gold != null && (loft.stats?.gold ?? 0) < r.gold) return false;
  if (r.bestTalent != null && bestTalent < r.bestTalent) return false;
  return true;
}

/** A short human description of what a sponsor requires to unlock. */
export function requirementLabel(def: SponsorDef): string {
  const r = def.req;
  const parts: string[] = [];
  if (r.level != null) parts.push(`niveau ${r.level}`);
  if (r.totalWins != null) parts.push(`${r.totalWins} overwinningen`);
  if (r.seasonPoints != null) parts.push(`${r.seasonPoints} seizoenspunten`);
  if (r.bestTalent != null) parts.push(`een duif met talent ${r.bestTalent}`);
  if (r.gold != null) parts.push(`${r.gold} gouden medailles`);
  if (parts.length === 0) return 'Meteen beschikbaar';
  return `Vereist: ${parts.join(' · ')}`;
}

function notify(db: Database, loft: Loft, title: string, body: string): void {
  db.notifications.push({
    id: newId('ntf'), userId: loft.userId, kind: 'info', title, body,
    flightId: null, createdAt: new Date().toISOString(), read: false,
  });
}

/**
 * Sign a sponsor as the loft's head sponsor. Pays the signing bonus the first
 * time this sponsor is ever signed. Returns a result message, or an error
 * string prefixed with '!'.
 */
export function applySignSponsor(db: Database, loft: Loft, sponsorId: string): string {
  const def = BY_ID.get(sponsorId);
  if (!def) return '!Onbekende sponsor';
  if (loft.sponsorId === sponsorId) return '!Dit is al je hoofdsponsor';
  const best = ownedBestTalent(db, loft.userId);
  if (!isSponsorUnlocked(loft, def, best)) return '!Je voldoet nog niet aan de voorwaarden van deze sponsor';

  loft.sponsorId = sponsorId;
  loft.sponsorSince = new Date().toISOString();
  const signed = loft.sponsorsSigned ?? (loft.sponsorsSigned = []);
  if (!signed.includes(sponsorId)) {
    signed.push(sponsorId);
    loft.money += def.signingBonus;
    notify(db, loft, `${def.icon} ${def.name} tekent bij jou`,
      `Welkomstpremie van €${def.signingBonus} ontvangen. Vanaf nu €${def.weeklyStipend}/week en €${def.winBonus} per overwinning.`);
    return `${def.name} is je nieuwe hoofdsponsor! Tekengeld: €${def.signingBonus}.`;
  }
  notify(db, loft, `${def.icon} ${def.name} opnieuw aan boord`,
    `Je tekent opnieuw bij een oude bekende — geen tekengeld, wel weer €${def.weeklyStipend}/week en €${def.winBonus} per overwinning.`);
  return `${def.name} is opnieuw je hoofdsponsor (geen nieuw tekengeld).`;
}

/** Drop the current head sponsor. Returns a result message or '!error'. */
export function applyCancelSponsor(db: Database, loft: Loft): string {
  const def = sponsorById(loft.sponsorId);
  if (!def) return '!Je hebt geen hoofdsponsor';
  loft.sponsorId = null;
  loft.sponsorSince = '';
  notify(db, loft, `🤝 Contract met ${def.name} beëindigd`,
    'Het sponsorcontract is stopgezet. Je kan later een nieuwe sponsor kiezen.');
  return `Contract met ${def.name} stopgezet.`;
}

/** DTO for the sponsor page: the active sponsor plus every offer with status. */
export function sponsorView(db: Database, loft: Loft) {
  const best = ownedBestTalent(db, loft.userId);
  const offers = SPONSORS.map((def) => ({
    id: def.id,
    name: def.name,
    icon: def.icon,
    tagline: def.tagline,
    tier: def.tier,
    signingBonus: def.signingBonus,
    weeklyStipend: def.weeklyStipend,
    winBonus: def.winBonus,
    requirement: requirementLabel(def),
    unlocked: isSponsorUnlocked(loft, def, best),
    active: loft.sponsorId === def.id,
    signedBefore: (loft.sponsorsSigned ?? []).includes(def.id),
  }));
  return {
    activeId: loft.sponsorId ?? null,
    sponsorSince: loft.sponsorSince || null,
    bestTalent: best,
    offers,
  };
}
