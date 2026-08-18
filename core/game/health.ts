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
  diseaseSeverityWeights,
  injurySeverityWeights,
  AGING,
  COMPARTMENT,
  DISEASES,
  HEALING,
  HEALTH,
  ILLNESS,
  INFIRMARY,
  INJURIES,
  type AilmentTemplate,
} from '../config/gameConfig.js';
import type { Ailment, Database, Loft, Pigeon } from '../schema.js';
import { newId } from '../store.js';
import { ageInWeeks, ageMortality, conditionScore, isAway, noteAttrChange } from './pigeon.js';
import { awardBadge, evaluateBadges } from './badges.js';
import { clamp, pick, pickWith, round1 } from './util.js';

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

/** Injuries you can only get by wearing the bird out (see AilmentTemplate.cause). */
const STRAIN_INJURIES = INJURIES.filter((i) => i.cause !== 'pech');
/** Injuries that are plain bad luck — a hawk, a collision. */
const LUCK_INJURIES = INJURIES.filter((i) => i.cause === 'pech');

/**
 * A BAD-LUCK injury: a sperwer, a collision. Drawn UNIFORMLY from its own pool,
 * because luck does not care how well the bird is kept — this is exactly why a
 * perfectly managed loft can still lose a bird to a hawk. Pass a seeded `rng` to
 * keep a re-run deterministic.
 */
export function randomLuckInjury(week: number, rng?: () => number): Ailment {
  const pool = LUCK_INJURIES.length > 0 ? LUCK_INJURIES : INJURIES;
  return makeAilment('kwetsuur', rng ? pickWith(rng, pool) : pick(pool), week);
}

/**
 * A STRAIN injury: the effort broke the bird down. HOW BAD it is follows the bird's
 * vluchtvorm — a bird in good shape strains a muscle, a spent one breaks a wing
 * (see INJURY_SEVERITY). Mirrors randomDisease, including spreading a severity's
 * weight over the injuries carrying it so adding one never shifts the mix.
 */
export function randomStrainInjury(week: number, form: number, rng: () => number = Math.random): Ailment {
  const pool = STRAIN_INJURIES.length > 0 ? STRAIN_INJURIES : INJURIES;
  const weights = injurySeverityWeights(form);
  const weighted = pool.map((t) => ({
    t,
    w: weights[t.severity] / Math.max(1, pool.filter((x) => x.severity === t.severity).length),
  }));
  let r = rng() * weighted.reduce((sum, x) => sum + x.w, 0);
  for (const x of weighted) {
    if ((r -= x.w) <= 0) return makeAilment('kwetsuur', x.t, week);
  }
  return makeAilment('kwetsuur', pool[pool.length - 1], week);
}

/** Legacy entry point (kept for the admin week-runner): a uniform random injury. */
export function randomInjury(week: number, rng?: () => number): Ailment {
  return makeAilment('kwetsuur', rng ? pickWith(rng, INJURIES) : pick(INJURIES), week);
}
/**
 * A disease to strike a bird with. Pass the bird's CONDITIE-SCORE (energie +
 * gezondheid, see pigeon.conditionScore) to weight HOW BAD it is: a bird in good
 * shape mostly picks up something light, a run-down one is the one that catches
 * something serious (see DISEASE_SEVERITY). Without a score the mix is the mildest.
 */
export function randomDisease(week: number, condition = 100): Ailment {
  const weights = diseaseSeverityWeights(condition);
  // Split the weight of a severity evenly over the diseases that carry it, so
  // adding a disease to the catalogue never silently shifts the severity mix.
  const pool = DISEASES.map((d) => ({
    d,
    w: weights[d.severity] / Math.max(1, DISEASES.filter((x) => x.severity === d.severity).length),
  }));
  let r = Math.random() * pool.reduce((s, x) => s + x.w, 0);
  for (const x of pool) {
    if ((r -= x.w) <= 0) return makeAilment('ziekte', x.d, week);
  }
  return makeAilment('ziekte', pick(DISEASES), week);
}

/** A random ailment of a given kind + severity (deterministic with a seeded rng). */
export function randomAilmentOfSeverity(
  kind: 'ziekte' | 'kwetsuur',
  severity: AilmentTemplate['severity'],
  week: number,
  rng?: () => number,
): Ailment {
  const pool = (kind === 'ziekte' ? DISEASES : INJURIES).filter((t) => t.severity === severity);
  const list = pool.length > 0 ? pool : kind === 'ziekte' ? DISEASES : INJURIES;
  return makeAilment(kind, rng ? pickWith(rng, list) : pick(list), week);
}

