/**
 * PlacesMap — the « Pratique » map (specs/guest-app/guest-app-local-amenities.md rules 2, 3, 8): OpenStreetMap tiles, the estate's own marker,
 * one round marker per place (category colour + white glyph), markers closer than 28 px grouped into a counted bubble
 * ringed with the colours it holds, fanned out at the maximum zoom. One imperative Leaflet map: React hands it the places
 * and hears which one was tapped; it never draws a marker itself.
 *
 * Props: `places` (the filtered places of `/places`), `estate` ({ lat, lng }), `selectedId`, `onSelect(id)`,
 * `onLocateError()` (the device's position is unavailable or refused). `ref`: `{ zoomIn, zoomOut, locate }`, for the
 * controls of the page. The device's position stays here: no request carries it.
 */
import {
  forwardRef, useEffect, useImperativeHandle, useRef,
} from 'react';
import L from 'leaflet';
import { __iconData as house } from 'lucide-react/icons/house';
import 'leaflet/dist/leaflet.css';
import { LOCATION_COLOR, PLACE_STYLE, styleOf } from '../constants/placeCategories';
import { clusterPoints, fanOut } from '../utils/clusterPoints';
import { glyphSvg } from '../utils/glyphSvg';
import { useT } from '../i18n';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAX_ZOOM = 18;
const FIT = { padding: [40, 40], maxZoom: 16 };

