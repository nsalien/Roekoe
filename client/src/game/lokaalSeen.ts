/**
 * "Heb ik het laatste bericht in Het Lokaal al gezien?" — de staat achter het
 * bolletje op de Lokaal-knop.
 *
 * Zelfde opzet als marketSeen.ts: de server zegt WANNEER het laatste bericht
 * binnenkwam en van wie (`world.chatLastAt`/`chatLastBy`, twee kolommen op een
 * rij die elk verzoek al laadt), en deze kant onthoudt tot wanneer DEZE speler
 * gekeken heeft, in localStorage. Een gemak per browser, geen spelstaat — dus
 * het kost geen enkele schrijfactie op de databank.
 *
 * Opgeslagen als epoch-milliseconden onder `roekoe.lokaalSeen.<userId>`.
 *
 * ⚠️ Bewust React-vrij, zodat `lokaal.test.mts` deze regels rechtstreeks kan
 * aansturen. De hook die erop luistert staat in Layout.tsx.
 */

/** Wordt afgevuurd na `markLokaalSeen`; localStorage hertekent zelf niets. */
export const LOKAAL_SEEN_EVENT = 'roekoe:lokaal-seen';

function key(userId: string): string {
  return `roekoe.lokaalSeen.${userId}`;
}

/** Tot wanneer deze speler Het Lokaal gelezen heeft (epoch ms, 0 = nooit). */
export function lokaalSeenAt(userId: string | null | undefined): number {
  if (!userId) return 0;
  try {
    const raw = Number(localStorage.getItem(key(userId)) ?? '0');
    return Number.isFinite(raw) ? raw : 0;
  } catch {
    return 0;
  }
}

/**
 * Markeer alles tot `iso` als gelezen. De pagina roept dit met de servertijd
 * (`now`) van elke lading en poll — NIET met het nieuwste zichtbare bericht:
 * wordt het laatste bericht weggehaald, dan blijft `chatLastAt` ernaar wijzen en
 * zou het bolletje anders blijven hangen tot iemand opnieuw iets schrijft.
 * Schuift nooit terug: een trage poll kan een recenter bezoek niet ongedaan maken.
 */
export function markLokaalSeen(userId: string | null | undefined, iso: string | null | undefined): void {
  if (!userId || !iso) return;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= lokaalSeenAt(userId)) return;
  try {
    localStorage.setItem(key(userId), String(ms));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(LOKAAL_SEEN_EVENT));
}

/**
 * Staat er in Het Lokaal een bericht dat deze speler nog niet zag? Je eigen
 * bericht telt niet: daar hoef je geen bolletje voor te krijgen.
 */
export function hasLokaalNews(
  chatLastAt: string | null | undefined,
  chatLastBy: string | null | undefined,
  userId: string | null | undefined,
  seenAt: number,
): boolean {
  if (!chatLastAt || !userId) return false;
  if (chatLastBy === userId) return false;
  const ms = Date.parse(chatLastAt);
  return Number.isFinite(ms) && ms > seenAt;
}