/** Give a pigeon an ailment and apply its onset hit to condition. */
export function applyAilment(p: Pigeon, a: Ailment): void {
  p.ailment = a;
  p.everAiled = true;
  const hit = HEALTH.onsetHealthHit[a.severity];
  p.health = round1(clamp(p.health - hit, 0, 100));
  p.form = round1(clamp(p.form - hit * 0.5, 0, 100));
}

const HOUR_MS = 3600000;

/** How fast a bird's ailment heals right now, as a multiple of the base rate. */
function healSpeed(p: Pigeon, loft: Loft, covered: boolean): number {
  let speed = 1;
  if (p.inInfirmary) {
    speed *= HEALING.infirmarySpeed; // rest + isolation
    if (loft.medicatedFood) speed *= HEALING.medicatedSpeed;
    if (covered) speed *= p.ailment!.kind === 'ziekte' ? HEALING.doctorSpeed : HEALING.physioSpeed;
  }
  return speed;
}

/** A stable-id, idempotent health notification (safe under concurrent ticks). */
function healNote(db: Database, userId: string, id: string, title: string, body: string): void {
  const existing = db.notifications.find((n) => n.id === id);
  const note = { id, userId, kind: 'health' as const, title, body, flightId: null, createdAt: new Date().toISOString(), read: existing?.read ?? false };
  if (existing) Object.assign(existing, note);
  else db.notifications.push(note);
}

function etaLabel(hours: number): string {
  if (hours < 1) return 'minder dan een uur';
  if (hours < 24) return `~${Math.round(hours)} uur`;
  return `~${Math.round((hours / 24) * 10) / 10} dagen`;
}

/**
 * Advance every ailing bird's recovery in REAL time (called each request). The
 * infirmary, a covering doctor/physio and medicated feed speed it up, so a
 * player sees their care matter. Every `updateHours` a status update is emitted
 * from the doctor's/physio's perspective, with progress + an ETA to
 * flight-ready; when progress completes the bird heals.
 */
export function tickHealing(db: Database, nowMs: number): void {
  const humanIds = new Set(db.lofts.filter((l) => !l.isBot).map((l) => l.userId));
  for (const loft of db.lofts) {
    const birds = db.pigeons.filter((p) => p.ownerId === loft.userId);
    const ailing = birds.filter((p) => p.ailment);
    if (ailing.length === 0) continue;
    const covered = coveredInInfirmary(loft, birds);
    const human = humanIds.has(loft.userId);

    for (const p of ailing) {
      const a = p.ailment!;
      // First time we see this ailment: start its clocks (no progress yet).
      if (a.lastTickMs == null) {
        a.lastTickMs = nowMs;
        a.lastUpdateMs = nowMs;
        a.healed = a.healed ?? 0;
        continue;
      }
      const elapsedH = (nowMs - a.lastTickMs) / HOUR_MS;
      // Advance the healing clock in quarter-hour steps. Touching `healed` and
      // `lastTickMs` on every request rewrote a pigeon row per ailing bird per
      // poll — the biggest consumer of D1's 100k rows/day write budget. Skipping
      // a tick loses no progress: `lastTickMs` stays put, so the next one picks
      // up the whole elapsed span.
      if (elapsedH < HEALING.tickMinutes / 60) continue;
      a.lastTickMs = nowMs;

      const speed = healSpeed(p, loft, covered.has(p.id));
      const base = HEALING.baseHoursOutside[a.severity];
      a.healed = clamp((a.healed ?? 0) + (elapsedH * speed) / base, 0, 1);

      if (a.healed >= 1) {
        const was = a;
        p.ailment = null;
        p.health = round1(clamp(p.health + HEALING.healthOnRecover, 0, 100));
        loft.stats.cures += 1;
        if (was.severity === 'ernstig') loft.stats.curesSevere += 1;
        awardBadge(db, loft, 'cure_1');
        if (was.severity === 'ernstig') awardBadge(db, loft, 'cure_severe');
        if (human) {
          healNote(
            db, loft.userId, `ntf:healed:${p.id}:${was.sinceWeek}:${was.name}`,
            `💚 ${p.name} is volledig hersteld!`,
            `${was.kind === 'kwetsuur' ? 'De kinesist' : 'De dokter'} geeft ${p.name} weer vliegensklaar — verlost van ${was.name.toLowerCase()}. Haal ze uit de ziekenboeg om weer mee te doen.`,
          );
        }
        evaluateBadges(db, loft);
        continue;
      }

      // Periodic status update from the caregiver's perspective.
      if (human && nowMs >= (a.lastUpdateMs ?? nowMs) + HEALING.updateHours * HOUR_MS) {
        a.updates = (a.updates ?? 0) + 1;
        a.lastUpdateMs = nowMs;
        const pct = Math.round(a.healed * 100);
        const remH = ((1 - a.healed) * base) / speed;
        const who = a.kind === 'kwetsuur' ? 'De kinesist' : 'De dokter';
        let advice: string;
        if (!p.inInfirmary) advice = `Buiten de ziekenboeg gaat het traag — zet ${p.name} in de ziekenboeg voor sneller herstel.`;
        else if (!covered.has(p.id)) advice = a.kind === 'ziekte' ? 'Met een dokter erbij zou het sneller gaan.' : 'Met een kinesist erbij zou het sneller gaan.';
        else if (!loft.medicatedFood) advice = 'Zet medicatievoer aan om het herstel te versnellen.';
        else advice = 'De isolatie, zorg en medicatie werpen duidelijk vruchten af.';
        healNote(
          db, loft.userId, `ntf:heal:${p.id}:${a.updates}`,
          `${a.kind === 'kwetsuur' ? '🧑‍⚕️' : '🩺'} Herstel van ${p.name}: ${pct}%`,
          `${who} over ${p.name} (${a.name}): ${pct}% hersteld, nog ${etaLabel(remH)} tot vliegensklaar. ${advice}`,
        );
      }
    }
  }
}

