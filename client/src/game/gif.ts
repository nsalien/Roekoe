/**
 * Is dit Lokaal-bericht een GIF? Enkel een bericht dat uit exact één link
 * bestaat in de vaste vorm die de server ervan maakt (normalizeGifLink in
 * core/game/lokaal.ts): Giphy's 200 px-versie, of een Tenor-media-link. Al de
 * rest — ook een link midden in een zin — blijft gewoon tekst, zodat niemand
 * willekeurige afbeeldingen in ieders scherm laadt.
 */
const GIF_LINK = /^https:\/\/(media\.giphy\.com\/media\/[A-Za-z0-9]{6,40}\/200\.gif|(media\d?|c)\.tenor\.com\/[\w-]+\/[\w.-]+\.gif)$/;

export function gifSrc(body: string): string | null {
  const t = body.trim();
  return GIF_LINK.test(t) ? t : null;
}
