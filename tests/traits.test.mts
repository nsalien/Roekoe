/**
 * Kenmerken (seizoen 3) — wat de test bewaakt:
 *  - verdeling: ~30 % van de nieuwe duiven heeft een kenmerk, ~80/20 gewoon/zeldzaam;
 *  - overerving: 35 % per ouder, 60 % als beide ouders hetzelfde kenmerk hebben;
 *  - migratie v55: geseed (twee runs = identiek), raakt duiven met een kenmerk
 *    niet, en een tweede run doet niets;
 *  - statische kenmerken tellen enkel als hun voorwaarde geldt;
 *  - de zon: bekende zonsopgangen/-ondergangen in Brussel, en een Nachtvlieger
 *    die vóór zonsondergang vertrekt krijgt haar bonus ENKEL op het donkere stuk;
 *  - buren: een Sociale duif in een dicht peloton heeft gezelschap, een Eenzaat
 *    die het peloton ver achter zich laat vliegt alleen;
 *  - tweeling-duel: in haar eigen situatie wint een duif met kenmerk ~70–75 % van
 *    de duels tegen een identieke duif zonder; erbuiten ~50 %;
 *  - een duif zonder kenmerk krijgt exact hetzelfde profiel als vóór seizoen 3.
 *
 * Run: npx tsx tests/traits.test.mts
 */
import { startLiveFlight, finalizeFlight, type Entry } from '../core/game/flight.js';
import { inheritTrait, rollTrait, staticTraitActive, sunTimes, sunAltitudeDeg } from '../core/game/traits.js';
import { runDataMigrations } from '../core/game/schedule.js';
import { seedWorld } from '../core/game/engine.js';
import { MemoryStore } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Flight, Pigeon, SimEntry } from '../core/schema.js';
import { CITY_COORDS, PIGEON_TRAITS, traitById } from '../core/config/gameConfig.js';
import { seededRng } from '../core/game/util.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

const WEEK = 400;
/** `q` = the quality of the bird on every axis (speed, endurance, orientation,
 *  experience), so a "better" bird really is better, not just faster. */
const mk = (id: string, trait: string | null = null, q = 75): Pigeon => ({
  id, ownerId: `o_${id}`, name: id, sex: 'doffer', birthWeek: WEEK - 60,
  speed: q, endurance: q, orientation: q,
  libido: 60, form: 90, health: 100, experience: q - 15,
  sireId: null, damId: null, forSale: false, price: null,
  createdAtWeek: WEEK - 60, ailment: null, inInfirmary: false, races: 20,
  everAiled: false, coached: false, ration: 'normal', compartment: false,
  hungerDays: 0, restDays: 0,
  genes: { speed: 95, endurance: 95, orientation: 95 }, declineRate: 1,
  trait,
} as unknown as Pigeon);

interface W { label: string; factor: number; along?: number; rain?: boolean; tempC?: number }
function race(id: string, from: string, to: string, km: number, startAt: string, ps: Pigeon[], w: W): Flight {
  const f = {
    id, name: 't', type: 'regional', fromCity: from, toCity: to, distanceKm: km,
    startAt, status: 'scheduled', entries: [], results: [], sim: [],
  } as unknown as Flight;
  const entries: Entry[] = ps.map((p) => ({ pigeon: p, ownerName: p.ownerId }));
  f.entries = entries.map((e) => ({ pigeonId: e.pigeon.id, ownerId: e.pigeon.ownerId })) as never;
  startLiveFlight(f, entries, WEEK, w as never);
  return f;
}
const simOf = (f: Flight, id: string) => f.sim.find((s) => s.pigeonId === id) as SimEntry;

// --- 1. Verdeling -----------------------------------------------------------------
console.log('Verdeling');
{
  const rng = seededRng(12345);
  const N = 20000;
  let any = 0, rare = 0;
  const seen = new Set<string>();
  for (let i = 0; i < N; i++) {
    const t = rollTrait(rng);
    if (!t) continue;
    any++;
    seen.add(t);
    if (traitById(t)!.rarity === 'zeldzaam') rare++;
  }
  ok(Math.abs(any / N - 0.3) < 0.015, `~30 % met kenmerk (${pct(any / N)})`);
  ok(Math.abs(rare / any - 0.2) < 0.02, `~20 % daarvan zeldzaam (${pct(rare / any)})`);
  ok(seen.size === PIGEON_TRAITS.length, `alle ${PIGEON_TRAITS.length} kenmerken komen voor (${seen.size})`);
}