/** A marker is a button for the keyboard and a screen reader (Leaflet makes it focusable, not named). */
const nameMarker = (marker, text) => {
  const el = marker.getElement();
  if (!el) return;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', text);
};

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const pinIcon = (place, selected) => {
  const { color, data } = styleOf(place.category);
  return L.divIcon({
    className: 'pl-mk-wrap',
    html: `<span class="pl-mk${selected ? ' sel' : ''}" style="--pl-c:${color}">${glyphSvg(data, 18)}</span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
};

/** A ring of the colours the group holds, in the categories' order, around its count. */
const bubbleIcon = (members) => {
  const colours = Object.keys(PLACE_STYLE).filter((key) => members.some((m) => m.category === key)).map((key) => PLACE_STYLE[key].color);
  const share = 100 / colours.length;
  const ring = colours.map((c, i) => `${c} ${i * share}% ${(i + 1) * share}%`).join(', ');
  return L.divIcon({
    className: 'pl-mk-wrap',
    html: `<span class="pl-grp" style="background:conic-gradient(${ring})"><b>${members.length}</b></span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
};

const estateIcon = () => L.divIcon({
  className: 'pl-mk-wrap',
  html: `<span class="pl-estate">${glyphSvg(house, 16)}</span>`,
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});

const meIcon = () => L.divIcon({
  className: 'pl-mk-wrap', html: `<span class="pl-me" style="--pl-c:${LOCATION_COLOR}"></span>`, iconSize: [28, 28], iconAnchor: [14, 14],
});

const PlacesMap = forwardRef(function PlacesMap({
  places, estate, selectedId, onSelect, onLocateError,
}, ref) {
  const t = useT();
  const box = useRef(null);
  const inner = useRef({ map: null, layer: null, me: null, pins: new Map() });
  const latest = useRef({});
  latest.current = {
    places, selectedId, onSelect, onLocateError, label: (n) => t('places.group', { n }), estateLabel: t('places.estate'),
  };

  const draw = () => {
    const { map, layer, pins } = inner.current;
    if (!map) return;
    layer.clearLayers();
    pins.clear();
    const { places: shown, selectedId: selected } = latest.current;
    const byId = new Map(shown.map((p) => [p.id, p]));
    const points = shown.map((p) => {
      const at = map.latLngToContainerPoint([p.lat, p.lng]);
      return { id: p.id, x: at.x, y: at.y };
    });
    const pin = (place, latlng) => {
      const marker = L.marker(latlng, {
        icon: pinIcon(place, place.id === selected), title: place.name, alt: place.name, keyboard: true, riseOnHover: true,
      });
      marker.on('click', () => latest.current.onSelect(place.id));
      marker.addTo(layer);
      pins.set(place.id, marker);
      nameMarker(marker, `${place.name}, ${place.categoryLabel}`);
    };
    clusterPoints(points).forEach((group) => {
      if (group.ids.length === 1) {
        const place = byId.get(group.ids[0]);
        pin(place, [place.lat, place.lng]);
      } else if (map.getZoom() >= map.getMaxZoom()) {
        fanOut(group).forEach((m) => pin(byId.get(m.id), map.containerPointToLatLng([m.x, m.y])));
      } else {
        const members = group.ids.map((id) => byId.get(id));
        const bubble = L.marker(map.containerPointToLatLng([group.x, group.y]), {
          icon: bubbleIcon(members), title: latest.current.label(members.length), alt: latest.current.label(members.length), keyboard: true,
        });
        bubble.on('click', () => map.fitBounds(L.latLngBounds(members.map((m) => [m.lat, m.lng])), { padding: [48, 48], maxZoom: map.getMaxZoom(), animate: !reducedMotion() }));
        bubble.addTo(layer);
        nameMarker(bubble, latest.current.label(members.length));
      }
    });
  };

  useEffect(() => {
    const reduced = reducedMotion();
    const map = L.map(box.current, {
      zoomControl: false, attributionControl: false, maxZoom: MAX_ZOOM, minZoom: 9, zoomAnimation: !reduced, fadeAnimation: !reduced, markerZoomAnimation: !reduced,
    });
    L.tileLayer(TILES, { maxZoom: MAX_ZOOM, maxNativeZoom: 19 }).addTo(map);
    map.setView([estate.lat, estate.lng], 13);
    L.marker([estate.lat, estate.lng], {
      icon: estateIcon(), interactive: false, keyboard: false, zIndexOffset: -1000,
    }).addTo(map);
    inner.current = { map, layer: L.layerGroup().addTo(map), me: null, pins: new Map() };
    map.on('zoomend moveend', draw);
    const watcher = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => map.invalidateSize());
    if (watcher) watcher.observe(box.current);
    draw();
    return () => {
      if (watcher) watcher.disconnect();
      map.remove();
      inner.current = { map: null, layer: null, me: null, pins: new Map() };
    };
    // The map is built once; the places and the selection reach it through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { map } = inner.current;
    if (!map) return;
    const bounds = L.latLngBounds([[estate.lat, estate.lng], ...places.map((p) => [p.lat, p.lng])]);
    map.fitBounds(bounds, { ...FIT, animate: !reducedMotion() });
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, estate.lat, estate.lng]);

  useEffect(() => {
    inner.current.pins.forEach((marker, id) => {
      const place = latest.current.places.find((p) => p.id === id);
      if (!place) return;
      marker.setIcon(pinIcon(place, id === selectedId));
      nameMarker(marker, `${place.name}, ${place.categoryLabel}`);
    });
  }, [selectedId]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => inner.current.map && inner.current.map.zoomIn(1, { animate: !reducedMotion() }),
    zoomOut: () => inner.current.map && inner.current.map.zoomOut(1, { animate: !reducedMotion() }),
    locate: () => {
      if (!navigator.geolocation) { latest.current.onLocateError(); return; }
      navigator.geolocation.getCurrentPosition((position) => {
        const { map } = inner.current;
        if (!map) return;
        const at = [position.coords.latitude, position.coords.longitude];
        if (inner.current.me) inner.current.me.setLatLng(at);
        else inner.current.me = L.marker(at, { icon: meIcon(), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
        map.setView(at, Math.max(map.getZoom(), 14), { animate: !reducedMotion() });
      }, () => latest.current.onLocateError(), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    },
  }), []);

  return <div className="pl-map" ref={box} role="region" aria-label={t('places.mapLabel')} />;
});

export default PlacesMap;
