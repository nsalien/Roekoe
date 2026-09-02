/**
 * Live map of a running flight: the real route on a real map, with every bird
 * where she actually is.
 *
 * WHY THIS IS CHEAP — read before adding anything here.
 * The map adds NOTHING to the budgets this game keeps dying on:
 *  - no API call of its own. It renders whatever the live poll (60 s) already
 *    fetched, so it costs 0 extra requests, 0 D1 rows and 0 Worker CPU;
 *  - no per-bird coordinates over the wire. The server sends the route endpoints
 *    once and each bird's `progress`; the geodesy in ./geo turns that into a
 *    position, in the player's browser;
 *  - map tiles are fetched by the browser straight from the tile CDN, so they
 *    never touch Cloudflare's limits at all.
 * This module is loaded LAZILY (see LiveFlightPage), so Leaflet is downloaded
 * only by someone actually watching a race — every other page stays as light as
 * it was.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { FlightRoute, LiveBird, LiveRelayTeam } from '../types';
import { birdPoint, type Pt } from './geo';

/**
 * The basemap: plain OpenStreetMap, which needs NO API KEY.
 *
 * ⚠️ It used to be Carto's basemap CDN, which turned out to want a key — the map
 * then rendered as a grey box asking for one. An API key in a static bundle is a
 * public key, so a key-less provider is the only honest option here, and OSM is
 * the one that has always been key-less.
 *
 * OSM has no dark variant, so the dark theme is made by filtering the tile pane
 * in CSS (see `.leaflet-tile-pane` in global.css). That also lets the light theme
 * be desaturated a little, so the birds and the route read above the map instead
 * of competing with it.
 *
 * ⚠️ Attribution is required and is rendered by Leaflet's own control. Do not
 * remove it. Tiles are fetched by the PLAYER'S BROWSER straight from the tile
 * server, so they never pass through the Worker and cannot touch any Cloudflare
 * limit — and if the server ever refuses, the map degrades to the route and the
 * birds on a blank background (see `tileerror`) rather than breaking the page.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers';

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

/**
 * Which dot a bird gets. Your own birds read first, the leader second, a bird off
 * course third — everyone else is deliberately quiet, otherwise a field of ninety
 * is confetti.
 */
function dotClass(m: Marked): string {
  if (m.mine) return 'me';
  if (m.lost) return 'lost';
  if (m.leader) return 'leader';
  return 'other';
}

/**
 * ⚠️ Birds are `divIcon` markers, not `circleMarker`s, for one reason: you have to
 * be able to HIT them. A circle marker's click target is the circle itself, so a
 * 4-pixel dot needs a 4-pixel-accurate click — unusable on a phone. A divIcon has
 * a real box (26×26 here) that stays clickable however small the dot looks.
 */
