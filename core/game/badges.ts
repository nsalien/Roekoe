/**
 * Badges, player XP and levels.
 *
 * Badges are awarded for milestones (race wins, breeding, market, care, …).
 * Each grants XP; total XP determines a player's level (shown as prestige in
 * the ranking). Count/state badges are declared with a `test`; one-off event
 * badges are awarded imperatively where the event happens.
 */

import { EPITHETS } from '../config/gameConfig.js';
import type { Database, Flight, Loft } from '../schema.js';
import { newId } from '../store.js';

export interface BadgeDef {
  key: string;
  group: 'race' | 'podium' | 'breed' | 'market' | 'care' | 'milestone' | 'fun';
  label: string;
  description: string;
  xp: number;
  icon: string;
  /** For count/state badges: true once earned. Event badges omit this. */
  test?: (loft: Loft, db: Database) => boolean;
}

const s = (l: Loft) => l.stats;

export const BADGES: BadgeDef[] = [
  // --- Race wins ---
  { key: 'reg_win_1', group: 'race', label: 'Regiowinnaar', description: 'Win je eerste regionale vlucht.', xp: 25, icon: '🥇', test: (l) => s(l).regionalWins >= 1 },
  { key: 'reg_win_10', group: 'race', label: 'Regiokampioen', description: 'Win 10 regionale vluchten.', xp: 50, icon: '🥇', test: (l) => s(l).regionalWins >= 10 },
  { key: 'reg_win_50', group: 'race', label: 'Regiolegende', description: 'Win 50 regionale vluchten.', xp: 150, icon: '🏅', test: (l) => s(l).regionalWins >= 50 },
  { key: 'reg_win_100', group: 'race', label: 'Regiogod', description: 'Win 100 regionale vluchten.', xp: 300, icon: '🏆', test: (l) => s(l).regionalWins >= 100 },
  { key: 'nat_win_1', group: 'race', label: 'Nationale zege', description: 'Win je eerste nationale vlucht.', xp: 50, icon: '🥇', test: (l) => s(l).nationalWins >= 1 },
  { key: 'nat_win_10', group: 'race', label: 'Nationaal kampioen', description: 'Win 10 nationale vluchten.', xp: 75, icon: '🥇', test: (l) => s(l).nationalWins >= 10 },
  { key: 'nat_win_50', group: 'race', label: 'Nationale legende', description: 'Win 50 nationale vluchten.', xp: 200, icon: '🏅', test: (l) => s(l).nationalWins >= 50 },
  { key: 'nat_win_100', group: 'race', label: 'Nationale grootmeester', description: 'Win 100 nationale vluchten.', xp: 400, icon: '🏆', test: (l) => s(l).nationalWins >= 100 },
  { key: 'intl_win_1', group: 'race', label: 'Internationale zege', description: 'Win je eerste internationale vlucht.', xp: 100, icon: '🥇', test: (l) => s(l).intlWins >= 1 },
  { key: 'intl_win_10', group: 'race', label: 'Internationaal kampioen', description: 'Win 10 internationale vluchten.', xp: 150, icon: '🥇', test: (l) => s(l).intlWins >= 10 },
  { key: 'intl_win_50', group: 'race', label: 'Internationale legende', description: 'Win 50 internationale vluchten.', xp: 300, icon: '🏅', test: (l) => s(l).intlWins >= 50 },
  { key: 'intl_win_100', group: 'race', label: 'Wereldster', description: 'Win 100 internationale vluchten.', xp: 500, icon: '🏆', test: (l) => s(l).intlWins >= 100 },

  // --- Podium / results ---
  { key: 'podium_1', group: 'podium', label: 'Op het schavot', description: 'Behaal je eerste podiumplaats (top 3).', xp: 25, icon: '🎖️', test: (l) => s(l).gold + s(l).silver + s(l).bronze >= 1 },
  { key: 'podium_25', group: 'podium', label: 'Podiumbeest', description: 'Behaal 25 podiumplaatsen.', xp: 75, icon: '🎖️', test: (l) => s(l).gold + s(l).silver + s(l).bronze >= 25 },
  { key: 'podium_100', group: 'podium', label: 'Podiumvaste waarde', description: 'Behaal 100 podiumplaatsen.', xp: 200, icon: '🎖️', test: (l) => s(l).gold + s(l).silver + s(l).bronze >= 100 },
  { key: 'full_podium', group: 'podium', label: 'Heel het podium', description: 'Eindig met 3 eigen duiven in de top 3 van één vlucht.', xp: 200, icon: '🧹' },
  { key: 'storm_win', group: 'podium', label: 'Stormvlieger', description: 'Win een vlucht bij bar slecht weer.', xp: 100, icon: '🌩️' },
  { key: 'wonderkind', group: 'podium', label: 'Wonderkind', description: 'Win met een duif jonger dan 1 jaar.', xp: 75, icon: '🐣' },
  { key: 'oude_meester', group: 'podium', label: 'Oude Meester', description: 'Win met een duif ouder dan 8 jaar.', xp: 100, icon: '🧓' },
  { key: 'comeback', group: 'podium', label: 'Comeback Kid', description: 'Win met een duif die ooit ziek of gewond was.', xp: 100, icon: '💪' },
  { key: 'galgenhumor', group: 'fun', label: 'Galgenhumor', description: 'Win met een pikzwart-genoemde duif.', xp: 50, icon: '☠️' },

  // --- Breeding ---
  { key: 'baby_1', group: 'breed', label: 'Kersvers ouder', description: 'Krijg je eerste jong.', xp: 25, icon: '🐣', test: (l) => s(l).babies >= 1 },
  { key: 'baby_10', group: 'breed', label: 'Vruchtbaar hok', description: 'Krijg 10 jongen.', xp: 50, icon: '🐣', test: (l) => s(l).babies >= 10 },
  { key: 'baby_50', group: 'breed', label: 'Kweekmachine', description: 'Krijg 50 jongen.', xp: 150, icon: '🥚', test: (l) => s(l).babies >= 50 },
  { key: 'baby_100', group: 'breed', label: 'Duivenfabriek', description: 'Krijg 100 jongen.', xp: 300, icon: '🏭', test: (l) => s(l).babies >= 100 },
  { key: 'tweeling', group: 'breed', label: 'Tweeling!', description: 'Krijg voor het eerst een tweeling.', xp: 25, icon: '👯', test: undefined },
  { key: 'topfokker', group: 'breed', label: 'Topfokker', description: 'Kweek een duif met talent boven 85.', xp: 200, icon: '🧬' },
  { key: 'dynastie', group: 'breed', label: 'Dynastie', description: 'Heb 3 generaties in je hok.', xp: 150, icon: '👑' },

  // --- Market ---
  { key: 'buy_1', group: 'market', label: 'Eerste aankoop', description: 'Koop een duif op de markt.', xp: 10, icon: '🛒', test: (l) => s(l).buys >= 1 },
  { key: 'sell_1', group: 'market', label: 'Eerste verkoop', description: 'Verkoop een duif op de markt.', xp: 10, icon: '💰', test: (l) => s(l).sells >= 1 },
  { key: 'handelaar', group: 'market', label: 'Handelaar', description: 'Verkoop een duif voor meer dan €1.000.', xp: 75, icon: '🤝' },
  { key: 'trade_10', group: 'market', label: 'Marktkramer', description: 'Doe 10 transacties (koop + verkoop).', xp: 50, icon: '🏬', test: (l) => s(l).buys + s(l).sells >= 10 },
  { key: 'trade_50', group: 'market', label: 'Duivenmakelaar', description: 'Doe 50 transacties.', xp: 150, icon: '🏦', test: (l) => s(l).buys + s(l).sells >= 50 },

  // --- Care / health ---
  { key: 'cure_1', group: 'care', label: 'Genezer', description: 'Genees een zieke of gewonde duif.', xp: 25, icon: '💊', test: (l) => s(l).cures >= 1 },
  { key: 'cure_severe', group: 'care', label: 'Wonderdokter', description: 'Genees een ernstige aandoening.', xp: 75, icon: '🩺', test: (l) => s(l).curesSevere >= 1 },
  { key: 'staff_1', group: 'care', label: 'Werkgever', description: 'Huur een dokter of kinesist.', xp: 25, icon: '👨‍⚕️', test: (l) => s(l).staffHired >= 1 },
  { key: 'topfit', group: 'care', label: 'Topfit', description: 'Breng een duif op 100 conditie.', xp: 100, icon: '🏋️', test: (l, db) => db.pigeons.some((p) => p.ownerId === l.userId && p.endurance >= 99.5) },
  { key: 'taaie_rakker', group: 'care', label: 'Taaie Rakker', description: 'Een duif overleeft 25 vluchten.', xp: 100, icon: '🦾', test: (l, db) => db.pigeons.some((p) => p.ownerId === l.userId && p.races >= 25) },

  // --- Milestones / wealth ---
  { key: 'entry_1', group: 'milestone', label: 'Debutant', description: 'Schrijf je eerste duif in voor een vlucht.', xp: 10, icon: '🎫', test: (l) => s(l).entries >= 1 },
  { key: 'entry_10', group: 'milestone', label: 'Vaste deelnemer', description: 'Doe 10 vluchtdeelnames.', xp: 25, icon: '🎫', test: (l) => s(l).entries >= 10 },
  { key: 'entry_100', group: 'milestone', label: 'Doorwinterde melker', description: 'Doe 100 vluchtdeelnames.', xp: 100, icon: '🎟️', test: (l) => s(l).entries >= 100 },
  { key: 'entry_500', group: 'milestone', label: 'Duivenveteraan', description: 'Doe 500 vluchtdeelnames.', xp: 300, icon: '🎖️', test: (l) => s(l).entries >= 500 },
  { key: 'baron', group: 'milestone', label: 'Duivenbaron', description: 'Heb €10.000 in kas.', xp: 100, icon: '💵', test: (l) => l.money >= 10000 },
  { key: 'millionair', group: 'milestone', label: "Miljonair van 't dorp", description: 'Heb €50.000 in kas.', xp: 300, icon: '🤑', test: (l) => l.money >= 50000 },
  { key: 'season_champion', group: 'milestone', label: 'Seizoenskampioen', description: 'Eindig als #1 bij een seizoenswissel.', xp: 500, icon: '👑' },

  // --- Fun / dark ---
  { key: 'rip_sperwer', group: 'fun', label: 'RIP 🕊️', description: 'Verlies een duif aan een sperwer.', xp: 25, icon: '🦅' },
  { key: 'vredig', group: 'fun', label: 'Vredig Heengegaan', description: 'Een duif sterft van ouderdom.', xp: 25, icon: '🕯️' },
  { key: 'kerngezond', group: 'fun', label: 'Kerngezond Hok', description: 'Al je duiven tegelijk 100% gezond (min. 4).', xp: 75, icon: '💚', test: (l, db) => { const mine = db.pigeons.filter((p) => p.ownerId === l.userId && !p.retired); return mine.length >= 4 && mine.every((p) => p.health >= 100); } },
];

