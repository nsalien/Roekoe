/**
 * Event/dilemma cards. Now and then a player is handed a little dilemma with
 * two choices, each with a consequence. Cards are generated per player (see
 * missions.ts) and resolved here.
 */

import type { Database, EventCard, Loft, Pigeon } from '../schema.js';
import { newId } from '../store.js';
import { estimateValue, generatePigeon, noteAttrChange } from './pigeon.js';
import { marketValue } from './market.js';
import { applyAilment, randomAilmentOfSeverity, randomDisease, randomInjury } from './health.js';
import { clamp, pick, randFloat, randInt, round1 } from './util.js';

function owendBy(db: Database, loft: Loft): Pigeon[] {
  return db.pigeons.filter((p) => p.ownerId === loft.userId);
}

/** Build a random dilemma for a loft, or null if none fits right now. */
export function makeEvent(db: Database, loft: Loft, week: number): EventCard | null {
  const owned = owendBy(db, loft);
  const eligible = ['stray', 'flu', 'gamble', 'sponsor', 'quack', 'heatwave', 'event', 'doping', 'inheritance'];
  if (owned.length > 0) eligible.push('scout', 'charity', 'poacher');
  if (owned.length > 3) eligible.push('merchant');
  const kind = pick(eligible);

  switch (kind) {
    case 'merchant': {
      const best = [...owned].sort((a, b) => estimateValue(b, week) - estimateValue(a, week))[0];
      // Off the MARKET value, not the model — otherwise the merchant lowballs
      // exactly the birds players value most (see game/market.ts).
      const price = Math.round(marketValue(db, best, week) * randFloat(1.15, 1.5));
      return {
        key: 'merchant', icon: '🤑', title: 'Een gladde koopman',
        text: `Een koopman met een dikke sigaar biedt €${price} voor je beste duif, ${best.name}. "Neem het of laat het, melker."`,
        options: [{ label: `Verkopen (€${price})` }, { label: 'Weigeren' }],
        data: { pigeonId: best.id, price },
      };
    }
    case 'stray':
      return {
        key: 'stray', icon: '🕊️', title: 'Verdwaalde duif',
        text: 'Er zit een verdwaalde duif in je hok. Geen ring, geen baasje. Houden of laten gaan?',
        options: [{ label: 'Houden' }, { label: 'Laten gaan (kleine beloning)' }],
      };
    case 'flu':
      return {
        key: 'flu', icon: '🤧', title: 'Griepgolf in de buurt',
        text: 'Bij de duiven van de buren heerst een griepje. Investeer je preventief in medicatie, of hoop je dat het overwaait?',
        options: [{ label: 'Medicatie kopen (€150)' }, { label: 'Niets doen (risico)' }],
      };
    case 'gamble':
      return {
        key: 'gamble', icon: '🎁', title: 'Kat in een zak',
        text: 'Een dubieuze figuur verkoopt een "gegarandeerde topduif" in een gesloten mand voor €300. Je mag niet kijken.',
        options: [{ label: 'Kopen (€300)' }, { label: 'Bedanken' }],
      };
    case 'sponsor':
      return {
        key: 'sponsor', icon: '🍟', title: 'Een gulle sponsor',
        text: "Frituur 't Vetzakske wil je hok sponsoren met €500 — maar je duiven moeten een week lang restjes frietvet eten.",
        options: [{ label: 'Aanvaarden (€500)' }, { label: 'Vriendelijk bedanken' }],
      };
    case 'quack':
      return {
        key: 'quack', icon: '🧪', title: 'De kwakzalver',
        text: 'Een marktkramer verkoopt "geheime duivenvitaminen" voor €120. "Gegarandeerd meer pit, melker! Of niet, wie zal het zeggen."',
        options: [{ label: 'Kopen (€120)' }, { label: 'Bedanken' }],
      };
    case 'heatwave':
      return {
        key: 'heatwave', icon: '🥵', title: 'Hittegolf op komst',
        text: 'Het wordt bloedheet dit weekend. Investeer je in extra water en schaduw voor je hok?',
        options: [{ label: 'Water & schaduw (€80)' }, { label: 'Niets doen (risico)' }],
      };
    case 'doping':
      return {
        key: 'doping', icon: '💉', title: 'De dokter met de zwarte tas',
        text: 'Een gladde "sportarts" fluistert dat hij iets speciaals heeft: je hele hok knalt er een week bovenop. Maar als er een dopingcontrole komt, hangt er een boete én een zieke duif aan vast. "Niemand die het weet, melker… meestal."',
        options: [{ label: 'Toedienen (€200)' }, { label: 'Poten op de grond houden' }],
      };
    case 'inheritance':
      return {
        key: 'inheritance', icon: '📜', title: 'Erfenis van een oude melker',
        text: 'Een overleden dorpsgenoot liet jou iets na — maar je mag maar één ding kiezen: zijn spaarpot, zijn laatste kampioen (sterke genen, maar op leeftijd), of zijn jonge belofte (goedkoop gehouden, niemand weet wat erin zit). Kiezen is verliezen.',
        options: [{ label: 'De spaarpot (€600)' }, { label: 'De oude kampioen' }, { label: 'De jonge belofte' }],
      };
    case 'scout': {
      const best = [...owned].sort((a, b) => estimateValue(b, week) - estimateValue(a, week))[0];
      return {
        key: 'scout', icon: '🔎', title: 'Talentenjager aan de deur',
        text: `Een scout wil ${best.name} een week meenemen naar een topmelker "om te leren". Ze komt beter terug… of helemaal op de toppen van haar tenen. Durf je je pronkstuk te riskeren?`,
        options: [{ label: `${best.name} meegeven (risico)` }, { label: 'Thuishouden' }],
        data: { pigeonId: best.id },
      };
    }
    case 'poacher':
      return {
        key: 'poacher', icon: '🦅', title: 'Sperwer in de buurt',
        text: 'Er cirkelt een sperwer boven het dorp. Span je (dure) beschermnetten, of hoop je dat je duiven binnenblijven? Een aanval kan heel lelijk aflopen — tot een dode duif toe.',
        options: [{ label: 'Beschermnetten (€120)' }, { label: 'Niets doen (risico)' }],
      };
    case 'charity': {
      const best = [...owned].sort((a, b) => estimateValue(b, week) - estimateValue(a, week))[0];
      return {
        key: 'charity', icon: '🎗️', title: 'Liefdadigheidsvlucht',
        text: `De gemeente vraagt je pronkstuk ${best.name} voor een goede-doel-vlucht. Het levert €400 en veel sympathie op, maar ze komt bekaf terug — en een ongeluk zit in een klein hoekje.`,
        options: [{ label: `${best.name} laten vliegen (€400)` }, { label: 'Bedanken' }],
        data: { pigeonId: best.id },
      };
    }
    default: // 'event'
      return {
        key: 'event', icon: '🎪', title: 'De gemeente vraagt je duiven',
        text: 'Voor het dorpsfeest mogen jouw duiven de lucht kleuren. Het betaalt €250, maar je duiven zijn nadien wel bekaf.',
        options: [{ label: 'Meedoen (€250)' }, { label: 'Afslaan' }],
      };
  }
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
  const owned = owendBy(db, loft);

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
        if (owned.length >= loft.capacity) return 'Je hok zit vol — de duif vliegt weg.';
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
        for (const p of owned) p.health = round1(clamp(p.health + 8, 0, 100));
        return 'Preventieve medicatie gekocht — je hok blaakt van gezondheid.';
      }
      const healthy = owned.filter((p) => !p.ailment);
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
      if (owned.length >= loft.capacity) return 'Je hok zit vol.';
      loft.money -= 300;
      const lucky = Math.random() < 0.4;
      const p = generatePigeon({ ownerId: loft.userId, currentWeek: week, quality: lucky ? randFloat(0.8, 0.95) : randFloat(0.15, 0.4) });
      db.pigeons.push(p);
      notify(db, loft, lucky ? '🎉 Jackpot!' : '😬 Kat in een zak', `Uit de mand kwam ${p.name}.`);
      return lucky ? `Geluk! ${p.name} is een pareltje.` : `Pech — ${p.name} stelt weinig voor.`;
    }
    case 'sponsor': {
      if (choice !== 0) return 'Je bedankt de frituur vriendelijk.';
      loft.money += 500;
      for (const p of owned) p.form = round1(clamp(p.form - 6, 0, 100));
      return 'Sponsordeal gesloten! €500 in kas, maar je duiven zitten vol frietvet (−energie).';
    }
    case 'quack': {
      if (choice !== 0) return 'Je laat de kwakzalver links liggen.';
      if (loft.money < 120) return 'Niet genoeg geld.';
      loft.money -= 120;
      if (Math.random() < 0.6) {
        for (const p of owned) {
          const bEnd = p.endurance;
          p.endurance = round1(clamp(p.endurance + 8, 0, 100));
          noteAttrChange(p, 'endurance', bEnd, 'gebeurtenis: kwakzalver');
          p.form = round1(clamp(p.form + 8, 0, 100));
        }
        return 'De vitaminen blijken echt te werken — je duiven bruisen van energie en conditie!';
      }
      const healthy = owned.filter((p) => !p.ailment);
      if (healthy.length > 0) {
        const victim = pick(healthy);
        applyAilment(victim, randomDisease(week));
        notify(db, loft, '🧪 Foute brouwsel', `${victim.name} werd ziek van de dubieuze vitaminen.`);
        return `Bocht! ${victim.name} werd er ziek van.`;
      }
      return 'De vitaminen deden… helemaal niets. Weggegooid geld.';
    }
    case 'heatwave': {
      if (choice === 0) {
        if (loft.money < 80) return 'Niet genoeg geld.';
        loft.money -= 80;
        for (const p of owned) p.health = round1(clamp(p.health + 5, 0, 100));
        return 'Extra water en schaduw voorzien — je duiven doorstaan de hitte prima.';
      }
      if (Math.random() < 0.5 && owned.length > 0) {
        const victims = [...owned].sort(() => Math.random() - 0.5).slice(0, Math.min(2, owned.length));
        for (const p of victims) {
          p.health = round1(clamp(p.health - 12, 0, 100));
          p.form = round1(clamp(p.form - 10, 0, 100));
        }
        notify(db, loft, '🥵 De hitte sloeg toe', `${victims.map((p) => p.name).join(' en ')} hebben het zwaar gehad.`);
        return `${victims.length} duif/duiven leden onder de hitte.`;
      }
      return 'Het viel al bij al mee met de hitte.';
    }
    case 'event': {
      if (choice !== 0) return 'Je slaat de uitnodiging beleefd af.';
      loft.money += 250;
      const tired = [...owned].sort(() => Math.random() - 0.5).slice(0, Math.min(3, owned.length));
      for (const p of tired) p.form = round1(clamp(p.form - 12, 0, 100));
      return `Leuk feest! €250 verdiend, maar ${tired.length} duif/duiven zijn nu bekaf.`;
    }
    case 'doping': {
      if (choice !== 0) return 'Je houdt het netjes — geen duistere spuitjes in jouw hok.';
      if (loft.money < 200) return 'Niet genoeg geld.';
      loft.money -= 200;
      if (Math.random() < 0.55) {
        for (const p of owned) {
          p.form = round1(clamp(p.form + 12, 0, 100));
          p.health = round1(clamp(p.health + 8, 0, 100));
        }
        return 'Het spul werkt — je hok knettert van de energie. Niemand die iets vroeg…';
      }
      loft.money -= 150; // fine
      const healthy = owned.filter((p) => !p.ailment);
      if (healthy.length > 0) {
        const victim = pick(healthy);
        applyAilment(victim, randomAilmentOfSeverity('ziekte', 'ernstig', week));
        notify(db, loft, '💉 Betrapt', `Er kwam een controle: boete €150 en ${victim.name} werd flink ziek van de rommel.`);
        return `Mis! Dopingcontrole: boete €150 en ${victim.name} is er ernstig ziek van geworden.`;
      }
      return 'Er kwam een controle — boete €150. Zuur, en niets aan overgehouden.';
    }
    case 'inheritance': {
      if (choice === 0) {
        loft.money += 600;
        return 'Je koos de spaarpot: €600 rijker.';
      }
      if (owned.length >= loft.capacity) return 'Je hok zit vol — je kan geen duif plaatsen, dus de erfenis gaat aan je neus voorbij.';
      if (choice === 1) {
        // Old champion: strong genes but old (frail, low value, higher mortality).
        const p = generatePigeon({ ownerId: loft.userId, currentWeek: week, quality: randFloat(0.82, 0.96), birthWeek: week - randInt(280, 430) });
        db.pigeons.push(p);
        notify(db, loft, '🏆 Een oude kampioen', `${p.name} — ooit een topper, nu op leeftijd — verhuist naar jouw hok.`);
        return `Je koos de oude kampioen: ${p.name}. Sterke genen, maar tel wel haar jaren.`;
      }
      // Young prospect: unknown quality.
      const lucky = Math.random() < 0.45;
      const p = generatePigeon({ ownerId: loft.userId, currentWeek: week, quality: lucky ? randFloat(0.7, 0.9) : randFloat(0.2, 0.45), birthWeek: week - randInt(8, 20) });
      db.pigeons.push(p);
      notify(db, loft, lucky ? '🌟 Een ruwe diamant' : '🐣 Een gewone jong', `Uit de erfenis kwam ${p.name}.`);
      return lucky ? `De jonge belofte ${p.name} blijkt veel in haar mars te hebben!` : `De jonge belofte ${p.name} is voorlopig maar gewoontjes.`;
    }
    case 'scout': {
      if (choice !== 0) return 'Je houdt je duif liever veilig thuis.';
      const idx = db.pigeons.findIndex((p) => p.id === d.pigeonId && p.ownerId === loft.userId);
      if (idx === -1) return 'De duif is er niet meer.';
      const p = db.pigeons[idx];
      if (Math.random() < 0.5) {
        const bSpeed = p.speed, bEnd = p.endurance;
        p.speed = round1(clamp(p.speed + randFloat(2, 5), 0, 100));
        p.endurance = round1(clamp(p.endurance + randFloat(2, 5), 0, 100));
        p.experience = round1(clamp(p.experience + randFloat(4, 8), 0, 100));
        noteAttrChange(p, 'speed', bSpeed, 'gebeurtenis: talentenjager');
        noteAttrChange(p, 'endurance', bEnd, 'gebeurtenis: talentenjager');
        notify(db, loft, '🔎 Wat een vooruitgang', `${p.name} kwam sterker terug van bij de topmelker.`);
        return `${p.name} leerde bij en is merkbaar beter geworden!`;
      }
      p.form = round1(clamp(p.form - randFloat(20, 35), 0, 100));
      if (Math.random() < 0.5 && !p.ailment) {
        applyAilment(p, randomInjury(week));
        notify(db, loft, '🔎 Slecht nieuws', `${p.name} kwam afgepeigerd én gekwetst terug van "de stage".`);
        return `Pech — ${p.name} raakte gekwetst tijdens het "leren".`;
      }
      return `${p.name} kwam doodmoe terug — een week verspild.`;
    }
    case 'poacher': {
      if (choice === 0) {
        if (loft.money < 120) return 'Niet genoeg geld voor netten.';
        loft.money -= 120;
        return 'Beschermnetten gespannen — de sperwer vist achter het net.';
      }
      if (Math.random() < 0.45 && owned.length > 0) {
        const victim = pick(owned);
        if (Math.random() < 0.2) {
          const name = victim.name;
          const vidx = db.pigeons.findIndex((p) => p.id === victim.id);
          if (vidx !== -1) db.pigeons.splice(vidx, 1);
          notify(db, loft, '🦅 Gegrepen', `De sperwer sloeg toe: ${name} is niet meer.`);
          return `Drama — ${name} werd door de sperwer gegrepen.`;
        }
        if (!victim.ailment) applyAilment(victim, randomAilmentOfSeverity('kwetsuur', 'ernstig', week));
        notify(db, loft, '🦅 Aangevallen', `${victim.name} ontsnapte ternauwernood, maar is er ernstig aan toe.`);
        return `${victim.name} raakte zwaargewond bij een sperweraanval.`;
      }
      return 'De sperwer trok verder — je duiven bleven ongedeerd. Geluk gehad.';
    }
    case 'charity': {
      if (choice !== 0) return 'Je slaat de uitnodiging af.';
      const idx = db.pigeons.findIndex((p) => p.id === d.pigeonId && p.ownerId === loft.userId);
      if (idx === -1) return 'De duif is er niet meer.';
      const p = db.pigeons[idx];
      loft.money += 400;
      p.form = round1(clamp(p.form - 18, 0, 100));
      if (Math.random() < 0.2 && !p.ailment) {
        applyAilment(p, randomInjury(week));
        notify(db, loft, '🎗️ Kleine tegenslag', `${p.name} liep bij de liefdadigheidsvlucht een blessure op — maar het goede doel is dankbaar.`);
        return `€400 opgehaald voor het goede doel, maar ${p.name} kwam gekwetst terug.`;
      }
      return `€400 opgehaald voor het goede doel! ${p.name} is bekaf maar ongedeerd.`;
    }
    default:
      return 'Afgehandeld.';
  }
}
