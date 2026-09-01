/**
 * Great-circle maths for the live flight map.
 *
 * The same geodesy the server uses to cut a relay into equal legs
 * (core/game/relay.ts). Duplicated rather than imported: `core/` is server code
 * and pulling it into the bundle would drag the whole game config along for
 * thirty lines of trigonometry.
 *
 * Kept in its own React-free module so it can be exercised directly by a test —
 * a map that puts a bird in the wrong country is the kind of bug nobody spots
 * from a screenshot.
 */

const R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export interface Pt { lat: number; lon: number }

/** The point a fraction `t` along the great circle from `a` to `b`. */
export function interpolate(a: Pt, b: Pt, t: number): Pt {
  const la1 = toRad(a.lat), lo1 = toRad(a.lon), la2 = toRad(b.lat), lo2 = toRad(b.lon);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2,
  ));
  if (d === 0) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
  const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
  const z = A * Math.sin(la1) + B * Math.sin(la2);
  return { lat: toDeg(Math.atan2(z, Math.hypot(x, y))), lon: toDeg(Math.atan2(y, x)) };
}

/** Initial bearing from `a` to `b`, degrees clockwise from north. */
export function bearing(a: Pt, b: Pt): number {
  const la1 = toRad(a.lat), la2 = toRad(b.lat), dLo = toRad(b.lon - a.lon);
  const y = Math.sin(dLo) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLo);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** The point `km` away from `p` on the given bearing. */
export function destination(p: Pt, bearingDeg: number, km: number): Pt {
  const d = km / R_KM;
  const br = toRad(bearingDeg), la1 = toRad(p.lat), lo1 = toRad(p.lon);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(la1),
    Math.cos(d) - Math.sin(la1) * Math.sin(la2),
  );
  return { lat: toDeg(la2), lon: toDeg(lo2) };
}

/**
 * Where a bird is: `progress` along her leg, then pushed sideways if she is off
 * course. The sideways push is perpendicular to the LOCAL heading (sampled a
 * hair further along the route), which matters on a 1000 km leg where the
 * bearing at Barcelona is not the bearing at Brugge.
 */
export function birdPoint(from: Pt, to: Pt, progress: number, offCourseKm = 0): Pt {
  const t = Math.min(1, Math.max(0, progress));
  const here = interpolate(from, to, t);
  if (!offCourseKm) return here;
  const ahead = interpolate(from, to, Math.min(1, t + 0.001));
  const head = t >= 1 ? bearing(from, to) : bearing(here, ahead);
  return destination(here, head + 90, offCourseKm);
}