export const BADGE_MAP = new Map(BADGES.map((b) => [b.key, b]));

/** Level for a total XP amount, plus progress into the current level. */
export function levelForXp(xp: number): { level: number; intoLevel: number; needForNext: number } {
  let level = 1;
  let need = 100;
  let remaining = Math.max(0, Math.floor(xp));
  while (remaining >= need) {
    remaining -= need;
    level += 1;
    need += 75;
  }
  return { level, intoLevel: remaining, needForNext: need };
}

function pushBadge(db: Database, userId: string, def: BadgeDef): void {
  db.notifications.push({
    id: newId('ntf'), userId, kind: 'badge',
    title: `${def.icon} Badge ontgrendeld: ${def.label}`,
    body: `${def.description} +${def.xp} XP.`,
    flightId: null, createdAt: new Date().toISOString(), read: false,
  });
}

/** Award a badge (once). Returns true if it was newly earned. */
export function awardBadge(db: Database, loft: Loft, key: string): boolean {
  if (loft.badges.some((b) => b.key === key)) return false;
  const def = BADGE_MAP.get(key);
  if (!def) return false;
  const before = loft.level;
  loft.badges.push({ key, at: new Date().toISOString() });
  loft.xp += def.xp;
  loft.level = levelForXp(loft.xp).level;
  if (!loft.isBot) {
    pushBadge(db, loft.userId, def);
    if (loft.level > before) {
      db.notifications.push({
        id: newId('ntf'), userId: loft.userId, kind: 'badge',
        title: `⭐ Level ${loft.level} bereikt!`,
        body: `Je hok is gestegen naar niveau ${loft.level}. Anderen zien dit in de ranglijst.`,
        flightId: null, createdAt: new Date().toISOString(), read: false,
      });
    }
  }
  return true;
}

