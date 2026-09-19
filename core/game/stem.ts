/**
 * DE STEM — de ideeënbus.
 *
 * Elk seizoen komt er één nieuwe feature bij, en de spelers kiezen samen welke.
 * Dit bestand houdt alleen de REGELS van dat bord: wat een geldig idee of een
 * geldige reactie is, hoe het bord gesorteerd wordt, en welke vier ideeën er van
 * bij de start op staan.
 *
 * ⚠️ Geen databank hier. De rijen zelf worden gelezen en geschreven door
 * `loadStemBoard`/`loadStemThread`/`insertStemIdea`/… in `core/d1.ts`, want ze
 * staan buiten de wereldload (zie `StemIdea` in schema.ts). Die scheiding is met
 * opzet: zo blijven de regels testbaar zonder databank.
 */

import { STEM } from '../config/gameConfig.js';
import type { Database, StemComment, StemIdea, StemStatus } from '../schema.js';

/** Hoe een status op het bord leest. */
export const STEM_STATUS_LABELS: Record<StemStatus, string> = {
  open: 'In stemming',
  gepland: 'Gepland',
  uitgevoerd: 'In het spel',
  afgewezen: 'Niet weerhouden',
};

export const STEM_STATUSES = Object.keys(STEM_STATUS_LABELS) as StemStatus[];

export function isStemStatus(v: string): v is StemStatus {
  return (STEM_STATUSES as string[]).includes(v);
}

/**
 * Wat er van een ingetypt veld overblijft. Witruimte wordt COLLAPSED, niet enkel
 * getrimd: anders haalt een titel van vijf spaties de minimumlengte en staat er
 * een lege regel op het bord.
 */