// --- 2. Overerving ----------------------------------------------------------------
console.log('Overerving');
{
  const rng = seededRng(777);
  const N = 20000;
  let same = 0, one = 0;
  for (let i = 0; i < N; i++) {
    if (inheritTrait({ trait: 'night' }, { trait: 'night' }, rng) === 'night') same++;
    if (inheritTrait({ trait: 'night' }, { trait: null }, rng) === 'night') one++;
  }
  // Plus the small chance the fallback roll lands on the same trait.
  ok(same / N > 0.58 && same / N < 0.66, `beide ouders hetzelfde → ~60 % (${pct(same / N)})`);
  ok(one / N > 0.33 && one / N < 0.40, `één ouder → ~35 % (${pct(one / N)})`);
}

// --- 3. Migratie v55 --------------------------------------------------------------
console.log('Migratie v55');
{
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const a = store.data;
  const run = () => {
    a.pigeons.forEach((p, i) => { p.trait = i === 0 ? 'fond' : null; });
    a.world.dataVersion = 54;
    runDataMigrations(a);
    return a.pigeons.map((p) => p.trait ?? null);
  };
  const ta = run(), tb = run();
  ok(a.world.dataVersion! >= 55, 'dataVersion staat op 55');
  ok(a.pigeons.length > 20 && ta.some((t) => t), `duiven kregen een kenmerk (${ta.filter((t) => t).length}/${ta.length})`);
  ok(JSON.stringify(ta) === JSON.stringify(tb), 'geseed: dezelfde duif krijgt telkens hetzelfde (twee runs identiek)');
  ok(a.pigeons[0].trait === 'fond', 'een duif met een kenmerk blijft onaangeroerd');
  const before = JSON.stringify(a.pigeons.map((p) => p.trait));
  runDataMigrations(a);
  ok(before === JSON.stringify(a.pigeons.map((p) => p.trait)), 'tweede run doet niets');
}

// --- 4. Statische kenmerken ---------------------------------------------------------
console.log('Statische kenmerken');
{
  ok(staticTraitActive('sprint', 150, {}) && !staticTraitActive('sprint', 250, {}), 'Sprinter: 150 km wel, 250 km niet');
  ok(staticTraitActive('fond', 650, {}) && !staticTraitActive('fond', 500, {}), 'Fondvogel: 650 km wel, 500 km niet');
  ok(staticTraitActive('tailwind', 300, { along: 12 }) && !staticTraitActive('tailwind', 300, { along: -12 }), 'Snelle flapper enkel bij rugwind');
  ok(staticTraitActive('headwind', 300, { along: -12 }) && !staticTraitActive('headwind', 300, { along: 3 }), 'Stormbreker enkel bij tegenwind');
  ok(staticTraitActive('fair', 300, { along: 2, rain: false }) && !staticTraitActive('fair', 300, { along: 2, rain: true }), 'Mooiweervlieger: kalm en droog');
  ok(staticTraitActive('cold', 300, { tempC: 6 }) && !staticTraitActive('cold', 300, { tempC: 14 }), 'Koudevlieger onder 10 °C');
  ok(staticTraitActive('warm', 300, { tempC: 14 }) && !staticTraitActive('warm', 300, { tempC: 6 }), 'Zomervogel vanaf 10 °C');
  ok(!staticTraitActive('tailwind', 300, {}), 'onbekend weer telt nooit');

  // In a race: the bonus shows up in the sim, and only when the condition holds.
  const w = { label: 'x', factor: 1, along: 0, rain: false, tempC: 15 };
  const f1 = race('st1', 'Reims', 'Brussel', 150, '2026-06-10T08:00:00Z', [mk('a', 'sprint'), mk('b')], w);
  const f2 = race('st2', 'Reims', 'Brussel', 250, '2026-06-10T08:00:00Z', [mk('a', 'sprint'), mk('b')], w);
  ok(simOf(f1, 'a').traitShare === 1 && (simOf(f1, 'a').traitWindows ?? []).length === 1, 'Sprinter op 150 km: bonus op de hele vlucht');
  ok(!simOf(f2, 'a').traitShare, 'Sprinter op 250 km: geen bonus');
  ok(simOf(f1, 'b').trait === undefined, 'een duif zonder kenmerk draagt niets in de sim');
}

