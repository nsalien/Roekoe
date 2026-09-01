/**
 * Live map of a running flight: the real route on a real map, with every bird
 * where she actually is.
 *
 * WHY THIS IS CHEAP — read before adding anything here.
 * The map adds NOTHING to the budgets this game keeps dying on:
 *  - no API call of its own. It renders whatever the live poll (60 s) already
 *    fetched, so it costs 0 extra requests, 0 D1 rows and 0 Worker CPU;
 *  - no per-bird coordinates over the wire. The server sends the route endpoints
 *    once and each bird's `progress`; the geodesy below turns that into a
 *    position, in the player's browser;
 *  - map tiles are fetched by the browser straight from the tile CDN, so they
 *    never touch Cloudflare's limits at all.
 * This module is loaded LAZILY (see LiveFlightPage), so Leaflet is downloaded
 * only by someone actually watching a race — every other page stays as light as
 * it was.
 */

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { FlightRoute, LiveBird, LiveRelayTeam } from '../types';
import { birdPoint, type Pt } from './geo';

/**
 * Tile layers. Deliberately a key-less basemap: an API key in a static bundle is
 * a public key, and this is a static bundle. Attribution is required by both
 * providers and is rendered by Leaflet's own attribution control — do not remove
 * it.
 *
 * Swapping providers is a one-line change here. The plain OpenStreetMap tiles
 * (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) are the obvious fallback,
 * but they have no dark variant, which is the theme this game runs in by default.
 *
 * ⚠️ Tiles are fetched by the PLAYER'S BROWSER straight from the CDN. They never
 * pass through the Worker, so they cannot touch any Cloudflare limit — and if the
 * provider ever refuses, the map degrades to the route and the birds on a blank
 * background (see `tileerror`) rather than breaking the page.
 */
const TILES = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/* --- Colours -------------------------------------------------------------- */
/* Read off the design system so the map follows the theme like everything else. */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

interface Marked {
  bird: LiveBird;
  point: Pt;
  mine: boolean;
  leader: boolean;
  lost: boolean;
  legLabel?: string;
}

function styleFor(m: Marked, c: Record<string, string>): L.CircleMarkerOptions {
  // Your own birds read first, the leader second, a bird off course third —
  // everyone else is deliberately quiet, otherwise a field of ninety is confetti.
  if (m.mine) return { radius: 7, color: '#fff', weight: 2, fillColor: c.accent, fillOpacity: 1 };
  if (m.lost) return { radius: 5, color: c.warn, weight: 2, fillColor: c.warn, fillOpacity: 0.55 };
  if (m.leader) return { radius: 6, color: '#fff', weight: 2, fillColor: c.gold, fillOpacity: 1 };
  return { radius: 4, color: c.brand, weight: 1, fillColor: c.brand, fillOpacity: 0.5 };
}

function popupHtml(m: Marked): string {
  const b = m.bird;
  const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  const eta = b.etaSeconds > 0
    ? `${Math.floor(b.etaSeconds / 3600)}u ${Math.round((b.etaSeconds % 3600) / 60)}m`
    : null;
  const rows: string[] = [];
  if (m.legLabel) rows.push(`<div>${esc(m.legLabel)}</div>`);
  rows.push(`<div>Positie <strong>#${b.liveRank}</strong>${b.finished ? ' · binnen' : ''}</div>`);
  rows.push(`<div>${b.kmDone} van ${b.kmTotal} km${b.finished ? '' : ` · nog ${b.kmRemaining} km`}</div>`);
  if (!b.finished) rows.push(`<div>${b.speedKmh} km/u${eta ? ` · thuis over ${eta}` : ''}</div>`);
  if (m.lost) {
    rows.push(`<div style="color:${cssVar('--warn', '#d97706')}">🧭 van koers — ~${Math.abs(Math.round(b.offCourseKm ?? 0))} km naast de lijn</div>`);
  }
  return `<div class="map-pop"><strong>${esc(b.pigeonName)}</strong><div class="faint">${esc(b.ownerName)}</div>${rows.join('')}</div>`;
}

/* --- Component ------------------------------------------------------------ */

