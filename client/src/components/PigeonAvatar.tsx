/**
 * A pigeon's avatar. When the bird has a BREED (ras) with a photo, we show that
 * photo — the same artwork as roekoe.org/wiki/breeds — in a round frame. A
 * subtle golden ring appears for high-talent birds. If no breed photo is known
 * (older data), we fall back to a little procedurally-tinted SVG pigeon.
 */

import type { Pigeon, Sex } from '../types';

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

type AvatarPigeon = Pick<Pigeon, 'id' | 'sex' | 'talent'> & {
  breed?: Pigeon['breed'];
  quirk?: Pigeon['quirk'];
};

/**
 * The extra bits drawn on top of the fallback pigeon for an inbred bird's quirk.
 *
 * DRAWN, not photographed, for the same reasons the prize cups are (see
 * PrizeCeremony): sharp at every size, follows the theme, and no image assets to
 * ship or keep in sync with PIGEON_QUIRKS on the server. A quirk we have no
 * drawing for simply renders the ordinary bird plus its badge elsewhere.
 */
function QuirkExtras({ quirk, body, bodyDark }: { quirk: string; body: string; bodyDark: string }) {
  switch (quirk) {
    case 'driewiek': // a third wing, standing proud off the back
      return (
        <>
          <path d="M38 40 Q56 26 72 34 Q56 42 42 46 Z" fill={bodyDark} opacity="0.95" />
          <path d="M44 38 Q58 33 68 37" stroke={body} strokeWidth="2" fill="none" opacity="0.6" />
        </>
      );
    case 'tweekoppen': // a second head and beak, looking the other way
      return (
        <>
          <circle cx="40" cy="34" r="12" fill={body} />
          <circle cx="35" cy="31" r="2.4" fill="#12222e" />
          <circle cx="34" cy="30" r="0.7" fill="#fff" />
          <path d="M29 34 L20 36 L29 39 Z" fill="#f4a261" />
        </>
      );
    case 'kortpoot': // one leg visibly shorter than the other
      return <path d="M62 79 l0 3 m-3 0 l6 0" stroke="#e76f51" strokeWidth="2" strokeLinecap="round" />;
    case 'kleurenblind': // little grey spectacles
      return (
        <>
          <circle cx="79" cy="37" r="5" fill="none" stroke="#94a3b8" strokeWidth="1.6" />
          <circle cx="90" cy="35" r="4" fill="none" stroke="#94a3b8" strokeWidth="1.6" />
          <path d="M84 36.5 L86 36" stroke="#94a3b8" strokeWidth="1.4" />
        </>
      );
    case 'reuzensnavel': // an oversized soup-spoon of a beak
      return <path d="M86 38 L104 42 L86 47 Z" fill="#f4a261" stroke="#d98b4a" strokeWidth="1" />;
    default:
      return null;
  }
}

export function PigeonAvatar({
  pigeon,
  size = 84,
  shape = 'circle',
}: {
  pigeon: AvatarPigeon;
  size?: number;
  /** `circle` is the compact list avatar. `showcase` uses a rounded square with
   *  barely any inset, so the bird itself is drawn far bigger in the same box —
   *  for places where the photo is the point (market, auctions). */
  shape?: 'circle' | 'showcase';
}) {
  const elite = pigeon.talent >= 75;
  const quirk = pigeon.quirk?.id ?? null;
  // A quirky bird gets the DRAWN pigeon rather than her breed photo — the whole
  // point of the quirk is that you can see it, and no stock photo has three
  // wings. Her breed still shows as a badge on her page.
  const image = quirk ? undefined : pigeon.breed?.image;

  if (image) {
    // Legendary/rare breeds get a warmer frame so the prize photos stand out.
    const rarity = pigeon.breed?.rarity;
    const ring =
      rarity === 'legendarisch'
        ? '#f59e0b'
        : rarity === 'zeldzaam'
          ? '#a855f7'
          : elite
            ? '#f59e0b'
            : 'var(--line, rgba(0,0,0,0.12))';
    const ringWidth = rarity === 'legendarisch' || rarity === 'zeldzaam' || elite ? 2.5 : 1.5;
    const showcase = shape === 'showcase';
    return (
      <div
        style={{
          width: size,
          height: size,
          // A round crop of a square photo throws away the corners, so the bird
          // has to sit small inside it. The showcase frame keeps the corners and
          // drops the inset, which is most of why the photo reads bigger.
          borderRadius: showcase ? 14 : '50%',
          overflow: 'hidden',
          flexShrink: 0,
          background: 'var(--surface-2, #eee)',
          border: `${ringWidth}px solid ${ring}`,
          boxSizing: 'border-box',
          // A little inner padding so the WHOLE bird (tail + feet) stays inside
          // the frame — the photos are near full-bleed squares, so a plain
          // circular crop would clip the extremities.
          padding: showcase ? '3%' : '10%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          src={`/pigeon-images/${image}`}
          alt={pigeon.breed?.name ?? 'Duif'}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      </div>
    );
  }

  // Fallback: the old procedural SVG pigeon.
  const hue = hashHue(pigeon.id);
  const body = `hsl(${hue}, 28%, 62%)`;
  const bodyDark = `hsl(${hue}, 30%, 45%)`;
  const belly: Record<Sex, string> = { doffer: 'hsl(205, 55%, 78%)', duivin: 'hsl(335, 55%, 82%)' };

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={pigeon.quirk ? `Duif — ${pigeon.quirk.name}` : 'Duif'}
    >
      {elite && (
        <circle cx="50" cy="50" r="47" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="4 5" opacity="0.8">
          <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="14s" repeatCount="indefinite" />
        </circle>
      )}
      {/* The whole bird flips for the upside-down flyer. */}
      <g transform={quirk === 'ondersteboven' ? 'rotate(180 50 50)' : undefined}>
      {/* tail — gone entirely on a tailless bird */}
      {quirk !== 'staartloos' && <path d="M18 58 L2 66 L4 74 L22 70 Z" fill={bodyDark} />}
      {/* body */}
      <ellipse cx="52" cy="58" rx="30" ry="22" fill={body} />
      {/* belly */}
      <ellipse cx="56" cy="64" rx="20" ry="13" fill={belly[pigeon.sex]} opacity="0.85" />
      {/* wing */}
      <path d="M40 48 Q64 42 78 56 Q60 62 44 60 Z" fill={bodyDark} />
      <path d="M46 54 Q62 52 74 58" stroke={body} strokeWidth="2" fill="none" opacity="0.6" />
      {/* neck + head */}
      <circle cx="74" cy="40" r="14" fill={body} />
      <path d="M62 46 Q70 40 74 30" stroke={bodyDark} strokeWidth="1.5" fill="none" opacity="0.5" />
      {/* eye */}
      <circle cx="79" cy="37" r="2.6" fill="#12222e" />
      <circle cx="80" cy="36" r="0.8" fill="#fff" />
      {/* beak */}
      <path d="M86 40 L96 42 L86 45 Z" fill="#f4a261" />
      <circle cx="86.5" cy="39.5" r="1" fill="#12222e" />
      {/* feet */}
      <path d="M50 79 l0 6 m-4 0 l8 0" stroke="#e76f51" strokeWidth="2" strokeLinecap="round" />
      {quirk && <QuirkExtras quirk={quirk} body={body} bodyDark={bodyDark} />}
      </g>
    </svg>
  );
}