// --- 5. De zon ----------------------------------------------------------------------
console.log('Zon');
{
  const bx = CITY_COORDS['Brussel'];
  const hhmm = (iso: string | null) => iso
    ? new Date(iso).toLocaleTimeString('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })
    : '—';
  const dec = sunTimes(bx.lat, bx.lon, Date.parse('2026-12-21T12:00:00Z'));
  const jun = sunTimes(bx.lat, bx.lon, Date.parse('2026-06-21T12:00:00Z'));
  const mins = (iso: string | null) => { const [h, m] = hhmm(iso).split(':').map(Number); return h * 60 + m; };
  ok(Math.abs(mins(dec.set) - (16 * 60 + 40)) <= 5, `Brussel 21 dec: zonsondergang ≈ 16:40 (${hhmm(dec.set)})`);
  ok(Math.abs(mins(dec.rise) - (8 * 60 + 44)) <= 5, `Brussel 21 dec: zonsopgang ≈ 08:44 (${hhmm(dec.rise)})`);
  ok(Math.abs(mins(jun.set) - (22 * 60)) <= 5, `Brussel 21 jun: zonsondergang ≈ 22:00 (${hhmm(jun.set)})`);
  ok(Math.abs(mins(jun.rise) - (5 * 60 + 29)) <= 5, `Brussel 21 jun: zonsopgang ≈ 05:29 (${hhmm(jun.rise)})`);

  // A Nachtvlieger released at 14:00 on 21 December over ~500 km: she lands well
  // after dark, and only the dark part counts.
  const from = 'Reims', to = 'Brussel';
  const start = '2026-12-21T13:00:00Z';
  const w = { label: 'x', factor: 1, along: 0, rain: false, tempC: 4 };
  const f = race('sun1', from, to, 500, start, [mk('n', 'night'), mk('d', 'day'), mk('x')], w);
  const n = simOf(f, 'n'), d = simOf(f, 'd');
  const startMs = Date.parse(start);
  const firstDark = startMs + (n.traitWindows?.[0]?.[0] ?? 0) * 1000;
  const setTo = Date.parse(sunTimes(bx.lat, bx.lon, startMs).set!);
  const segSeconds = n.durationSeconds / 10;
  ok((n.traitShare ?? 0) > 0 && (n.traitShare ?? 0) < 1, `Nachtvlieger: bonus op een deel van de vlucht (${pct(n.traitShare ?? 0)})`);
  ok((n.traitWindows?.[0]?.[0] ?? 0) > 0, 'Nachtvlieger: niet vanaf de lossing');
  ok(Math.abs(firstDark - setTo) < 2 * segSeconds * 1000 + 30 * 60000,
    `Nachtvlieger: de bonus begint rond zonsondergang (${new Date(firstDark).toISOString().slice(11, 16)} UTC)`);
  ok(sunAltitudeDeg(bx.lat, bx.lon, startMs + n.durationSeconds * 1000) < 0, 'ze landt in het donker');
  ok(Math.abs((n.traitShare ?? 0) + (d.traitShare ?? 0) - 1) < 0.12,
    `Dag- en Nachtvlieger vullen elkaar aan (${pct(d.traitShare ?? 0)} + ${pct(n.traitShare ?? 0)})`);
  ok(n.durationSeconds < simOf(f, 'x').durationSeconds * 1.2, 'profiel blijft redelijk');
}

// --- 6. Buren -----------------------------------------------------------------------
console.log('Buren');
{
  const w = { label: 'x', factor: 1, along: 0, rain: false, tempC: 15 };
  const pack = Array.from({ length: 30 }, (_, i) => mk(`p${i}`, null, 45));
  // A social bird of the same class flies inside the bunch; a much faster loner
  // runs away from it.
  const f = race('nb1', 'Reims', 'Brussel', 300, '2026-06-10T08:00:00Z',
    [...pack, mk('soc', 'social', 45), mk('lon', 'loner', 99), mk('lon2', 'loner', 45)], w);
  const soc = simOf(f, 'soc'), lon = simOf(f, 'lon'), lon2 = simOf(f, 'lon2');
  ok((soc.traitShare ?? 0) > 0.5, `Sociale duif in het peloton: gezelschap op het grootste deel (${pct(soc.traitShare ?? 0)})`);
  ok((lon.traitShare ?? 0) > (lon2.traitShare ?? 0), `weggelopen Eenzaat vliegt vaker alleen dan eentje in het peloton (${pct(lon.traitShare ?? 0)} vs ${pct(lon2.traitShare ?? 0)})`);
  // Alone in the race: nobody to fly with — the social bird gets nothing, the
  // loner everything.
  const g = race('nb2', 'Reims', 'Brussel', 300, '2026-06-10T08:00:00Z', [mk('soc', 'social'), mk('lon', 'loner', 99)], w);
  ok(!simOf(g, 'soc').traitShare, 'Sociale duif zonder gezelschap: geen bonus');
  ok((simOf(g, 'lon').traitShare ?? 0) > 0.5, `Eenzaat zonder gezelschap: bonus (${pct(simOf(g, 'lon').traitShare ?? 0)})`);
}

// --- 6b. Estafette: kenmerken per etappe -------------------------------------------
console.log('Estafette');
{
  const legKm = 150;
  const birds: Pigeon[] = [];
  const entries: unknown[] = [];
  for (let t = 0; t < 8; t++) {
    for (let l = 1; l <= 3; l++) {
      const p = mk(`r${t}_${l}`, l === 1 ? 'sprint' : l === 2 ? 'social' : null);
      p.ownerId = `usr_${t}`;
      birds.push(p);
      entries.push({ pigeonId: p.id, pigeonName: p.name, ownerId: p.ownerId, ownerName: `Hok ${t}`, leg: l });
    }
  }
  const f = {
    id: 'relay_tr', name: 'Estafette', type: 'international', fromCity: 'Reims', toCity: 'Brussel',
    distanceKm: legKm * 3, startAt: '2026-06-10T08:00:00Z', status: 'scheduled',
    weather: 'x', weatherFactor: 1, relay: true, teamSize: 3,
    legs: [1, 2, 3].map((i) => ({ index: i, fromName: `P${i}`, toName: `P${i + 1}`, distanceKm: legKm, weather: 'x', weatherFactor: 1 })),
    entries, sim: [], results: [],
  } as unknown as Flight;
  startLiveFlight(f, birds.map((p) => ({ pigeon: p, ownerName: 'Hok' })) as Entry[], WEEK, undefined);
  const leg1 = f.sim.filter((s) => s.pigeonId.endsWith('_1'));
  const leg2 = f.sim.filter((s) => s.pigeonId.endsWith('_2'));
  ok(f.sim.length === 24, 'alle 24 duiven hebben een profiel');
  ok(leg1.every((s) => s.traitShare === 1), 'Sprinter op een etappe van 150 km: bonus op haar hele etappe');
  ok(leg2.some((s) => (s.traitShare ?? 0) > 0), 'Sociale duif in de tweede etappe vindt gezelschap');
}

// --- 7. Tweeling-duel ---------------------------------------------------------------
console.log('Tweeling-duel');
{
  const N = Number(process.env.DUELS ?? 1500);
  const w = { label: 'x', factor: 1, along: 0, rain: false, tempC: 15 };
  const duel = (km: number) => {
    let win = 0, n = 0;
    for (let i = 0; i < N; i++) {
      const a = mk(`a${i}`, 'sprint'), b = mk(`b${i}`);
      const f = race(`du${km}_${i}`, 'Reims', 'Brussel', km, '2026-06-10T08:00:00Z', [a, b], w);
      finalizeFlight(f, [a, b]);
      const ra = f.results.find((r) => r.pigeonId === a.id)!, rb = f.results.find((r) => r.pigeonId === b.id)!;
      if (!ra.finished || !rb.finished) continue;
      n++;
      if (ra.rank < rb.rank) win++;
    }
    return win / n;
  };
  const inSit = duel(150), outSit = duel(250);
  ok(inSit > 0.62 && inSit < 0.82, `in haar situatie wint ze ~70–75 % (${pct(inSit)})`);
  ok(Math.abs(outSit - 0.5) < 0.06, `buiten haar situatie ~50 % (${pct(outSit)})`);
}

// --- 8. Geen kenmerk = profiel onveranderd ------------------------------------------
console.log('Geen kenmerk');
{
  const w = { label: 'x', factor: 1, along: 15, rain: false, tempC: 15 };
  const f1 = race('same', 'Reims', 'Brussel', 300, '2026-06-10T08:00:00Z', [mk('a'), mk('b')], w);
  const f2 = race('same', 'Reims', 'Brussel', 300, '2026-06-10T08:00:00Z', [mk('a'), mk('b', 'tailwind')], w);
  ok(simOf(f1, 'a').durationSeconds === simOf(f2, 'a').durationSeconds, 'een duif zonder kenmerk: identiek, wat haar rivaal ook heeft');
  ok(simOf(f2, 'b').durationSeconds < simOf(f1, 'b').durationSeconds, 'dezelfde duif mét Snelle flapper bij rugwind is sneller');
}

console.log(`\n${pass} ok, ${fail} fout`);
if (fail) process.exit(1);