export default function FlightMap({
  route,
  birds,
  teams,
  meId,
  outCount,
}: {
  route: FlightRoute;
  birds: LiveBird[];
  teams?: LiveRelayTeam[];
  meId?: string;
  outCount: number;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const markers = useRef(new Map<string, L.CircleMarker>());
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'),
  );
  const [tilesFailed, setTilesFailed] = useState(false);

  // Follow the app's theme toggle so the basemap never fights the page.
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() =>
      setTheme(el.getAttribute('data-theme') === 'light' ? 'light' : 'dark'));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // Create the map once. Bounds are fitted here and never again: refitting on
  // every poll would yank the view back while someone is panning around.
  useEffect(() => {
    if (!holder.current || map.current) return;
    // `zoomSnap: 0.25` because fitBounds otherwise rounds DOWN to a whole zoom
    // level, and a 1000 km route then sits as a thumbnail in a half-empty frame.
    // Quarter steps scale the tiles by at most a fifth — invisible — and the
    // route fills the card. `scrollWheelZoom` stays off so scrolling the page
    // past the map does not zoom it by accident.
    const m = L.map(holder.current, {
      zoomControl: true, attributionControl: true, scrollWheelZoom: false, zoomSnap: 0.25,
    });
    map.current = m;
    const legs = route.legs ?? [];
    const line: [number, number][] = legs.length
      ? [[legs[0].fromLat, legs[0].fromLon], ...legs.map((l) => [l.toLat, l.toLon] as [number, number])]
      : [[route.from.lat, route.from.lon], [route.to.lat, route.to.lon]];
    L.polyline(line, { color: cssVar('--text-faint', '#94a3b8'), weight: 2, dashArray: '6 6', opacity: 0.9 }).addTo(m);
    // Release point, home, and (relay only) the handover points in between.
    const pin = (lat: number, lon: number, label: string, colour: string) =>
      L.circleMarker([lat, lon], { radius: 5, color: colour, weight: 2, fillColor: colour, fillOpacity: 1 })
        .bindTooltip(label, { permanent: false, direction: 'top' })
        .addTo(m);
    pin(route.from.lat, route.from.lon, `Lossing · ${route.from.name}`, cssVar('--text-soft', '#556377'));
    pin(route.to.lat, route.to.lon, `Thuis · ${route.to.name}`, cssVar('--good', '#15a34a'));
    for (const l of legs.slice(0, -1)) {
      pin(l.toLat, l.toLon, `Wissel ${l.index} → ${l.index + 1} · ${l.toName}`, cssVar('--gold', '#d99a06'));
    }
    // ⚠️ Leaflet measures its container when the map is created, and in a React
    // effect that happens BEFORE the browser has laid the card out — it then fits
    // the route into a box of nearly nothing and the whole race ends up as a
    // thumbnail in the middle. Measure again on the next frame, and keep
    // measuring when the card resizes (rotating a phone, opening the standings).
    const fit = () => { m.invalidateSize(); m.fitBounds(L.latLngBounds(line), { padding: [20, 20] }); };
    const raf = requestAnimationFrame(fit);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(holder.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      m.remove();
      map.current = null;
      markers.current.clear();
    };
  }, [route]);

  // Swap the basemap with the theme.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tiles.current?.remove();
    setTilesFailed(false);
    const layer = L.tileLayer(TILES[theme], { attribution: ATTRIBUTION, maxZoom: 12, minZoom: 3 });
    // The background is the one part of this that depends on somebody else's
    // server. If it will not load, say so once and carry on: the route, the birds
    // and their popups are all ours and keep working.
    let misses = 0;
    layer.on('tileerror', () => { if (++misses >= 3) setTilesFailed(true); });
    layer.on('tileload', () => { misses = 0; });
    layer.addTo(m);
    layer.bringToBack();
    tiles.current = layer;
  }, [theme]);

  // Move the birds. Markers are REUSED per pigeon rather than rebuilt, so an open
  // popup survives a poll and ninety circles are not recreated every 60 seconds.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const c = {
      accent: cssVar('--accent', '#f97316'),
      gold: cssVar('--gold', '#d99a06'),
      brand: cssVar('--brand', '#0284c7'),
      warn: cssVar('--warn', '#d97706'),
    };
    // For a relay a bird flies HER OWN leg, so she is placed on that leg's line.
    const legOf = new Map<string, { from: Pt; to: Pt; label: string }>();
    for (const t of teams ?? []) {
      for (const l of t.legs) {
        const leg = (route.legs ?? []).find((x) => x.index === l.leg);
        if (leg) {
          legOf.set(l.pigeonId, {
            from: { lat: leg.fromLat, lon: leg.fromLon },
            to: { lat: leg.toLat, lon: leg.toLon },
            label: `Etappe ${leg.index} · ${leg.fromName} → ${leg.toName}`,
          });
        }
      }
    }

    const seen = new Set<string>();
    // Out of the race is off the map: pulled, given out, or lost for days. The
    // board beside the map still lists them, with the reason.
    for (const bird of birds.filter((b) => !b.gaveUp)) {
      const seg = legOf.get(bird.pigeonId);
      const from = seg?.from ?? route.from;
      const to = seg?.to ?? route.to;
      const off = bird.offCourseKm ?? 0;
      const mk: Marked = {
        bird,
        point: birdPoint(from, to, bird.progress, off),
        mine: bird.ownerId === meId,
        leader: bird.liveRank === 1,
        lost: Math.abs(off) >= 1,
        legLabel: seg?.label,
      };
      seen.add(bird.pigeonId);
      const existing = markers.current.get(bird.pigeonId);
      const latlng: [number, number] = [mk.point.lat, mk.point.lon];
      if (existing) {
        existing.setLatLng(latlng);
        existing.setStyle(styleFor(mk, c));
        existing.setPopupContent(popupHtml(mk));
      } else {
        const circle = L.circleMarker(latlng, styleFor(mk, c)).bindPopup(popupHtml(mk)).addTo(m);
        markers.current.set(bird.pigeonId, circle);
      }
    }
    for (const [id, circle] of markers.current) {
      if (!seen.has(id)) { circle.remove(); markers.current.delete(id); }
    }
  }, [birds, teams, route, meId]);

  const lostCount = birds.filter((b) => !b.gaveUp && Math.abs(b.offCourseKm ?? 0) >= 1).length;

  return (
    <div>
      <div ref={holder} className="flight-map" />
      {tilesFailed && (
        <p className="faint" style={{ marginTop: 6, marginBottom: 0, fontSize: '0.82rem' }}>
          🗺️ De achtergrondkaart laadt niet — de route en de posities kloppen wel.
        </p>
      )}
      <p className="faint" style={{ marginTop: 6, marginBottom: 0, fontSize: '0.82rem' }}>
        Klik een duif voor haar stand.
        {lostCount > 0 && <> · 🧭 {lostCount} {lostCount === 1 ? 'duif is' : 'duiven zijn'} van koers</>}
        {outCount > 0 && <> · {outCount} niet meer in de wedstrijd (niet op de kaart)</>}
      </p>
    </div>
  );
}