/** Convert a per-week probability to the equivalent per-day probability. */
function weeklyToDaily(pWeek: number): number {
  return 1 - Math.pow(1 - clamp(pWeek, 0, 1), 1 / 7);
}

/** Push a unique (non-idempotent) health notification for a one-off event. */
function pushHealthNote(db: Database, userId: string, title: string, body: string): void {
  db.notifications.push({
    id: newId(), userId, kind: 'health', title, body,
    flightId: null, createdAt: new Date().toISOString(), read: false,
  });
}

/**
 * One real-time DAY of health for the whole world (called once per elapsed day
 * from the daily tick — see schedule.tickDailyCare). Unlike the legacy weekly
 * pass, this actually runs during normal play, so birds genuinely fall ill,
 * ailments keep sapping health, and an untreated ailment can turn fatal.
 * (Old-age mortality is applied per game-week in runAgeMortality.)
 */
export function runHealthDay(db: Database, week: number): void {
  const humanIds = new Set(db.lofts.filter((l) => !l.isBot).map((l) => l.userId));
  const dead = new Set<string>();

  for (const loft of db.lofts) {
    const birds = db.pigeons.filter((p) => p.ownerId === loft.userId);
    if (birds.length === 0) continue;
    const human = humanIds.has(loft.userId);

    // 1. An ongoing ailment keeps draining health (worse when left untreated).
    for (const p of birds) {
      if (!p.ailment) continue;
      let drain = HEALTH.ailmentHealthDrainPerDay[p.ailment.severity];
      if (!p.inInfirmary) drain *= HEALTH.ailmentDrainOutsideFactor;
      p.health = round1(clamp(p.health - drain, 0, 100));
    }

    // 2. Mortality: an untreated severe/moderate ailment can be fatal. (Old-age
    //    mortality is handled per game-week in runAgeMortality, so it stays true
    //    to the per-week curve regardless of how fast pigeons age.)
    for (const p of birds) {
      if (dead.has(p.id) || !p.ailment) continue;
      const table = p.inInfirmary ? HEALTH.ailmentMortalityInfirmary : HEALTH.ailmentMortalityOutside;
      const pDeath = weeklyToDaily(table[p.ailment.severity]);
      if (pDeath > 0 && Math.random() < pDeath) {
        dead.add(p.id);
        if (p.ailment.name === 'Sperwerverwonding') awardBadge(db, loft, 'rip_sperwer');
        if (human) {
          pushHealthNote(
            db, loft.userId, `🕯️ ${p.name} is niet meer`,
            `${p.name} is bezweken aan ${p.ailment.name.toLowerCase()}. Een aandoening onbehandeld laten is gevaarlijk — de ziekenboeg en verzorging verkleinen dat risico sterk.`,
          );
        }
      }
    }

    // 3. Contagion + spontaneous illness among the survivors. A bird that lost its
    //    way on a flight is not in the loft: it can neither infect nor be infected.
    const alive = birds.filter((p) => !dead.has(p.id) && !isAway(p));
    const sources = alive.filter((p) => p.ailment?.kind === 'ziekte' && !p.inInfirmary).length;
    for (const p of alive) {
      if (p.ailment || p.inInfirmary) continue; // already ailing, or safely isolated
      // Falling ill runs on the SAME conditie-score as a strain injury does (energie
      // + gezondheid, lower of the two counting double), so "how well am I keeping
      // this bird" answers both questions at once. The floor means a bird in perfect
      // shape still carries a small weekly risk — no loft is sterile.
      const condition = conditionScore(p);
      const frailty = Math.pow(clamp((100 - condition) / 100, 0, 1), ILLNESS.curve);
      const spontaneous = weeklyToDaily(ILLNESS.floor + ILLNESS.max * frailty);
      // Contagion rides on the same frailty, but never drops to nothing: a fit bird
      // sharing a loft with a sick one can still catch it.
      const susceptibility = ILLNESS.contagionFloor + (1 - ILLNESS.contagionFloor) * frailty;
      const perSource = weeklyToDaily(HEALTH.contagionPerSource) * susceptibility;
      const fromOthers = sources > 0 ? 1 - Math.pow(1 - perSource, sources) : 0;
      const compartmentGuard = p.compartment ? 1 - COMPARTMENT.diseaseReduction : 1;
      const chance = clamp(1 - (1 - fromOthers) * (1 - spontaneous), 0, 0.85) * compartmentGuard;
      if (Math.random() < chance) {
        const disease = randomDisease(week, condition);
        applyAilment(p, disease);
        if (human) {
          pushHealthNote(
            db, loft.userId, `🤒 ${p.name} is ziek geworden`,
            `Diagnose: ${disease.name} (${disease.severity}). ${disease.description} Zet ze meteen in de ziekenboeg om besmetting te voorkomen en het herstel te versnellen.`,
          );
        }
      }
    }
  }

  if (dead.size > 0) {
    db.pigeons = db.pigeons.filter((p) => !dead.has(p.id));
    db.breedingPairs = db.breedingPairs.filter((bp) => !dead.has(bp.sireId) && !dead.has(bp.damId));
    for (const f of db.flights) {
      if (f.status !== 'completed') f.entries = f.entries.filter((e) => !dead.has(e.pigeonId));
    }
  }
}

