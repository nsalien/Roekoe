/**
 * SEIZOEN 3 — de aankondiging (seizoen3.md §5).
 *
 * Twee belmeldingen per echte speler, verstuurd door migratie v56 (schedule.ts),
 * dus precies één keer per wereld, met een stabiele id per speler:
 *   - de welkomstmelding: wat seizoen 3 voor DEZE speler betekent (kenmerken in
 *     zijn hok, wat zijn coaches nu kosten, zijn sponsors);
 *   - de coachmelding: per gecoachte duif het nieuwe dagtarief, met het oude
 *     totaal ernaast.
 * De actiemelding voor wie te veel sponsors heeft, komt al uit v54.
 *
 * Pure tekstbouwers: geen rng, geen tijd behalve het meegegeven `nowMs`, zodat
 * twee gelijktijdige verzoeken exact dezelfde tekst schrijven.
 */

import { COACH, SPONSOR_MAX_ACTIVE, coachSalaryFor } from '../config/gameConfig.js';
import type { Database, Loft, Pigeon } from '../schema.js';
import { coachBill, freeCoachCount, newcomerActive } from './newcomer.js';
import { talent } from './pigeon.js';

/** €1.234 — Belgian thousands separator, no decimals. */
export const euro = (n: number) => `€${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

/** What this loft's coaches cost per day, now and under the old flat rate. */
export function coachCostNowAndBefore(loft: Loft, coached: Pigeon[], nowMs: number) {
  const bill = coachBill(loft, coached, nowMs);
  const before = Math.max(0, coached.length - freeCoachCount(loft, nowMs)) * COACH.dailySalary;
  return { now: bill.total, before, perPigeon: bill.perPigeon };
}

const loftBirds = (db: Database, loft: Loft) => db.pigeons.filter((p) => p.ownerId === loft.userId);
/** A loft in the red has no coaches (they were let go), whatever the flags say. */
const coachedBirds = (loft: Loft, birds: Pigeon[]) => (loft.money < 0 ? [] : birds.filter((p) => p.coached));

/** The welkomstmelding (seizoen3.md §5.3). */
export function season3Welcome(db: Database, loft: Loft, nowMs: number): { title: string; body: string } {
  const birds = loftBirds(db, loft);
  const n = birds.filter((p) => p.trait).length;
  const coached = coachedBirds(loft, birds);
  const sponsors = loft.sponsorship?.active?.length ?? 0;
  const lines: string[] = [
    'Jullie stemden in De Stem, en het winnende idee vliegt nu mee: kenmerken.',
    'Voor jou betekent seizoen 3:',
  ];
  lines.push(n > 0
    ? `• ✨ ${n === 1 ? 'Eén van je duiven kreeg' : `${n} van je duiven kregen`} een kenmerk — kijk in je hok wanneer ze in hun element ${n === 1 ? 'is' : 'zijn'}.`
    : '• ✨ Geen van je duiven kreeg een kenmerk — jongen uit je kweek of een aankoop kunnen er wel een hebben.');
  if (coached.length > 0) {
    const c = coachCostNowAndBefore(loft, coached, nowMs);
    lines.push(`• 🎓 Je coaches kosten nu samen ${euro(c.now)} per dag (was ${euro(c.before)}) — de prijs hangt af van hoe goed de duif is. Zie de coachmelding.`);
  }
  if (sponsors > 0 && sponsors <= SPONSOR_MAX_ACTIVE) {
    lines.push(`• 🤝 Je hebt ${sponsors} ${sponsors === 1 ? 'sponsor' : 'sponsors'} — het maximum is nu ${SPONSOR_MAX_ACTIVE}.`);
  }
  lines.push('• ⚡ Vliegen vraagt meer: meer energie en gezondheid per vlucht, dus rust wordt belangrijker.');
  lines.push('Alles op een rij: Wiki → Nieuw in seizoen 3.');
  return { title: '🎉 Seizoen 3 is begonnen!', body: lines.join('\n') };
}

/** The coachmelding (seizoen3.md §5.3), with or without coached birds. */
export function season3CoachNote(db: Database, loft: Loft, nowMs: number): { title: string; body: string } {
  const birds = loftBirds(db, loft);
  const coached = coachedBirds(loft, birds);
  if (coached.length === 0) {
    const best = [...birds].sort((a, b) => talent(b) - talent(a) || a.id.localeCompare(b.id))[0];
    const min = COACH.salaryBands[0].salary;
    const max = COACH.salaryBands[COACH.salaryBands.length - 1].salary;
    const bestLine = best
      ? ` Voor jouw beste duif, ${best.name} (score ${talent(best)}), zou een coach ${euro(coachSalaryFor(talent(best)))} per dag kosten.`
      : '';
    return {
      title: '🎓 De privécoach heeft nieuwe tarieven',
      body: `Vanaf seizoen 3 hangt de prijs van een coach af van de algemene score van je duif, van ${euro(min)} tot ${euro(max)} per dag.${bestLine} Alle tarieven: Wiki → De privécoach.`,
    };
  }
  const c = coachCostNowAndBefore(loft, coached, nowMs);
  const byId = new Map(coached.map((p) => [p.id, p]));
  const rows = c.perPigeon.map((r) => ({ ...r, p: byId.get(r.pigeonId)! }));
  const SHOW = 6;
  const lines = ['Vanaf seizoen 3 hangt de prijs van een coach af van de algemene score van je duif.'];
  for (const r of rows.slice(0, SHOW)) {
    lines.push(`• ${r.p.name} (score ${talent(r.p)}) — ${euro(r.salary)} per dag${r.free ? ' (gratis)' : ''}`);
  }
  if (rows.length > SHOW) {
    const rest = rows.slice(SHOW);
    lines.push(`• + ${rest.length} andere: ${euro(rest.reduce((s, r) => s + (r.free ? 0 : r.salary), 0))} per dag`);
  }
  lines.push(`Samen: ${euro(c.now)} per dag (was ${euro(c.before)}) · ≈ ${euro(c.now * 7)} per week.`);
  const free = rows.find((r) => r.free);
  if (free && newcomerActive(loft, nowMs)) {
    lines.push(`🎁 Je gratis starterscoach dekt je duurste duif: ${free.p.name} kost je niets.`);
  }
  lines.push('Het tarief wordt elke dag opnieuw bepaald: stijgt een duif over een grens, dan betaal je vanaf de volgende dag het hogere tarief. Alle tarieven: Wiki → De privécoach.');
  return { title: '🎓 Wat je coaches voortaan kosten', body: lines.join('\n') };
}
