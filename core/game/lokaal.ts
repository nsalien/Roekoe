/**
 * HET LOKAAL — de vrije chat van alle spelers.
 *
 * In het echte duivenmelken is "het lokaal" het café waar de bond samenkomt:
 * inkorven, uitslagen afwachten, en vooral veel praten. Dit is dat café.
 *
 * Dit bestand houdt alleen de REGELS: wat een geldig bericht is, wie wat mag
 * weghalen en hoe een poll zijn venster kiest. Net als game/stem.ts zit hier
 * geen databank in — de rijen worden gelezen en geschreven door
 * `loadLokaalLatest`/`loadLokaalChanges`/`insertLokaalMessage`/… in core/d1.ts,
 * zodat deze regels testbaar blijven zonder databank.
 */

import { LOKAAL } from '../config/gameConfig.js';
import type { LokaalMessage } from '../schema.js';

/**
 * Wat er van een getypt bericht overblijft. Alinea's blijven (een enter is een
 * enter), maar spaties worden samengevouwen en meer dan één lege regel na elkaar
 * wordt er één — anders kan één bericht het hele scherm leeg duwen.
 */
export function cleanMessage(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * GIFs (owner: "ook GIFs sturen in het lokaal"). Een GIF is een bericht dat
 * enkel uit één link bestaat naar Giphy of Tenor; de client toont die als
 * bewegend beeld (zie client/src/game/gif.ts — dezelfde regels). Enkel deze
 * twee hosts: een willekeurige afbeeldingslink zou van de chat een plek maken
 * waar iedereen alles kan tonen, en elke speler laadt ze automatisch in.
 *
 * Een Giphy-link (de pagina, of een media-URL met trackingparameters) wordt
 * herschreven naar één vaste vorm: de 200 px hoge versie, licht genoeg voor een
 * chat. Een Tenor-media-link blijft zoals hij is, zonder query. Elke andere
 * tekst blijft ongemoeid.
 */
const GIPHY_ID = /^[A-Za-z0-9]{6,40}$/;
export function giphyMediaUrl(id: string): string | null {
  return GIPHY_ID.test(id) ? `https://media.giphy.com/media/${id}/200.gif` : null;
}
export function normalizeGifLink(text: string): string {
  if (/\s/.test(text)) return text; // a sentence, not a lone link
  const m = /^https?:\/\/([^/?#:]+)(\/[^?#]*)?/i.exec(text);
  if (!m) return text;
  const host = m[1].toLowerCase();
  const path = m[2] ?? '/';
  const parts = path.split('/').filter(Boolean);
  if (host === 'giphy.com' || host === 'www.giphy.com') {
    // giphy.com/gifs/<slug>-<id>  or  giphy.com/gifs/<id>
    if (parts[0] === 'gifs' && parts[1]) return giphyMediaUrl(parts[1].split('-').pop()!) ?? text;
    return text;
  }
  if (/^(media\d?\.)?giphy\.com$/.test(host) || host === 'i.giphy.com') {
    // media*.giphy.com/media/[v1.<cid>/]<id>/<file>  or  i.giphy.com/<id>.gif
    if (host === 'i.giphy.com') return giphyMediaUrl((parts[0] ?? '').replace(/\.(gif|webp)$/i, '')) ?? text;
    const i = parts.indexOf('media');
    if (i >= 0 && parts.length >= i + 3) return giphyMediaUrl(parts[parts.length - 2]) ?? text;
    return text;
  }
  if (/^(media\d?|c)\.tenor\.com$/.test(host) && /\.gif$/i.test(path)) {
    return `https://${host}${path}`;
  }
  return text;
}

/** Foutmelding (Nederlands) of `null` als het bericht mag. */
export function validateMessage(body: string): string | null {
  if (body.length === 0) return 'Typ eerst iets.';
  if (body.length > LOKAAL.bodyMax) return `Een bericht mag hoogstens ${LOKAAL.bodyMax} tekens lang zijn.`;
  return null;
}

/**
 * Mag deze speler nog een bericht sturen, gegeven het tijdstip van zijn vorige?
 * Geeft een foutmelding of `null`.
 */
export function rateLimitError(lastPostIso: string | null, nowMs: number): string | null {
  if (!lastPostIso) return null;
  const last = Date.parse(lastPostIso);
  if (!Number.isFinite(last)) return null;
  return nowMs - last < LOKAAL.minIntervalSeconds * 1000 ? 'Rustig aan — even wachten voor je volgende bericht.' : null;
}

/**
 * Wie mag een bericht weghalen: de schrijver zelf, en de beheerder (moderatie).
 * Een bericht van een verwijderde speler (`userId` leeg) kan enkel de beheerder
 * nog weghalen.
 */
export function canDeleteMessage(
  msg: Pick<LokaalMessage, 'userId' | 'deletedAt'>,
  viewer: { id: string; isAdmin: boolean },
): boolean {
  if (msg.deletedAt) return false;
  return viewer.isAdmin || (!!msg.userId && msg.userId === viewer.id);
}

/**
 * Vanaf welk tijdstip een poll moet kijken, gegeven de cursor die de client
 * terugstuurt (de `now` van zijn vorige antwoord). De overlap vangt een bericht
 * op dat zijn tijdstip kreeg vóór de vorige poll, maar pas daarna in de tabel
 * stond. `null` = ongeldige cursor: behandel het verzoek als een eerste lading.
 */
export function pollWindowStart(sinceIso: string | undefined | null): string | null {
  if (!sinceIso) return null;
  const ms = Date.parse(sinceIso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - LOKAAL.pollOverlapSeconds * 1000).toISOString();
}

/** Grens waaronder berichten opgeruimd worden. */
export function retentionCutoff(nowMs: number): string {
  return new Date(nowMs - LOKAAL.retentionDays * 86400000).toISOString();
}

/** Chronologische volgorde, met de id als scheidsrechter bij een gelijk tijdstip. */
export function sortMessages(list: LokaalMessage[]): LokaalMessage[] {
  return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * De bel waarmee Het Lokaal aangekondigd wordt (migratie v60 in schedule.ts
 * zet hem in de inbox van élke echte speler). De tekst staat hier en niet in
 * de migratie, zodat de test hem kan lezen zonder de hele motor te draaien.
 */
export const LOKAAL_INTRO = {
  title: '🍻 Nieuw: Het Lokaal',
  body:
    'Het café van de duivenmelkers is open! In het menu staat een nieuwe knop, "Het Lokaal": '
    + 'een chat waar je vrij kan praten met alle andere spelers. Uitslagen bespreken, een duif '
    + 'aanprijzen of gewoon wat zeveren — schuif gerust aan.',
  /** Stabiel per speler: twee verzoeken die tegelijk migreren geven één bel. */
  id: (userId: string) => `ntf:lokaal:intro:${userId}`,
} as const;