/**
 * One game-week of OLD-AGE mortality (called once per week the age counter rolls
 * — see schedule.tickDailyCare). Kept on the game-week cadence, with the raw
 * per-week probability, so the mortality curve stays faithful no matter how fast
 * pigeons age in real time. Young/prime birds are practically never taken here.
 */
export function runAgeMortality(db: Database, week: number): void {
  const humanIds = new Set(db.lofts.filter((l) => !l.isBot).map((l) => l.userId));
  const dead = new Set<string>();
  for (const loft of db.lofts) {
    for (const p of db.pigeons) {
      if (p.ownerId !== loft.userId || dead.has(p.id)) continue;
      const pDeath = ageMortality(p, week);
      if (pDeath > 0 && Math.random() < clamp(pDeath, 0, 0.95)) {
        dead.add(p.id);
        awardBadge(db, loft, 'vredig');
        if (humanIds.has(loft.userId)) {
          const years = Math.floor(ageInWeeks(p, week) / 52);
          pushHealthNote(
            db, loft.userId, `🕯️ ${p.name} is niet meer`,
            `${p.name} (${years} jaar) is op hoge leeftijd vredig ingeslapen. Het duivenhok neemt een moment stilte in acht.`,
          );
        }
      }
    }
  }
  if (dead.size > 0) {
    db.pigeons = db.pigeons.filter((p) => !dead.has(p.id));
    db.breedingPairs = db.breedingPairs.filter((bp) => !dead.has(bp.sireId) && !dead.has(bp.damId));
    for (const f of db.flights) {
      if (f.status !== 'completed') f.entries = f.entries.filter((e) => !dead.has(e.pigeonId));
    }
  }
}

