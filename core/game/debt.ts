/**
 * SCHULD — wat er gebeurt wanneer de kassa van een hok onder nul zakt.
 *
 * Vaste onkosten worden élke dag afgerekend, of de speler nu inlogt of niet
 * (zie economy.dailyRunningCost), dus een kassa kan vanzelf negatief gaan. Tot
 * nu toe was dat een doodlopende straat: élke aankoop viel stil op de bestaande
 * `money < kost`-controle zonder uitleg, de coach bleef €80/dag doorrekenen, en
 * niets dwong ooit een verkoop af. Nu is het een traject met drie trappen, alle
 * drie gedreven vanuit de dagtick (zie DEBT in gameConfig):
 *
 *   1. meteen        — alle coaches ontslagen + niets meer te koop tot de kassa
 *                      weer op nul of hoger staat;
 *   2. na 10 dagen   — de slechtste duif gaat onder de hamer (geveild, nooit
 *                      rechtstreeks verkocht: de club zet de prijs);
 *   3. elke 10 dagen — de volgende erachteraan, tot de kassa weer klopt.
 *
 * ⚠️ De gedwongen veiling is BEWUST een veiling en geen verkoop tegen
 * marktwaarde aan het spel zelf. Rechtstreeks verkopen zou geld uit het niets
 * creëren; nu komt het geld van een andere speler en blijft de geldhoeveelheid
 * in de club kloppen.
 */

import type { Database, Loft, Pigeon } from '../schema.js';
import { DEBT } from '../config/gameConfig.js';
import { inDebt } from './economy.js';
import { isAway, talent } from './pigeon.js';
import { pigeonCommittedToFlight } from './flight.js';
import { createForcedAuction } from './auction.js';

/** €-bedrag dat ook negatief netjes leest: -€500 in plaats van €-500. */
function euro(amount: number): string {
  const n = Math.round(amount);
  return n < 0 ? `-€${Math.abs(n)}` : `€${n}`;
}

/** Melding met stabiele id (idempotent bij gelijktijdige verwerking). */
function notify(db: Database, userId: string, title: string, body: string, id: string): void {
  const existing = db.notifications.find((n) => n.id === id);
  const note = {
    id, userId, kind: 'info' as const, title, body,
    flightId: null, createdAt: new Date().toISOString(), read: existing?.read ?? false,
  };
  if (existing) Object.assign(existing, note);
  else db.notifications.push(note);
}

/**
 * De duif die als eerste onder de hamer gaat: de SLECHTSTE op talent (het
 * gemiddelde van snelheid, conditie en oriëntatie).
 *
 * Overgeslagen worden duiven die het hok niet kúnnen verlaten — ingeschreven of
 * onderweg op een vlucht, aan het koppelen, of de weg kwijt — precies dezelfde
 * afbakening als `pigeonBusy` in engine.ts, en een duif die al op een veiling
 * staat. Zit er zo geen enkele kandidaat tussen, dan gaat deze ronde niet door
 * en telt ze ook niet als gemiste veiling: er is niets misgelopen.
 */
export function worstAuctionable(db: Database, loft: Loft): Pigeon | null {
  const owned = db.pigeons.filter((p) => p.ownerId === loft.userId);
  if (owned.length <= DEBT.keepPigeons) return null; // de laatste duif blijft altijd
  const onAuction = new Set(
    db.auctions.filter((a) => a.status === 'open').map((a) => a.pigeonId),
  );
  const free = owned.filter(
    (p) =>
      !onAuction.has(p.id) &&
      !isAway(p) &&
      !pigeonCommittedToFlight(db, p.id) &&
      !db.breedingPairs.some((bp) => bp.sireId === p.id || bp.damId === p.id),
  );
  if (!free.length) return null;
  // Stabiel bij gelijk talent: sorteer op id, zodat twee gelijktijdige verzoeken
  // dezelfde duif kiezen en de stabiele veiling-id dus over dezelfde duif gaat.
  return free.sort((a, b) => talent(a) - talent(b) || (a.id < b.id ? -1 : 1))[0];
}

/**
 * Eén dag schuldafhandeling voor één hok. Draait vanuit `tickDailyCare`, ná de
 * dagelijkse afrekening, dus precies één keer per hok per dag.
 *
 * `dayNumber` is de lokale dagteller en zit in élke stabiele melding- en
 * veiling-id: twee gelijktijdige verzoeken die dezelfde dag afsluiten landen zo
 * op dezelfde rijen in plaats van een tweede veiling te openen.
 */
export function tickLoftDebt(db: Database, loft: Loft, nowMs: number, dayNumber: number): void {
  if (loft.isBot) return; // bots hebben hun eigen kasvloer (BOT.reserve) en lezen geen meldingen
  if (!inDebt(loft)) {
    // Weer uit het rood: de teller én de afslag gaan terug op nul.
    if (loft.debtDays) {
      loft.debtDays = 0;
      loft.debtMisses = 0;
      notify(
        db, loft.userId, '✅ Je kassa staat weer op groen',
        'Je saldo is niet langer negatief. Je kan weer aankopen doen, en er worden geen duiven meer gedwongen geveild.',
        `ntf:debt:clear:${loft.userId}:${dayNumber}`,
      );
    }
    loft.debtMisses = 0;
    return;
  }

  const days = (loft.debtDays ?? 0) + 1;
  loft.debtDays = days;

  if (days === 1) {
    // Eerste dag in het rood: de coaches eruit. Dat is de grootste terugkerende
    // kost die een speler kan afwerpen (€80/dag per gecoachte duif), dus het is
    // ook de ingreep die hem het snelst weer uit het rood helpt.
    const coached = db.pigeons.filter((p) => p.ownerId === loft.userId && p.coached);
    for (const p of coached) p.coached = false;
    const coachLine = coached.length
      ? ` Je ${coached.length === 1 ? 'privécoach is' : `${coached.length} privécoaches zijn`} meteen ontslagen — die kost je €80 per dag per duif.`
      : '';
    notify(
      db, loft.userId, '🔴 Je kassa staat negatief',
      `Je saldo is ${euro(loft.money)}.${coachLine} Zolang je in het rood staat kan je niets kopen. ` +
        `Raak je er binnen ${DEBT.graceDays} dagen niet uit, dan gaat je slechtste duif verplicht onder de hamer — en daarna elke ${DEBT.graceDays} dagen de volgende. Verkoop een duif of voer om dat te vermijden.`,
      `ntf:debt:start:${loft.userId}:${dayNumber}`,
    );
    return;
  }

  // Elke `graceDays` dagen in het rood: de volgende duif onder de hamer.
  if (days % DEBT.graceDays !== 0) return;

  const bird = worstAuctionable(db, loft);
  if (!bird) {
    // Niets te veilen (alles bezet, of de laatste duif). Geen gemiste veiling —
    // er is geen bod uitgebleven, er is gewoon niets aangeboden.
    notify(
      db, loft.userId, '🔴 Nog altijd in het rood',
      `Je staat ${days} dagen negatief (${euro(loft.money)}), maar er is geen duif die geveild kan worden — ` +
        'ze zijn ingeschreven voor een vlucht, aan het koppelen, of je hebt er nog maar één. Je laatste duif wordt nooit geveild.',
      `ntf:debt:nobird:${loft.userId}:${dayNumber}`,
    );
    return;
  }
  createForcedAuction(db, loft, bird, nowMs, dayNumber);
}