const ICONS = new Map<string, L.DivIcon>();
function dotIcon(cls: string): L.DivIcon {
  let icon = ICONS.get(cls);
  if (!icon) {
    icon = L.divIcon({
      className: 'bird-pin',
      html: `<span class="bird-dot ${cls}"></span>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -10],
    });
    ICONS.set(cls, icon);
  }
  return icon;
}

function placeIcon(kind: 'start' | 'home' | 'swap', label: string): L.DivIcon {
  return L.divIcon({
    className: 'place-pin',
    html: `<span class="place-dot ${kind}"></span><span class="place-label">${label}</span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
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
  if (m.lost) rows.push(`<div class="pop-warn">🧭 van koers — ~${Math.abs(Math.round(b.offCourseKm ?? 0))} km naast de lijn</div>`);
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
  const markers = useRef(new Map<string, { marker: L.Marker; cls: string }>());
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'),
  );
  const [tilesFailed, setTilesFailed] = useState(false);
  /** Bumped whenever the map is (re)built, so the layers that live on it are
   *  re-attached. Without this the map came back naked after a rebuild. */
  const [epoch, setEpoch] = useState(0);

  /**
   * ⚠️ THE ROUTE AS A STRING, and this is load-bearing.
   *
   * `route` arrives as fresh JSON on every live poll, so the object identity
   * changes every 60 seconds even though the route itself never moves. With
   * `[route]` as the dependency the whole map was torn down and rebuilt on every
   * poll — and because the tile layer hung off a `[theme]`-only effect, the
   * rebuilt map had NO BASEMAP. That is the "map suddenly disappears until I
   * refresh" bug: the first render had tiles, every poll after it did not.
   */
  const routeKey = useMemo(
    () => JSON.stringify([route.from, route.to, route.legs ?? null]),
    [route],
  );

  // Follow the app's theme toggle so the basemap never fights the page.
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() =>
      setTheme(el.getAttribute('data-theme') === 'light' ? 'light' : 'dark'));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // Build the map. Bounds are fitted once here and never again: refitting on a
  // poll would yank the view back while someone is panning around.
  useEffect(() => {
    const box = holder.current;
    if (!box) return;
    // `zoomSnap: 0.25` because fitBounds otherwise rounds DOWN to a whole zoom
    // level, and a 1000 km route then sits as a thumbnail in a half-empty frame.
    // Quarter steps scale the tiles by at most a fifth — invisible — and the
    // route fills the card. `scrollWheelZoom` stays off so scrolling the page
    // past the map does not zoom it by accident.
    const m = L.map(box, {
      zoomControl: true, attributionControl: true, scrollWheelZoom: false, zoomSnap: 0.25,
    });
    map.current = m;
    const legs = route.legs ?? [];
    const line: [number, number][] = legs.length
      ? [[legs[0].fromLat, legs[0].fromLon], ...legs.map((l) => [l.toLat, l.toLon] as [number, number])]
      : [[route.from.lat, route.from.lon], [route.to.lat, route.to.lon]];
    // Casing + core: a single hairline disappears against a busy map.
    L.polyline(line, { color: cssVar('--brand', '#0284c7'), weight: 7, opacity: 0.18 }).addTo(m);
    L.polyline(line, { color: cssVar('--brand', '#0284c7'), weight: 2.5, opacity: 0.85, dashArray: '1 7', lineCap: 'round' }).addTo(m);

    const pin = (lat: number, lon: number, kind: 'start' | 'home' | 'swap', label: string) =>
      L.marker([lat, lon], { icon: placeIcon(kind, label), interactive: false, keyboard: false }).addTo(m);
    pin(route.from.lat, route.from.lon, 'start', `Lossing · ${route.from.name}`);
    pin(route.to.lat, route.to.lon, 'home', `Thuis · ${route.to.name}`);
    for (const l of legs.slice(0, -1)) pin(l.toLat, l.toLon, 'swap', `Wissel · ${l.toName}`);

    // ⚠️ Leaflet measures its container when the map is created, and in a React
    // effect that happens BEFORE the browser has laid the card out — it then fits
    // the route into a box of nearly nothing and the whole race ends up as a
    // thumbnail in the middle. Measure again on the next frame, and keep
    // measuring when the card resizes (rotating a phone, opening the standings).
    const fit = () => { m.invalidateSize(); m.fitBounds(L.latLngBounds(line), { padding: [24, 24] }); };
    const raf = requestAnimationFrame(fit);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box);
    setEpoch((e) => e + 1);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      m.remove();
      map.current = null;
      tiles.current = null;
      markers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  // The basemap. Depends on the map EPOCH as well as the theme, so a rebuilt map
  // gets its tiles back (see the routeKey note above).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tiles.current?.remove();
    setTilesFailed(false);
    const layer = L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 13, minZoom: 3 });
    // The background is the one part of this that depends on somebody else's
    // server. If it will not load, say so once and carry on: the route, the birds
    // and their popups are all ours and keep working.
    let misses = 0;
    layer.on('tileerror', () => { if (++misses >= 3) setTilesFailed(true); });
    layer.on('tileload', () => { misses = 0; });
    layer.addTo(m);
    layer.bringToBack();
    tiles.current = layer;
  }, [theme, epoch]);

  // Move the birds. Markers are REUSED per pigeon rather than rebuilt, so an open
  // popup survives a poll and ninety pins are not recreated every 60 seconds.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
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
      const cls = dotClass(mk);
      const latlng: [number, number] = [mk.point.lat, mk.point.lon];
      const existing = markers.current.get(bird.pigeonId);
      if (existing) {
        existing.marker.setLatLng(latlng);
        // Only touch the icon when the dot actually changes: setIcon rebuilds the
        // DOM node and would close an open popup on every poll.
        if (existing.cls !== cls) { existing.marker.setIcon(dotIcon(cls)); existing.cls = cls; }
        existing.marker.setPopupContent(popupHtml(mk));
      } else {
        const marker = L.marker(latlng, { icon: dotIcon(cls), riseOnHover: true, title: bird.pigeonName })
          .bindPopup(popupHtml(mk))
          .addTo(m);
        markers.current.set(bird.pigeonId, { marker, cls });
      }
    }
    for (const [id, entry] of markers.current) {
      if (!seen.has(id)) { entry.marker.remove(); markers.current.delete(id); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [birds, teams, routeKey, meId, epoch]);

  const lostCount = birds.filter((b) => !b.gaveUp && Math.abs(b.offCourseKm ?? 0) >= 1).length;

  return (
    <div>
      <div ref={holder} className="flight-map" />
      <div className="map-legend">
        <span><i className="bird-dot me" /> jouw duiven</span>
        <span><i className="bird-dot leader" /> leider</span>
        <span><i className="bird-dot lost" /> van koers</span>
        <span><i className="bird-dot other" /> de rest</span>
      </div>
      {tilesFailed && (
        <p className="faint" style={{ marginTop: 6, marginBottom: 0, fontSize: '0.82rem' }}>
          🗺️ De achtergrondkaart laadt niet — de route en de posities kloppen wel.
        </p>
      )}
      <p className="faint" style={{ marginTop: 4, marginBottom: 0, fontSize: '0.82rem' }}>
        Tik een duif voor haar stand.
        {lostCount > 0 && <> · 🧭 {lostCount} {lostCount === 1 ? 'duif is' : 'duiven zijn'} van koers</>}
        {outCount > 0 && <> · {outCount} niet meer in de wedstrijd (niet op de kaart)</>}
      </p>
    </div>
  );
}
