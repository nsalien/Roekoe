/**
 * Health system: disease, injury, recovery, contagion and mortality.
 *
 * Injuries are inflicted live by flights (see flight.ts). Everything else —
 * catching disease, recovering, dying of old age or an untreated ailment —
 * happens on the weekly tick via `runHealthWeek`, which mutates the world and
 * returns a list of events the engine turns into player notifications.
 *
 * The infirmary (ziekenboeg) is the treatment room: a bird resting there is
 * isolated (it can't infect the loft and can't be reinfected) and recovers
 * faster, especially with medicated feed and hired staff.
 */

import {
  DISEASES,
  HEALTH,
  INFIRMARY,
  INJURIES,
  type AilmentTemplate,
} from '../config/gameConfig.js';
import type { Ailment, Database, Loft, Pigeon } from '../schema.js';
import { ageMortality } from './pigeon.js';
import { clamp, pick, round1 } from './util.js';

export interface HealthEvent {
  pigeonId: string;
  ownerId: string;
  pigeonName: string;
  type: 'sick' | 'injured' | 'recovered' | 'died';
  title: string;
  body: string;
}

function makeAilment(kind: 'ziekte' | 'kwetsuur', t: AilmentTemplate, week: number): Ailment {
  return { kind, name: t.name, severity: t.severity, description: t.description, sinceWeek: week };
}

/** A fresh random injury (used by flights) or disease. */
export function randomInjury(week: number): Ailment {
  return makeAilment('kwetsuur', pick(INJURIES), week);
}
export function randomDisease(week: number): Ailment {
  return makeAilment('ziekte', pick(DISEASES), week);
}

/** Give a pigeon an ailment and apply its onset hit to condition. */
export function applyAilment(p: Pigeon, a: Ailment): void {
  p.ailment = a;
  const hit = HEALTH.onsetHealthHit[a.severity];
  p.health = round1(clamp(p.health - hit, 0, 100));
  p.form = round1(clamp(p.form - hit * 0.5, 0, 100));
}

/** Weekly recovery chance for an ailing bird given its care. */
export function recoveryChance(p: Pigeon, loft: Loft, covered: boolean): number {
  if (!p.ailment) return 0;
  const base = HEALTH.recoverInInfirmary[p.ailment.severity];
  if (!p.inInfirmary) return round1(clamp(base * HEALTH.recoverOutsideFactor, 0, HEALTH.recoverCap));
  let chance = base;
  if (loft.medicatedFood) chance += HEALTH.medicatedFoodBonus;
  if (covered) chance += p.ailment.kind === 'ziekte' ? HEALTH.doctorBonus : HEALTH.physioBonus;
  return round1(clamp(chance, 0, HEALTH.recoverCap));
}

/** Which infirmary birds a loft's staff can properly cover (by pigeon id). */
export function coveredInInfirmary(loft: Loft, pigeons: Pigeon[]): Set<string> {
  const bySeverity = (a: Pigeon, b: Pigeon) =>
    severityRank(b.ailment!.severity) - severityRank(a.ailment!.severity);
  const sick = pigeons
    .filter((p) => p.inInfirmary && p.ailment?.kind === 'ziekte')
    .sort(bySeverity)
    .slice(0, loft.doctors * INFIRMARY.birdsPerDoctor);
  const injured = pigeons
    .filter((p) => p.inInfirmary && p.ailment?.kind === 'kwetsuur')
    .sort(bySeverity)
    .slice(0, loft.physios * INFIRMARY.birdsPerPhysio);
  return new Set([...sick, ...injured].map((p) => p.id));
}

function severityRank(s: Ailment['severity']): number {
  return s === 'ernstig' ? 3 : s === 'matig' ? 2 : 1;
}

/** Total weekly infirmary running cost for a loft (staff + medicated feed). */
export function infirmaryWeeklyCost(loft: Loft, infirmaryBirds: number): number {
  const staff = loft.doctors * INFIRMARY.doctorSalary + loft.physios * INFIRMARY.physioSalary;
  const feed = loft.medicatedFood ? infirmaryBirds * INFIRMARY.medicatedFoodPerBird : 0;
  return staff + feed;
}

