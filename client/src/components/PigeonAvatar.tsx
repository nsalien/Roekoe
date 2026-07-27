/**
 * A little procedurally-tinted SVG pigeon. Its plumage colour is derived from
 * the pigeon's id (so each bird looks consistent), the belly tint hints at sex,
 * and a subtle golden ring appears for high-talent birds. Purely decorative.
 */

import type { Pigeon, Sex } from '../types';

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

export function PigeonAvatar({
  pigeon,
  size = 84,
}: {
  pigeon: Pick<Pigeon, 'id' | 'sex' | 'talent'>;
  size?: number;
}) {
  const hue = hashHue(pigeon.id);
  const body = `hsl(${hue}, 28%, 62%)`;
  const bodyDark = `hsl(${hue}, 30%, 45%)`;
  const belly: Record<Sex, string> = { doffer: 'hsl(205, 55%, 78%)', duivin: 'hsl(335, 55%, 82%)' };
  const elite = pigeon.talent >= 75;

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`Duif`}>
      {elite && (
        <circle cx="50" cy="50" r="47" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="4 5" opacity="0.8">
          <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="14s" repeatCount="indefinite" />
        </circle>
      )}
      {/* tail */}
      <path d="M18 58 L2 66 L4 74 L22 70 Z" fill={bodyDark} />
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
    </svg>
  );
}