/** Award every count/state badge whose condition is now met. */
export function evaluateBadges(db: Database, loft: Loft): void {
  for (const def of BADGES) {
    if (!def.test) continue;
    if (loft.badges.some((b) => b.key === def.key)) continue;
    if (def.test(loft, db)) awardBadge(db, loft, def.key);
  }
}

function isDarkName(name: string): boolean {
  return (EPITHETS.dark as readonly string[]).some((d) => name.includes(d));
}

/** Update stats + award badges after a flight is finalized. */
export function awardFlightBadges(db: Database, flight: Flight): void {
  for (const r of flight.results) {
    const p = db.pigeons.find((x) => x.id === r.pigeonId);
    if (p) p.races += 1;
  }
  const owners = new Set(flight.results.map((r) => r.ownerId));
  for (const ownerId of owners) {
    const loft = db.lofts.find((l) => l.userId === ownerId);
    if (!loft) continue;
    const mine = flight.results.filter((r) => r.ownerId === ownerId);
    for (const r of mine) {
      if (r.rank === 1) loft.stats.gold += 1;
      else if (r.rank === 2) loft.stats.silver += 1;
      else if (r.rank === 3) loft.stats.bronze += 1;
    }
    const winner = mine.find((r) => r.rank === 1);
    if (winner) {
      if (flight.type === 'regional') loft.stats.regionalWins += 1;
      else if (flight.type === 'national') loft.stats.nationalWins += 1;
      else loft.stats.intlWins += 1;

      if (flight.weatherFactor < 0.92) awardBadge(db, loft, 'storm_win');
      const p = db.pigeons.find((x) => x.id === winner.pigeonId);
      if (p) {
        const ageWk = db.world.currentWeek - p.birthWeek;
        if (ageWk < 52) awardBadge(db, loft, 'wonderkind');
        if (ageWk > 8 * 52) awardBadge(db, loft, 'oude_meester');
        if (p.everAiled) awardBadge(db, loft, 'comeback');
        if (isDarkName(p.name)) awardBadge(db, loft, 'galgenhumor');
      }
      const top3 = flight.results.filter((r) => r.rank <= 3);
      if (top3.length >= 3 && top3.every((r) => r.ownerId === ownerId)) awardBadge(db, loft, 'full_podium');
    }
    evaluateBadges(db, loft);
  }
}
