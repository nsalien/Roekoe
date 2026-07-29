/**
 * Event/dilemma cards. Now and then a player is handed a little dilemma with
 * two choices, each with a consequence. Cards are generated per player (see
 * missions.ts) and resolved here.
 */

import type { Database, EventCard, Loft } from '../schema.js';
import { newId } from '../store.js';
import { estimateValue, generatePigeon } from './pigeon.js';
import { applyAilment, randomDisease, randomInjury } from './health.js';
import { clamp, pick, randFloat, round1 } from './util.js';

/** Build a random dilemma for a loft, or null if none fits right now. */
export function makeEvent(db: Database, loft: Loft, week: number): EventCard | null {
  const owned = db.pigeons.filter((p) => p.ownerId === loft.userId && !p.retired);
  const kinds = ['merchant', 'stray', 'flu', 'gamble', 'hawk'] as const;
  const kind = pick(kinds);

  if (kind === 'merchant' && owned.length > 3) {
    const best = [...owned].sort((a, b) => estimateValue(b, week) - estimateValue(a, week))[0];
    const price = Math.round(estimateValue(best, week) * randFloat(1.15, 1.5));
    return {
      key: 'merchant', icon: '🤑', title: 'Een gladde koopman',
      text: `Een koopman met een dikke sigaar biedt €${price} voor je beste duif, ${best.name}. "Neem het of laat het, melker."`,
      options: [{ label: `Verkopen (€${price})` }, { label: 'Weigeren' }],
      data: { pigeonId: best.id, price },
    };
  }
  if (kind === 'stray') {
    return {
      key: 'stray', icon: '🕊️', title: 'Verdwaalde duif',
      text: 'Er zit een verdwaalde duif in je hok. Geen ring, geen baasje. Houden of laten gaan?',
      options: [{ label: 'Houden' }, { label: 'Laten gaan (kleine beloning)' }],
    };
  }
  if (kind === 'flu') {
    return {
      key: 'flu', icon: '🤧', title: 'Griepgolf in de buurt',
      text: 'Bij de duiven van de buren heerst een griepje. Investeer je preventief in medicatie, of hoop je dat het overwaait?',
      options: [{ label: 'Medicatie kopen (€150)' }, { label: 'Niets doen (risico)' }],
    };
  }
  if (kind === 'gamble') {
    return {
      key: 'gamble', icon: '🎁', title: 'Kat in een zak',
      text: 'Een dubieuze figuur verkoopt een "gegarandeerde topduif" in een gesloten mand voor €300. Je mag niet kijken.',
      options: [{ label: 'Kopen (€300)' }, { label: 'Bedanken' }],
    };
  }
  // hawk
  return {
    key: 'hawk', icon: '🦅', title: 'Sperwer gespot',
    text: 'Een sperwer cirkelt boven je hok. Hou je je duiven veilig binnen, of neem je het risico?',
    options: [{ label: 'Binnenhouden' }, { label: 'Risico nemen' }],
  };
}

function notify(db: Database, loft: Loft, title: string, body: string): void {
  db.notifications.push({
    id: newId('ntf'), userId: loft.userId, kind: 'info', title, body,
    flightId: null, createdAt: new Date().toISOString(), read: false,
  });
}

/**
 * Resolve the loft's pending event with the chosen option. Returns a short
 * result message, or an error string prefixed with '!'.
 */
export function resolveEvent(db: Database, loft: Loft, choice: number, week: number): string {
  const ev = loft.pendingEvent;
  if (!ev) return '!Geen openstaande gebeurtenis';
  loft.pendingEvent = null;
  const d = ev.data ?? {};

  switch (ev.key) {
    case 'merchant': {
      if (choice !== 0) return 'Je stuurt de koopman wandelen.';
      const price = Number(d.price) || 0;
      const idx = db.pigeons.findIndex((p) => p.id === d.pigeonId && p.ownerId === loft.userId);
      if (idx === -1) return 'De duif is er niet meer.';
      const name = db.pigeons[idx].name;
      db.pigeons.splice(idx, 1);
      loft.money += price;
      notify(db, loft, '🤑 Deal gesloten', `${name} verkocht aan de koopman voor €${price}.`);
      return `${name} verkocht voor €${price}.`;
    }
    case 'stray': {
      if (choice === 0) {
        const owned = db.pigeons.filter((p) => p.ownerId === loft.userId).length;
        if (owned >= loft.capacity) return 'Je hok zit vol — de duif vliegt weg.';
        const p = generatePigeon({ ownerId: loft.userId, currentWeek: week, quality: randFloat(0.3, 0.6) });
        db.pigeons.push(p);
        notify(db, loft, '🕊️ Nieuwe duif', `${p.name} maakt voortaan deel uit van je hok.`);
        return `Je hield de duif: ${p.name}.`;
      }
      const tip = Math.round(randFloat(40, 90));
      loft.money += tip;
      return `Je liet ze gaan. De opgeluchte eigenaar gaf je €${tip}.`;
    }
    case 'flu': {
      if (choice === 0) {
        if (loft.money < 150) return 'Niet genoeg geld voor medicatie.';
        loft.money -= 150;
        for (const p of db.pigeons) {
          if (p.ownerId === loft.userId) p.health = round1(clamp(p.health + 8, 0, 100));
        }
        return 'Preventieve medicatie gekocht — je hok blaakt van gezondheid.';
      }
      const healthy = db.pigeons.filter((p) => p.ownerId === loft.userId && !p.ailment && !p.retired);
      if (healthy.length > 0 && Math.random() < 0.55) {
        const victim = pick(healthy);
        applyAilment(victim, randomDisease(week));
        notify(db, loft, '🤒 De griep sloeg toe', `${victim.name} werd ziek. Had je maar medicatie gekocht…`);
        return `${victim.name} is ziek geworden.`;
      }
      return 'Geluk gehad — de griep ging aan je hok voorbij.';
    }
    case 'gamble': {
      if (choice !== 0) return 'Je vertrouwt het zaakje niet en loopt door.';
      if (loft.money < 300) return 'Niet genoeg geld.';
      const owned = db.pigeons.filter((p) => p.ownerId === loft.userId).length;
      if (owned >= loft.capacity) return 'Je hok zit vol.';
      loft.money -= 300;
      const lucky = Math.random() < 0.4;
      const p = generatePigeon({ ownerId: loft.userId, currentWeek: week, quality: lucky ? randFloat(0.8, 0.95) : randFloat(0.15, 0.4) });
      db.pigeons.push(p);
      notify(db, loft, lucky ? '🎉 Jackpot!' : '😬 Kat in een zak', `Uit de mand kwam ${p.name}.`);
      return lucky ? `Geluk! ${p.name} is een pareltje.` : `Pech — ${p.name} stelt weinig voor.`;
    }
    case 'hawk': {
      if (choice === 0) return 'Je hield alles veilig binnen. Geen risico, geen spektakel.';
      const birds = db.pigeons.filter((p) => p.ownerId === loft.userId && !p.ailment && !p.retired);
      if (birds.length > 0 && Math.random() < 0.35) {
        const victim = pick(birds);
        applyAilment(victim, randomInjury(week));
        notify(db, loft, '🦅 Aanval!', `De sperwer pakte ${victim.name} te grazen.`);
        return `${victim.name} raakte gewond.`;
      }
      const reward = Math.round(randFloat(30, 60));
      loft.money += reward;
      return `Niets aan de hand — en je duiven trainden lekker door (+€${reward}).`;
    }
    default:
      return 'Afgehandeld.';
  }
}
