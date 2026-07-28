/** Small numeric / random helpers shared by the game logic. */

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Roughly-normal distributed value in [min,max] centred on the midpoint. */
export function bell(min: number, max: number): number {
  const avg = (Math.random() + Math.random() + Math.random()) / 3;
  return min + avg * (max - min);
}

/** Linear interpolation across a set of {x,y} control points. */
export function interpolate(points: { x: number; y: number }[], x: number): number {
  if (x <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (x >= last.x) return last.y;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return last.y;
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