/**
 * Real-time AGEING of the racing skills. Once a bird is past its prime
 * (AGING.peakEndWeeks, ~4 game-years) its snelheid/conditie/oriëntatie decline a
 * little every rolled game-week, faster the older it gets — and at a pace unique
 * to the bird (its `declineRate` gene, so some fade sooner than others). Runs once
 * per rolled game-week alongside runAgeMortality. Skills never drop below AGING.floor.
 */
export function runAgeDecline(db: Database, week: number): void {
  for (const p of db.pigeons) {
    const age = week - p.birthWeek;
    if (age <= AGING.peakEndWeeks) continue;
    const dec = AGING.declinePerWeekBase * ((age - AGING.peakEndWeeks) / 52) * (p.declineRate ?? 1);
    if (dec <= 0) continue;
    for (const attr of ['speed', 'endurance', 'orientation'] as const) {
      const before = p[attr];
      p[attr] = round1(Math.max(AGING.floor, p[attr] - dec));
      noteAttrChange(p, attr, before, 'veroudering');
    }
  }
}

/** Which infirmary birds a loft's staff can properly cover (by pigeon id). */
export function coveredInInfirmary(loft: Loft, pigeons: Pigeon[]): Set<string> {
  const bySeverity = (a: Pigeon, b: Pigeon) =>
    severityRank(b.ailment!.severity) - severityRank(a.ailment!.severity);
  // Birds the owner pinned themselves take the slots first (see Pigeon.careAssigned);
  // whatever is left over is filled the old way, worst case first. So a loft that
  // never touches the new control behaves exactly as before.
  const pick = (kind: Ailment['kind'], slots: number) => {
    const patients = pigeons.filter((p) => p.inInfirmary && p.ailment?.kind === kind);
    const chosen = patients.filter((p) => p.careAssigned).sort(bySeverity).slice(0, slots);
    const rest = patients.filter((p) => !p.careAssigned).sort(bySeverity);
    return [...chosen, ...rest.slice(0, Math.max(0, slots - chosen.length))];
  };
  return new Set(
    [
      ...pick('ziekte', loft.doctors * INFIRMARY.birdsPerDoctor),
      ...pick('kwetsuur', loft.physios * INFIRMARY.birdsPerPhysio),
    ].map((p) => p.id),
  );
}

/**
 * How many staff slots a loft has for one kind of ailment, and how many of them
 * the owner has already pinned. Drives both the guard in `setCareAssignment` and
 * the counters shown on the Ziekenboeg page.
 */
export function careSlots(
  loft: Loft,
  pigeons: Pigeon[],
  kind: Ailment['kind'],
): { slots: number; assigned: number; patients: number } {
  const patients = pigeons.filter((p) => p.inInfirmary && p.ailment?.kind === kind);
  return {
    slots: kind === 'ziekte'
      ? loft.doctors * INFIRMARY.birdsPerDoctor
      : loft.physios * INFIRMARY.birdsPerPhysio,
    assigned: patients.filter((p) => p.careAssigned).length,
    patients: patients.length,
  };
}

function severityRank(s: Ailment['severity']): number {
  return s === 'ernstig' ? 3 : s === 'matig' ? 2 : 1;
}

/**
 * Run one week of health for the whole world (mutates it). Returns the events
 * (illness, injury recovery, deaths) for the engine to notify players about.
 * (Infirmary running costs are charged daily now — see schedule.tickDailyCare.)
 */
export function runHealthWeek(db: Database, week: number): HealthEvent[] {
  const events: HealthEvent[] = [];
  const dead = new Set<string>();

  for (const loft of db.lofts) {
    const birds = db.pigeons.filter((p) => p.ownerId === loft.userId);
    if (birds.length === 0) continue;

    // (Recovery from illness/injury now runs in REAL time — see tickHealing.)

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
        if (p.ailment?.name === 'Sperwerverwonding') awardBadge(db, loft, 'rip_sperwer');
        else if (!p.ailment) awardBadge(db, loft, 'vredig');
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
      const frailty = clamp(1 - p.health / 100, HEALTH.illnessBaselineRisk, 1);
      const spontaneous = HEALTH.spontaneousIllness * frailty * energyRisk;
      // A private compartment keeps this bird apart, cutting its onset chance.
      const compartmentGuard = p.compartment ? 1 - COMPARTMENT.diseaseReduction : 1;
      const chance = clamp(1 - (1 - fromOthers) * (1 - spontaneous), 0, 0.85) * compartmentGuard;
      if (Math.random() < chance) {
        const disease = randomDisease(week, p.health);
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
