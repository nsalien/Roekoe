/**
 * Regressietest: "nee is nee" bij een slechtere concurrent-sponsor.
 *
 * Weiger je een sponsor die in dezelfde sector zit als een sponsor die je al
 * hebt (overstappen kost dus een opzegboete) én die MINDER betaalt, dan is dat
 * een definitieve nee: die sponsor biedt nooit meer aan. Elke andere weigering
 * blijft tijdelijk — daar mag de sponsor na de afkoelperiode terugkomen.
 *
 * Bewust NIET definitief: een concurrent die méér betaalt. Die weiger je
 * misschien alleen omdat de opzegboete er vandaag niet in zit, en de beste
 * sponsor van een sector voorgoed wegsluiten zou een val zijn.
 *
 * Run: npx tsx sponsor-refusal.test.mts
 */
import {
  applyAcceptSponsor,
  applyRefuseSponsor,
  evaluateSponsorOffers,
  sponsorView,
} from './core/game/sponsors.js';
import { SPONSORS, SPONSOR_REOFFER_COOLDOWN_HOURS } from './core/config/gameConfig.js';
import type { Database, Loft } from './core/schema.js';
import { emptySponsorState } from './core/schema.js';

let fails = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fails++;
};

/** Two sponsors in the same category, so one is a competitor of the other. */
function pairInSameCategory() {
  const byCat = new Map<string, typeof SPONSORS[number][]>();
  for (const s of SPONSORS) {
    const list = byCat.get(s.category) ?? [];
    list.push(s);
    byCat.set(s.category, list);
  }
  for (const [, list] of byCat) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => a.dailyStipend - b.dailyStipend);
    const worse = sorted[0];
    const better = sorted[sorted.length - 1];
    if (worse.dailyStipend < better.dailyStipend) return { worse, better };
  }
  return null;
}

function makeLoft(): { db: Database; loft: Loft } {
  const loft = {
    userId: 'usr_1', name: 'Testhok', money: 100000, capacity: 8, compartments: 0,
    food: { normal: 50, premium: 0, libido: 0, herstel: 0 },
    doctors: 0, physios: 0, medicatedFood: false, infirmaryCapacity: 2,
    isBot: false, seasonPoints: 500, coachedCount: 0,
    sponsorship: emptySponsorState(),
    stats: { wins: 5, gold: 3, silver: 1, bronze: 1, races: 40, entries: 40, level: 8 },
  } as unknown as Loft;
  const db = {
    lofts: [loft], pigeons: [], users: [{ id: 'usr_1', username: 't' }],
    notifications: [], flights: [], world: { currentWeek: 60 },
  } as unknown as Database;
  return { db, loft };
}

/** Put `id` on the table as a pending offer with the given terms. */
function offer(loft: Loft, id: string, dailyStipend: number, podiumBase: number) {
  const st = (loft.sponsorship as any);
  st.offers = st.offers.filter((o: any) => o.id !== id);
  st.offers.push({ id, at: new Date().toISOString(), signingBonus: 0, dailyStipend, podiumBase });
}

const pair = pairInSameCategory();
if (!pair) {
  console.log('Geen twee sponsors in dezelfde categorie gevonden — test niet uitvoerbaar.');
  process.exit(1);
}
const { worse, better } = pair;
console.log(`Sector "${worse.categoryLabel}": ${better.name} (€${better.dailyStipend}/dag) vs ${worse.name} (€${worse.dailyStipend}/dag)\n`);