/**
 * Run one week of health for the whole world (mutates it). Returns the events
 * (illness, injury recovery, deaths) for the engine to notify players about.
 */
export function runHealthWeek(db: Database, week: number): HealthEvent[] {
  const events: HealthEvent[] = [];
  const dead = new Set<string>();

  for (const loft of db.lofts) {
    const birds = db.pigeons.filter((p) => p.ownerId === loft.userId && !p.retired);
    if (birds.length === 0) continue;

    // 1. Charge the infirmary's running costs.
    const infirmaryBirds = birds.filter((p) => p.inInfirmary).length;
    loft.money -= infirmaryWeeklyCost(loft, infirmaryBirds);

    // 2. Recovery for every ailing bird.
    const covered = coveredInInfirmary(loft, birds);
    for (const p of birds) {
      if (!p.ailment) continue;
      if (Math.random() < recoveryChance(p, loft, covered.has(p.id))) {
        const was = p.ailment;
        p.ailment = null;
        p.health = round1(clamp(p.health + 15, 0, 100));
        events.push({
          pigeonId: p.id, ownerId: p.ownerId, pigeonName: p.name, type: 'recovered',
          title: `💚 ${p.name} is hersteld`,
          body: `${p.name} is verlost van ${was.name.toLowerCase()}. Terug fit voor de strijd! Vergeet niet ze uit de ziekenboeg te halen.`,
        });
      }
    }

    // 3. Mortality: old age + an untreated ailment can be fatal.
    for (const p of birds) {
      if (dead.has(p.id)) continue;
      let pDeath = ageMortality(p, week);
      if (p.ailment) {
        const table = p.inInfirmary ? HEALTH.ailmentMortalityInfirmary : HEALTH.ailmentMortalityOutside;
        pDeath += table[p.ailment.severity];
      }
      if (pDeath > 0 && Math.random() < clamp(pDeath, 0, 0.95)) {
        dead.add(p.id);
        const cause = p.ailment
          ? `bezweken aan ${p.ailment.name.toLowerCase()}`
          : 'op hoge leeftijd vredig ingeslapen';
        const years = Math.floor(Math.max(0, week - p.birthWeek) / 52);
        events.push({
          pigeonId: p.id, ownerId: p.ownerId, pigeonName: p.name, type: 'died',
          title: `🕯️ ${p.name} is niet meer`,
          body: `${p.name} (${years} jaar) is ${cause}. Het duivenhok neemt een moment stilte in acht.`,
        });
      }
    }

    // 4. Contagion + spontaneous illness among the survivors.
    const alive = birds.filter((p) => !dead.has(p.id));
    const sources = alive.filter((p) => p.ailment?.kind === 'ziekte' && !p.inInfirmary).length;
    for (const p of alive) {
      if (p.ailment || p.inInfirmary) continue; // already ailing, or safely isolated
      // Low energie (form) makes a bird more susceptible; being fit protects it.
      const energyRisk = clamp(1.3 - p.form / 100, 0.3, 1.3);
      const perSource = HEALTH.contagionPerSource * clamp(1.2 - p.health / 100, 0.1, 1.2) * energyRisk;
      const fromOthers = sources > 0 ? 1 - Math.pow(1 - perSource, sources) : 0;
      const spontaneous = HEALTH.spontaneousIllness * clamp(1 - p.health / 100, 0, 1) * energyRisk;
      const chance = clamp(1 - (1 - fromOthers) * (1 - spontaneous), 0, 0.85);
      if (Math.random() < chance) {
        const disease = randomDisease(week);
        applyAilment(p, disease);
        events.push({
          pigeonId: p.id, ownerId: p.ownerId, pigeonName: p.name, type: 'sick',
          title: `🤒 ${p.name} is ziek geworden`,
          body: `Diagnose: ${disease.name} (${disease.severity}). ${disease.description} Zet ze in de ziekenboeg om besmetting te voorkomen.`,
        });
      }
    }
  }

  if (dead.size > 0) {
    db.pigeons = db.pigeons.filter((p) => !dead.has(p.id));
    db.breedingPairs = db.breedingPairs.filter((bp) => !dead.has(bp.sireId) && !dead.has(bp.damId));
  }
  return events;
}