export function cleanText(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/** Zelfde, maar met behoud van alinea's — voor de lange tekstvakken. */
export function cleanBody(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Foutmelding (Nederlands) of `null` als het idee mag. */
export function validateIdea(title: string, body: string): string | null {
  if (title.length < STEM.titleMin) return `Geef je idee een titel van minstens ${STEM.titleMin} tekens.`;
  if (title.length > STEM.titleMax) return `De titel mag hoogstens ${STEM.titleMax} tekens lang zijn.`;
  if (body.length < STEM.bodyMin) return `Leg je idee wat uit — minstens ${STEM.bodyMin} tekens.`;
  if (body.length > STEM.bodyMax) return `Je uitleg mag hoogstens ${STEM.bodyMax} tekens lang zijn.`;
  return null;
}

/** Foutmelding (Nederlands) of `null` als de reactie mag. */
export function validateComment(body: string): string | null {
  if (body.length < STEM.commentMin) return 'Schrijf eerst iets.';
  if (body.length > STEM.commentMax) return `Een reactie mag hoogstens ${STEM.commentMax} tekens lang zijn.`;
  return null;
}

/** Eén idee zoals de pagina het toont: de rij plus de tellingen errond. */
export interface StemIdeaView extends StemIdea {
  votes: number;
  comments: number;
  /** Heeft de kijker zelf gestemd? */
  voted: boolean;
  /** Is de kijker de indiener? */
  mine: boolean;
}

/** De draad onder één idee. */
export interface StemThreadView {
  idea: StemIdeaView;
  comments: StemComment[];
}

/**
 * Bordvolgorde: eerst wat nog in stemming is (daar gaat de pagina over), dan
 * gepland/uitgevoerd, en afgewezen onderaan. Binnen een groep telt het aantal
 * stemmen, en bij gelijke stand het jongste idee eerst — zo krijgt een vers idee
 * de kans om gezien te worden in plaats van onder de klassiekers te verdwijnen.
 */
const STATUS_ORDER: Record<StemStatus, number> = { open: 0, gepland: 1, uitgevoerd: 2, afgewezen: 3 };

export function sortIdeas(ideas: StemIdeaView[]): StemIdeaView[] {
  return [...ideas].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    if (b.votes !== a.votes) return b.votes - a.votes;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

// ---------------------------------------------------------------------------
// Beheerdersweergave: wie stemde op wat
// ---------------------------------------------------------------------------
/**
 * Eén stem, met de naam erbij. De naam wordt opgezocht bij het bouwen van het
 * rapport en niet bij het stemmen zelf: zo leest een hernoemd hok meteen onder
 * zijn nieuwe naam, in plaats van onder de naam die het droeg toen het stemde.
 */
export interface StemVoter {
  userId: string;
  name: string;
  at: string;
}

export interface StemVoterReport {
  /** Per idee wie erop stemde (nieuwste stem eerst). Alle ideeën, ook de nul-stemmers. */
  perIdea: { ideaId: string; title: string; status: StemStatus; voters: StemVoter[] }[];
  /** Per speler waarop hij stemde — ÓÓK de spelers die nog niets stemden. */
  perPlayer: { userId: string; name: string; ideas: { ideaId: string; title: string; at: string }[] }[];
  /** Hoeveel spelers al minstens één keer stemden, op hoeveel in totaal. */
  voted: number;
  players: number;
}

/**
 * Het stemrapport voor de beheerder, uit de rauwe stemrijen.
 *
 * Twee keuzes die het rapport bruikbaar maken in plaats van alleen correct:
 *  - **elk idee staat erin, ook met nul stemmen** — een idee waar niemand op
 *    stemt is precies wat de beheerder wil zien;
 *  - **elke speler staat erin, ook wie niets stemde**. Wie zwijgt is hier de
 *    interessante informatie, en die valt weg zodra je alleen de stemmen groepeert.
 *
 * Een stem van een speler die intussen verdwenen is (hok gewist) houdt zijn
 * userId als naam, zodat het aantal blijft kloppen met de teller op het bord.
 */
export function buildVoterReport(
  votes: readonly { ideaId: string; userId: string; at: string }[],
  ideas: readonly Pick<StemIdea, 'id' | 'title' | 'status'>[],
  players: readonly { userId: string; name: string }[],
): StemVoterReport {
  const nameOf = new Map(players.map((p) => [p.userId, p.name]));
  const known = new Set(ideas.map((i) => i.id));
  const byIdea = new Map<string, StemVoter[]>(ideas.map((i) => [i.id, []]));
  const byPlayer = new Map<string, { ideaId: string; title: string; at: string }[]>(
    players.map((p) => [p.userId, []]),
  );
  const titleOf = new Map(ideas.map((i) => [i.id, i.title]));

  for (const v of votes) {
    // Een stem op een idee buiten het geladen bord (ouder dan `ideaLoadLimit`)
    // hoort nergens thuis in dit overzicht — overslaan i.p.v. een lege rij tonen.
    if (!known.has(v.ideaId)) continue;
    byIdea.get(v.ideaId)!.push({ userId: v.userId, name: nameOf.get(v.userId) ?? v.userId, at: v.at });
    const mine = byPlayer.get(v.userId);
    const entry = { ideaId: v.ideaId, title: titleOf.get(v.ideaId)!, at: v.at };
    if (mine) mine.push(entry);
    else byPlayer.set(v.userId, [entry]); // stem van een hok dat er niet meer is
  }

  const perIdea = ideas.map((i) => ({
    ideaId: i.id,
    title: i.title,
    status: i.status,
    voters: byIdea.get(i.id)!.sort((a, b) => b.at.localeCompare(a.at)),
  }));
  const perPlayer = [...byPlayer.entries()]
    .map(([userId, list]) => ({
      userId,
      name: nameOf.get(userId) ?? userId,
      ideas: list.sort((a, b) => b.at.localeCompare(a.at)),
    }))
    // Meeste stemmen eerst, dan op naam — zo staan de stille spelers samen onderaan.
    .sort((a, b) => (b.ideas.length - a.ideas.length) || a.name.localeCompare(b.name));

  return {
    perIdea,
    perPlayer,
    voted: perPlayer.filter((p) => p.ideas.length > 0).length,
    players: perPlayer.length,
  };
}

/**
 * De vier ideeën waarmee het bord opent.
 *
 * Ze krijgen een VASTE id, zodat het zaaien idempotent is (`INSERT OR IGNORE`):
 * twee gelijktijdige eerste bezoeken zetten samen precies deze vier rijen neer.
 * `authorId` is leeg — ze komen van de spelleiding, niet van een speler, en
 * zonder eigenaar kan niemand ze bewerken of verwijderen.
 */
export const SEED_IDEAS: readonly Omit<StemIdea, 'createdAt'>[] = [
  {
    id: 'stem_lenen',
    title: '🏦 Lenen bij de bank',
    body:
      'Spelers kunnen vrij een bedrag lenen bij de bank, met een limiet op hoeveel je open ' +
      'kan hebben staan. Je betaalt dagelijks af, met rente. Zo kan een speler met minder ' +
      'geld toch meebieden op een dure duif — maar wie te veel leent, zit vast aan een ' +
      'dagelijkse afbetaling bovenop zijn onkosten.',
    authorId: '',
    authorName: 'Spelleiding',
    status: 'open',
  },
  {
    id: 'stem_onderling_broeden',
    title: '🥚 Broeden met de duif van een andere speler',
    body:
      'Twee spelers spreken onderling af om met elkaars duiven te kweken. De ene krijgt het ' +
      'jong, de andere een geldvergoeding die ze samen afspreken. Zo raken sterke lijnen ' +
      'verspreid zonder dat er een duif van eigenaar moet veranderen, en krijgt een goede ' +
      'kweekdoffer eindelijk waarde op zich.',
    authorId: '',
    authorName: 'Spelleiding',
    status: 'open',
  },
  {
    id: 'stem_doping',
    title: '💉 Doping (en dopingcontrole)',
    body:
      'Je kan je duif doping laten nemen: ze presteert bijvoorbeeld 25 % beter. Zodra andere ' +
      'spelers doorhebben dat er iets niet klopt, kunnen ze een dopingcontrole naar die speler ' +
      'sturen. Hebben ze gelijk, dan krijgen ze een beloning; hebben ze ongelijk, dan kost de ' +
      'controle hun geld als vergoeding voor de beschuldigde. Eventueel kunnen spelers samen ' +
      'stemmen op wie ze verdenken, zodat een controle een gezamenlijke zet wordt.',
    authorId: '',
    authorName: 'Spelleiding',
    status: 'open',
  },
  {
    id: 'stem_unieke_attributen',
    title: '✨ Unieke eigenschappen per duif',
    body:
      'Sommige duiven krijgen een eigen kenmerk, zodat ze meer zijn dan hun cijfers. ' +
      'Bijvoorbeeld "Snelle flapper": profiteert extra van rugwind, +5 % snelheid bij vluchten ' +
      'met wind mee. Of "Warmbloedige": vliegt in de wintermaanden op haar best, +3 conditie ' +
      'van december tot februari. Zo wordt elke duif herkenbaar en krijgt de keuze wie je ' +
      'inschrijft er een laag bij.',
    authorId: '',
    authorName: 'Spelleiding',
    status: 'open',
  },
];

/**
 * Bel de indiener van een idee zodra iemand erop reageert.
 *
 * ⚠️ Geen inbox-trim hier, in tegenstelling tot `notify` in engine.ts. De
 * wereldload draagt enkel de inbox van de KIJKER (zie §D1Store in context.md),
 * dus de rijen van de indiener zijn niet eens in het geheugen om te snoeien —
 * dat doet `boundedCleanups` in SQL. De id is stabiel op de reactie, zodat een
 * dubbel verwerkt verzoek één bel geeft en geen twee.
 */
export function notifyIdeaAuthor(
  db: Database,
  idea: StemIdea,
  comment: StemComment,
): void {
  // Geen bel voor de startideeën (geen indiener) en niet voor je eigen reactie.
  if (!idea.authorId || idea.authorId === comment.authorId) return;
  if (db.notifications.some((n) => n.id === `ntf:stem:${comment.id}`)) return;
  db.notifications.push({
    id: `ntf:stem:${comment.id}`,
    userId: idea.authorId,
    kind: 'info',
    title: `💬 Reactie op je idee`,
    body: `${comment.authorName} reageerde op "${idea.title}".`,
    flightId: null,
    createdAt: comment.createdAt,
    read: false,
  });
}