console.log('Een SLECHTERE concurrent weigeren is definitief');
{
  const { db, loft } = makeLoft();
  offer(loft, better.id, better.dailyStipend, better.podiumBase);
  applyAcceptSponsor(db, loft, better.id, false);
  ok('de betere sponsor is actief', (loft.sponsorship as any).active.some((a: any) => a.id === better.id));

  offer(loft, worse.id, worse.dailyStipend, worse.podiumBase);
  const view = sponsorView(db, loft);
  const shown = view.offers.find((o) => o.id === worse.id)!;
  ok('de pagina waarschuwt vooraf', shown.refusalIsFinal === true, `conflict met ${shown.conflictWith}`);

  const msg = applyRefuseSponsor(db, loft, worse.id);
  ok('de melding zegt dat ze niet terugkomen', msg.includes('niet meer terug'), msg);
  const d = (loft.sponsorship as any).declined.find((x: any) => x.id === worse.id);
  ok('de weigering is als definitief bewaard', d?.permanent === true);

  // Ver voorbij de afkoelperiode: hij mag nog steeds niet terugkomen.
  const later = Date.now() + (SPONSOR_REOFFER_COOLDOWN_HOURS + 500) * 3600000;
  let reoffered = false;
  for (let i = 0; i < 40; i++) {
    (loft.sponsorship as any).lastOfferAt = undefined;
    evaluateSponsorOffers(db, loft, later + i * 86400000);
    if ((loft.sponsorship as any).offers.some((o: any) => o.id === worse.id)) reoffered = true;
  }
  ok('biedt na 40 kansen nooit meer aan', !reoffered);
}

console.log('\nEen BETERE concurrent weigeren blijft tijdelijk');
{
  const { db, loft } = makeLoft();
  offer(loft, worse.id, worse.dailyStipend, worse.podiumBase);
  applyAcceptSponsor(db, loft, worse.id, false);

  offer(loft, better.id, better.dailyStipend, better.podiumBase);
  const shown = sponsorView(db, loft).offers.find((o) => o.id === better.id)!;
  ok('de pagina meldt het conflict maar niet "definitief"', shown.conflictWith != null && shown.refusalIsFinal === false);

  const msg = applyRefuseSponsor(db, loft, better.id);
  ok('de melding houdt de deur open', msg.includes('Misschien'), msg);
  const d = (loft.sponsorship as any).declined.find((x: any) => x.id === better.id);
  ok('niet als definitief bewaard', !d?.permanent);
}

console.log('\nZonder concurrent blijft een weigering gewoon tijdelijk');
{
  const { db, loft } = makeLoft();
  offer(loft, worse.id, worse.dailyStipend, worse.podiumBase);
  const shown = sponsorView(db, loft).offers.find((o) => o.id === worse.id)!;
  ok('geen conflict gemeld', shown.conflictWith === null && shown.refusalIsFinal === false);
  applyRefuseSponsor(db, loft, worse.id);
  const d = (loft.sponsorship as any).declined.find((x: any) => x.id === worse.id);
  ok('niet definitief', !d?.permanent);
}

console.log('\nEen gelijkwaardig aanbod telt ook als "niet beter"');
{
  const { db, loft } = makeLoft();
  offer(loft, better.id, better.dailyStipend, better.podiumBase);
  applyAcceptSponsor(db, loft, better.id, false);
  // Zelfde bedragen: overstappen kost enkel de boete, dus geen reden.
  offer(loft, worse.id, better.dailyStipend, better.podiumBase);
  const shown = sponsorView(db, loft).offers.find((o) => o.id === worse.id)!;
  ok('gelijk aanbod = definitieve weigering', shown.refusalIsFinal === true);
}

console.log('\nDe vlag overleeft het opnieuw inlezen van de opgeslagen staat');
{
  const { db, loft } = makeLoft();
  offer(loft, better.id, better.dailyStipend, better.podiumBase);
  applyAcceptSponsor(db, loft, better.id, false);
  offer(loft, worse.id, worse.dailyStipend, worse.podiumBase);
  applyRefuseSponsor(db, loft, worse.id);
  // Zoals de D1-rit: naar JSON en terug.
  loft.sponsorship = JSON.parse(JSON.stringify(loft.sponsorship));
  sponsorView(db, loft); // dwingt state() af, die opnieuw parst
  const d = (loft.sponsorship as any).declined.find((x: any) => x.id === worse.id);
  ok('permanent blijft staan na JSON-ronde', d?.permanent === true);
}

console.log(fails === 0 ? '\nAlles OK' : `\n${fails} FOUT(EN)`);
process.exitCode = fails === 0 ? 0 : 1;
