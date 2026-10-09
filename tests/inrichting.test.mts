/**
 * HOKINRICHTING (⚠️ dev, nog niet live): alles behalve stro/hygiëne/poetser
 * (die staan in hygiene.test.mts). Bewaakt de getallen uit het voorstel en de
 * huisregel "niets kopen = het spel van vandaag":
 *
 *   ventilatie, ren + sperwer, roofvogelafweer, kunstlicht, infrarood,
 *   reismanden, weerstation, vakblad, vaccins/kuren, verzekering, weduwschap,
 *   scout, en wat de bots kopen.
 *
 * Run: npx tsx tests/inrichting.test.mts   (vanuit de repo-root)
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Database, Flight, Pigeon, User } from '../core/schema.js';
import { createLoftForUser, enterFlight, seedWorld, startBreeding } from '../core/game/engine.js';
import { applyFlightForecasts, ensureFlightsScheduled, flightsNeedingForecast, tickDailyCare } from '../core/game/schedule.js';
import {
  buyEquipment, buyIrBox, entryMods, fendsOff, grounded, insurancePayout, insurancePremium, insuranceQuote,
  inrichtingBenefits, magazineRanges, setInsurance, tickHawk, tickMagazine, vaccinate, vaccinateLoft,
  libidoTargetBonus, restBonusEnergy, upgradeEquipment, inrichtingLevels, feedHealthMult, irBoxEffect,
} from '../core/game/inrichting.js';
import { equipmentLevel, hygieneDecay } from '../core/game/hygiene.js';
import { breed } from '../core/game/breeding.js';
import { buyScouted, returnChance, rollReturnDay, scoutStatus, sendScout } from '../core/game/scout.js';
import { dailyRunningCostBreakdown } from '../core/game/economy.js';
import { startLiveFlight } from '../core/game/flight.js';
import { canRace, talent } from '../core/game/pigeon.js';
import { marketValue } from '../core/game/market.js';
import { EQUIPMENT, EQUIPMENT_LEVELS, INSURANCE, SCOUT, VACCINES } from '../core/config/gameConfig.js';
import { randomWeather } from '../core/game/weather.js';

let fail = 0;
const ok = (c: boolean, m: string) => { if (c) console.log(`  ✓ ${m}`); else { fail++; console.log(`  ✗ ${m}`); } };
const DAY = 86400000;
const T0 = Date.parse(new Date().toISOString().slice(0, 10) + 'T04:00:00Z');

function world(money = 50000) {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const u: User = { id: newId('usr'), username: 'speler', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString() };
  store.mutate((d) => d.users.push(u));
  createLoftForUser(store, u, 'Hok Proef');
  const db = store.data;
  tickDailyCare(db, T0);
  const loft = db.lofts.find((l) => l.userId === u.id)!;
  loft.money = money;
  return { store, db, userId: u.id, loft, birds: () => db.pigeons.filter((p) => p.ownerId === u.id) };
}
const costLine = (db: Database, userId: string, key: string) => {
  const loft = db.lofts.find((l) => l.userId === userId)!;
  const pairs = db.breedingPairs.filter((bp) => bp.ownerId === userId).length;
  return dailyRunningCostBreakdown(loft, 6, 0, 0, undefined, { pairs, insurance: 0 }).equipment.find((l) => l.key === key)?.amount ?? 0;
};

console.log('\n=== 1. Inrichting kopen + de Dagbalans ===');
{
  const { store, db, userId, loft } = world();
  ok(buyEquipment(store, userId, 'ventilation') === null && loft.money === 50000 - 1200, 'dakventilatie: €1.200');
  ok(costLine(db, userId, 'ventilation') === 0, '…eenmalig: geen dagkost in de Dagbalans');
  ok(buyEquipment(store, userId, 'ventilation') !== null, 'twee keer kopen kan niet');
  ok(buyEquipment(store, userId, 'raptorGuard') !== null, 'roofvogelafweer zonder ren wordt geweigerd');
  ok(buyEquipment(store, userId, 'run') === null && costLine(db, userId, 'run') === 0, 'buitenren: eenmalig');
  ok(buyEquipment(store, userId, 'raptorGuard') === null && costLine(db, userId, 'raptorGuard') === 0, 'roofvogelafweer: eenmalig, geen dagkost');
  ok(buyEquipment(store, userId, 'light') === null && costLine(db, userId, 'light') === 0, 'kunstlicht: eenmalig');
  ok(buyEquipment(store, userId, 'baskets') === null && costLine(db, userId, 'baskets') === 0, 'reismanden: eenmalig');
  ok(buyEquipment(store, userId, 'weatherStation') === null && costLine(db, userId, 'station') === 0, 'weerstation: eenmalig');
  ok(buyEquipment(store, userId, 'magazine') === null && costLine(db, userId, 'magazine') === 6, 'vakblad: een abonnement, €6/dag');
  ok(buyEquipment(store, userId, 'magazine', false) === null && costLine(db, userId, 'magazine') === 0, 'vakblad opzeggen kan');
  const m = loft.money;
  ok(buyIrBox(store, userId) === null && loft.money === m - 1600 && loft.equipment!.irBoxes === 2, 'infrarood: eerste aankoop = 2 bakken voor €1.600');
  ok(buyIrBox(store, userId) === null && loft.money === m - 2100 && loft.equipment!.irBoxes === 3, '…elke extra bak €500');
  ok(costLine(db, userId, 'ir') === 0, 'infrarood: geen dagkost');
  const lines = dailyRunningCostBreakdown(loft, 6, 0, 0, undefined, { pairs: 3, insurance: 0 }).equipment.map((l) => l.key);
  ok(lines.length === 0, `met alle inrichting en zonder poetser of vakblad: niets per dag (${lines.join(', ') || 'leeg'})`);

  // What it gives you, in the engine's own numbers.
  const b = inrichtingBenefits();
  ok(b.ventilation.includes('40 %') && b.ventilation.includes('25 %') && b.ventilation.includes('5 %'), `ventilatie: "${b.ventilation}"`);
  ok(b.baskets.includes('3 %') && b.baskets.includes('5 %'), `reismanden: "${b.baskets}"`);
  ok(b.run.includes('+6') && b.run.includes('+4') && b.run.includes('40 dagen'), `buitenren: "${b.run}"`);
  ok(['compartment', 'straw', 'cleaner', 'ventilation', 'run', 'raptorGuard', 'light', 'irBoxes', 'partnerhok', 'baskets', 'weatherStation', 'magazine']
    .every((k) => typeof b[k] === 'string' && b[k].length > 10), 'elk onderdeel heeft een uitleg');
}

console.log('\n=== 2. Ren, sperwer en roofvogelafweer ===');
{
  const { store, db, userId, loft, birds } = world();
  buyEquipment(store, userId, 'run');
  let hawks = 0;
  for (let day = 20000; day < 22000; day++) {
    const before = loft.equipment!.lastHawkDay;
    tickHawk(db, loft, birds(), day, new Set());
    if (loft.equipment!.lastHawkDay !== before) hawks += 1;
    for (const p of birds()) p.form = 80;
  }
  ok(hawks > 30 && hawks < 75, `zonder afweer ~1 op 40 dagen een sperwer (${hawks} op 2000 dagen)`);
  buyEquipment(store, userId, 'raptorGuard');
  const last = loft.equipment!.lastHawkDay;
  for (let day = 22000; day < 23000; day++) tickHawk(db, loft, birds(), day, new Set());
  ok(loft.equipment!.lastHawkDay === last, 'met roofvogelafweer nooit meer');
}

console.log('\n=== 3. Vaccins en kuren ===');
{
  const { store, db, userId, loft, birds } = world();
  const p = birds()[0];
  const m = loft.money;
  ok(vaccinate(store, userId, p.id, 'pmv', T0) === null && loft.money === m - VACCINES.pmv.price && VACCINES.pmv.price === 60, 'PMV-vaccin: €60');
  ok(!!grounded(p, T0 + DAY) && !canRace(p, db.world.currentWeek) === !!grounded(p), 'na een vaccin 2 dagen aan de grond');
  ok(grounded(p, T0 + 2.1 * DAY) === null, '…daarna weer vrij');
  ok(fendsOff(loft, p, 'Paramyxovirose', T0 + 10 * DAY, () => 0.1), 'weert PMV af (kans 80 %)');
  ok(!fendsOff(loft, p, 'Paramyxovirose', T0 + 10 * DAY, () => 0.9), '…maar niet altijd');
  ok(!fendsOff(loft, p, 'Duivenpokken', T0 + 10 * DAY, () => 0), 'beschermt niet tegen een andere ziekte');
  ok(!fendsOff(loft, p, 'Paramyxovirose', T0 + 92 * DAY, () => 0), 'na een duivenjaar (91 dagen) uitgewerkt');
  const lib = birds()[1].libido;
  vaccinate(store, userId, birds()[1].id, 'adem', T0);
  ok(Math.abs(birds()[1].libido - Math.max(0, lib - 10)) < 0.01 && grounded(birds()[1], T0 + 1) === null, 'ademhalingskuur: libido −10, mag wel vliegen');
  const m2 = loft.money;
  const res = vaccinateLoft(store, userId, 'geel', T0);
  ok(res.error === null && res.count === birds().length && loft.money === m2 - res.count * VACCINES.geel.price,
    `hele hok kuren: ${res.count} × €${VACCINES.geel.price}`);
  const again = vaccinateLoft(store, userId, 'geel', T0 + DAY);
  ok(again.error !== null && again.count === 0, 'een dag later: iedereen nog beschermd, niemand betaalt opnieuw');
  const late = vaccinateLoft(store, userId, 'geel', T0 + 6 * DAY);
  ok(late.error === null && late.count === birds().length, 'in het laatste kwart van de kuur mag hernieuwen');
  const m3 = loft.money;
  vaccinate(store, userId, p.id, 'pmv', T0); // p already had it: renewing her own is fine
  const pmvRound = vaccinateLoft(store, userId, 'pmv', T0 + DAY);
  ok(pmvRound.count === birds().length - 1 && loft.money === m3 - VACCINES.pmv.price * birds().length,
    `PMV voor het hele hok slaat de beschermde duif over (${pmvRound.count} van ${birds().length})`);
  ok(!fendsOff(loft, p, 'Ornithose', T0, () => 0.3), 'zonder ventilatie geen extra bescherming tegen ornithose');
  buyEquipment(store, userId, 'ventilation');
  ok(fendsOff(loft, p, 'Ornithose', T0, () => 0.3), 'dakventilatie: ornithose ×0,6');

  // Inschrijven wordt geweigerd met een duidelijke reden.
  ensureFlightsScheduled(db, Date.now());
  const f = db.flights.find((x) => x.status === 'scheduled' && !x.relay && !x.titan && !x.practice);
  const fresh = birds()[2];
  vaccinate(store, userId, fresh.id, 'pokken');
  if (f) ok((enterFlight(store, userId, f.id, fresh.id) ?? '').includes('ingeënt'), 'een net ingeënte duif kan niet inschrijven');
}

console.log('\n=== 4. Verzekering ===');
{
  const { store, db, userId, loft, birds } = world();
  const p = birds()[0];
  const q = insuranceQuote(db, p);
  ok(q.payout === Math.round(marketValue(db, p, db.world.currentWeek) * INSURANCE.payoutRate), 'uitkering = 60 % van de marktwaarde');
  ok(q.premium > 0 && q.premium < q.payout * 0.01, `premie per dag klein voor een jonge duif (€${q.premium})`);
  const old = { ...p, birthWeek: db.world.currentWeek - 8 * 52 } as Pigeon;
  ok(insurancePremium(old, db.world.currentWeek, q.payout) > q.premium * 5, 'een oude duif is veel duurder');
  setInsurance(store, userId, p.id, true, T0);
  const m = loft.money;
  ok(insurancePayout(db, p, 'ouderdom', T0 + 3 * DAY) === 0 && loft.money === m, 'de eerste 7 dagen: niets');
  ok(insurancePayout(db, p, 'honger', T0 + 10 * DAY) === 0, 'honger: niet gedekt');
  ok(insurancePayout(db, p, 'vlucht', T0 + 10 * DAY, { startEnergy: 3 }) === 0, 'vertrokken met minder dan 5 energie: niet gedekt');
  p.ailment = { kind: 'ziekte', name: 'Test', severity: 'ernstig', description: '', sinceWeek: 1 };
  ok(insurancePayout(db, p, 'ziekte', T0 + 10 * DAY) === 0, 'ziekte die nooit in de ziekenboeg lag: niet gedekt');
  p.ailment.boeg = true;
  ok(insurancePayout(db, p, 'ziekte', T0 + 10 * DAY) === q.payout && loft.money === m + q.payout, 'ziekte na de ziekenboeg: uitgekeerd');
  const pairs = 0;
  const withIns = dailyRunningCostBreakdown(loft, 6, 0, 0, undefined, { pairs, insurance: 1.23 });
  ok(withIns.insurance === 1.23, 'premies staan in de Dagbalans');
}

console.log('\n=== 5. Weduwschap: zie koppels.test.mts ===');

console.log('\n=== 6. Reismanden ===');
{
  const { store, db, userId, birds } = world();
  ensureFlightsScheduled(db, Date.now());
  const f = db.flights.find((x) => x.status === 'scheduled' && !x.relay && !x.practice)!;
  const p = birds()[0];
  const plain = entryMods(db, p, f, Date.parse(f.startAt));
  buyEquipment(store, userId, 'baskets');
  const mods = entryMods(db, p, f, Date.parse(f.startAt));
  ok(plain.energyMult === 1 && mods.energyMult === EQUIPMENT.baskets.energyMult && mods.healthMult === EQUIPMENT.baskets.healthMult, 'energie ×0,97, gezondheid ×0,95');
}

console.log('\n=== 7. Scout ===');
{
  // Terugkeer: de kans per dag stijgt tot 100 % op de laatste dag.
  const bronze = [1, 2, 3, 4, 5, 6, 7].map((d) => Math.round(returnChance('brons', d) * 100));
  ok(bronze[0] === 5 && bronze[1] === 10 && bronze[2] >= 19 && bronze[2] <= 22 && bronze[6] === 100, `brons per dag: ${bronze.join(' · ')} %`);
  for (const [tier, max] of [['brons', 7], ['zilver', 14], ['goud', 21]] as const) {
    const days = Array.from({ length: 4000 }, () => rollReturnDay(tier));
    const mean = days.reduce((a, b) => a + b, 0) / days.length;
    ok(Math.min(...days) >= 1 && Math.max(...days) <= max && days.some((d) => d === 1),
      `${tier}: 1 tot ${max} dagen, gemiddeld ${mean.toFixed(1)}`);
  }

  // Een wereld waarin hij iets vond (lege handen is een echte kans: probeer opnieuw).
  let w = world();
  for (let i = 0; i < 30; i++) {
    w = world();
    sendScout(w.store, w.userId, 'china', 'zilver', T0);
    if (w.loft.equipment!.scout!.offers.length === 3) break;
  }
  const { store, db, userId, loft, birds } = w;
  ok(loft.money === 50000 - SCOUT.tiers.zilver.wage, 'scout naar China (zilver): €500 loon');
  ok(sendScout(store, userId, 'taiwan', 'brons', T0) !== null, 'één opdracht tegelijk');
  const back = Date.parse(loft.equipment!.scout!.readyAt);
  ok(back - T0 >= DAY && back - T0 <= 14 * DAY, `terug na ${Math.round((back - T0) / DAY)} dag(en), binnen 14`);
  ok(scoutStatus(loft.equipment!.scout, back - 1000) === 'away' && buyScouted(store, userId, 0, back - 1000) !== null, 'onderweg: nog niets te kopen');
  const offers = loft.equipment!.scout!.offers;
  const scores = offers.map((o) => talent(o.pigeon));
  ok(offers.length === 3 && scores.every((s) => s >= 68 && s <= 82), `3 duiven, score in de band + 4 (${scores.join(', ')})`);
  ok(offers.every((o) => o.price >= marketValue(db, o.pigeon, db.world.currentWeek) * 1.8), 'China: altijd ≥ ×1,8 de marktwaarde');
  const n = birds().length;
  ok(buyScouted(store, userId, 1, back + 3600000) === null && birds().length === n + 1, 'terug: kopen lukt');
  const imp = birds().find((p) => p.care?.origin)!;
  ok(imp.care!.origin === 'Import · China' && !!imp.care!.quarantineUntil, 'herkomst + quarantaine');
  ok(!canRace(imp, db.world.currentWeek), 'in quarantaine: niet vliegen');
  ok(loft.equipment!.scout === null, 'het rapport is gesloten na de aankoop');
  ok((sendScout(store, userId, 'vs', 'brons', back + DAY) ?? '').includes('seizoen'), 'één keer per seizoen');
  db.world.seasonYear += 1;
  ok(sendScout(store, userId, 'vs', 'brons', back + DAY) === null, 'volgend seizoen weer');
  const s2 = loft.equipment!.scout!;
  const exp = Date.parse(s2.readyAt) + 49 * 3600000;
  ok(scoutStatus(s2, exp) === 'expired' && buyScouted(store, userId, 0, exp) !== null, 'na 48 u kiestijd verlopen');
  const sire = birds().find((p) => p.id !== imp.id)!;
  imp.sex = 'duivin'; sire.sex = 'doffer';
  ok((startBreeding(store, userId, sire.id, imp.id) ?? '').includes('quarantaine'), 'in quarantaine: niet koppelen');

  // Lege handen: brons zelden, goud vaak.
  const emptyShare = (tier: 'brons' | 'goud') => {
    let empty = 0;
    for (let i = 0; i < 200; i++) {
      const x = world();
      sendScout(x.store, x.userId, 'taiwan', tier, T0);
      if (x.loft.equipment!.scout!.offers.length === 0) empty += 1;
    }
    return empty / 200;
  };
  const eb = emptyShare('brons'), eg = emptyShare('goud');
  ok(eb < 0.2 && eg > 0.28 && eg < 0.52, `lege handen: brons ${Math.round(eb * 100)} %, goud ${Math.round(eg * 100)} %`);
}

console.log('\n=== 8. Vakblad ===');
{
  const { store, db, userId, birds } = world();
  const p = birds()[0];
  const r = magazineRanges(p);
  ok((['speed', 'endurance', 'orientation'] as const).every((a) => r[a][0] <= p[a] && p[a] <= r[a][1] && r[a][1] - r[a][0] <= 14), 'de bandbreedte bevat de echte waarde, ±6');
  ok(JSON.stringify(magazineRanges(p)) === JSON.stringify(r), 'en verschuift niet bij elke refresh');
  buyEquipment(store, userId, 'magazine');
  const monday = Math.floor(Date.parse('2026-10-05T12:00:00Z') / DAY); // a Monday
  tickMagazine(db, monday + 1, Date.now());
  ok(!db.notifications.some((n) => n.title.includes('Duivenblad')), 'dinsdag: geen Duivenblad');
  tickMagazine(db, monday, Date.now());
  ok(db.notifications.filter((n) => n.userId === userId && n.title.includes('Duivenblad')).length === 1, 'maandag: één Duivenblad');
  tickMagazine(db, monday, Date.now());
  ok(db.notifications.filter((n) => n.userId === userId && n.title.includes('Duivenblad')).length === 1, '…en geen dubbele bij een tweede verwerking');
}

console.log('\n=== 9. Weerstation ===');
{
  const { store, db, userId } = world();
  const now = Date.now();
  ensureFlightsScheduled(db, now);
  ok(flightsNeedingForecast(db, now).length === 0, 'zonder station: geen enkele externe ophaling');
  buyEquipment(store, userId, 'weatherStation');
  const due = flightsNeedingForecast(db, now);
  ok(due.length > 0 && due.every((d) => d.atMs - now <= 24 * 3600000), `met station: de vluchten binnen 24 u (${due.length})`);
  applyFlightForecasts(db, new Map(due.map((d) => [d.flightId, randomWeather(d.atMs)])), now);
  ok(flightsNeedingForecast(db, now + 3600000).length === 0 || due.some((d) => d.atMs - now <= 3 * 3600000), 'daarna pas na 6 u opnieuw (het laatste uur elk uur)');
}

console.log('\n=== 10. Bots ===');
{
  const { db } = world();
  for (const l of db.lofts) if (l.isBot) l.money = 20000;
  let now = T0;
  for (let d = 0; d < 2; d++) { now += DAY; for (let i = 0; i < 40; i++) tickDailyCare(db, now); }
  const bots = db.lofts.filter((l) => l.isBot);
  ok(bots.every((l) => l.equipment?.ventilation), 'rijke bots kopen dakventilatie');
  ok(bots.every((l) => (l.equipment?.hygiene ?? 0) > 60), 'en houden hun stro vers');
  ok(bots.every((l) => !l.equipment?.scout && !l.equipment?.magazine), 'geen scout, geen vakblad');
}

console.log('\n=== 11. Kunstlicht, ren en infrarood bij het kweken ===');
{
  const { store, loft } = world();
  ok(libidoTargetBonus(loft) === 0 && restBonusEnergy(loft, 4) === 4, 'zonder inrichting: zoals altijd');
  buyEquipment(store, loft.userId, 'light');
  buyEquipment(store, loft.userId, 'run');
  ok(libidoTargetBonus(loft) === 9 && restBonusEnergy(loft, 4) === 6, 'kunstlicht +6 en ren +3 libido-doel, rustbonus +6');
  const sire = { id: 's', libido: 60, form: 70, speed: 60, endurance: 60, orientation: 60, sex: 'doffer', genes: { speed: 85, endurance: 85, orientation: 85 } } as any;
  const dam = { ...sire, id: 'd', sex: 'duivin' };
  let plain = 0, heated = 0;
  for (let i = 0; i < 300; i++) {
    plain += breed(sire, dam, 'o', 100, new Set(), `pair${i}`).length === 2 ? 1 : 0;
    heated += breed(sire, dam, 'o', 100, new Set(), `pair${i}`, null, { twin: EQUIPMENT.irBoxes.twinBonus }).length === 2 ? 1 : 0;
  }
  ok(heated > plain, `infrarood: meer tweelingen (${plain} → ${heated} op 300)`);
}

console.log('\n=== 12. Niveaus: elk niveau 3× duurder, het effect ×1,5 · ×1,8 · ×2 ===');
{
  const { store, db, userId, loft, birds } = world(200000);
  const lvl = (k: Parameters<typeof equipmentLevel>[1]) => equipmentLevel(loft, k);
  ok(upgradeEquipment(store, userId, 'ventilation') !== null && lvl('ventilation') === 0, 'een niveau hoger zonder het te hebben: geweigerd');
  ok(upgradeEquipment(store, userId, 'weatherStation') !== null, 'een weerstation heeft geen niveaus');
  buyEquipment(store, userId, 'ventilation');
  ok(lvl('ventilation') === 1, 'gekocht = niveau 1');
  const prices: number[] = [];
  for (let n = 2; n <= EQUIPMENT_LEVELS.maxLevel; n++) {
    const m = loft.money;
    ok(upgradeEquipment(store, userId, 'ventilation') === null && lvl('ventilation') === n, `naar niveau ${n}`);
    prices.push(m - loft.money);
  }
  ok(prices.join('/') === '3600/10800/32400', `prijzen niveau 2–4: €${prices.map((p) => p.toLocaleString('nl-BE')).join(' / €')} (×3 per niveau)`);
  ok(upgradeEquipment(store, userId, 'ventilation') !== null && lvl('ventilation') === 4, 'niveau 5 bestaat niet');

  // Effects at each level, from the same numbers the page shows.
  const p = birds()[0];
  const atLevel = (n: number) => { loft.equipment = { ...loft.equipment!, levels: { ...loft.equipment!.levels, ventilation: n } }; };
  atLevel(1);
  ok(!fendsOff(loft, p, 'Ornithose', T0, () => 0.55), 'ventilatie niveau 1: 40 % — een trekking van 0,55 slaagt niet');
  atLevel(2);
  ok(fendsOff(loft, p, 'Ornithose', T0, () => 0.55) && Math.abs(feedHealthMult(loft) - 1.075) < 1e-9, 'niveau 2: 60 % afgeweerd, +7,5 % herstel');
  atLevel(4);
  const full = hygieneDecay({ ...loft, equipment: { ...loft.equipment!, ventilation: false } }, birds());
  ok(Math.abs(hygieneDecay(loft, birds()) - full * 0.5) < 1e-9, 'niveau 4: de hygiëne zakt half zo snel (×0,5)');

  buyEquipment(store, userId, 'baskets');
  upgradeEquipment(store, userId, 'baskets'); upgradeEquipment(store, userId, 'baskets');
  const f = { id: 'f', practice: true, startAt: new Date().toISOString() } as unknown as Flight; // a practice flight: no weduwschap to weigh
  const mods = entryMods(db, p, f, Date.now());
  ok(Math.abs(mods.energyMult - (1 - 0.03 * 1.8)) < 1e-9 && Math.abs(mods.healthMult - (1 - 0.05 * 1.8)) < 1e-9,
    `reismanden niveau 3: ×${mods.energyMult.toFixed(3)} energie, ×${mods.healthMult.toFixed(3)} gezondheid`);

  buyEquipment(store, userId, 'run');
  buyEquipment(store, userId, 'light');
  for (let i = 0; i < 3; i++) upgradeEquipment(store, userId, 'light');
  upgradeEquipment(store, userId, 'run');
  ok(libidoTargetBonus(loft) === 12 + 4.5, `kunstlicht niveau 4 (+12) + ren niveau 2 (+4,5): libido +${libidoTargetBonus(loft)}`);
  ok(restBonusEnergy(loft, 4) === 7, 'ren niveau 2: +7 i.p.v. +4 energie op een rustdag');

  buyIrBox(store, userId);
  upgradeEquipment(store, userId, 'irBoxes'); upgradeEquipment(store, userId, 'irBoxes');
  const ir = irBoxEffect(loft);
  ok(Math.abs(ir.hatchSpeed - 1.27) < 1e-9 && Math.abs(ir.twin - 0.108) < 1e-9, 'infrarood niveau 3: 27 % sneller uit, +10,8 % tweelingkans');

  const L = inrichtingLevels();
  ok(L.ventilation.length === 4 && L.ventilation[3].benefit.includes('80 %') && L.ventilation[3].price === 32400,
    `de pagina kent elk niveau: "${L.ventilation[3].benefit}" — €${L.ventilation[3].price.toLocaleString('nl-BE')}`);
  ok(L.baskets[1].benefit.includes('4,5 %'), `kommagetal waar het telt: "${L.baskets[1].benefit}"`);
}

if (fail > 0) { console.log(`\n${fail} mislukt`); process.exitCode = 1; }
else console.log('\nalles groen');
