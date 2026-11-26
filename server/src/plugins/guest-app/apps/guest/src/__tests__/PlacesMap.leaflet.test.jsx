// specs/guest-app/guest-app-local-amenities.md rules 2, 3, 8 — what PlacesMap asks of Leaflet: OpenStreetMap tiles, the estate's own marker that
// nothing can click, one marker per place or a counted bubble for the ones closer than 28 px, « Me localiser » that shows the
// device's position on the map and sends it nowhere. Leaflet itself is a stand-in (jsdom has no layout): a flat projection.
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LangContext } from '../i18n';
import PlacesMap from '../components/PlacesMap';
import { BAKERY, BAKERY_2, BINS } from './placesFixtures';

const fake = vi.hoisted(() => {
  const state = { markers: [], tiles: [], zoom: 13, map: null };
  return state;
});

vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('leaflet', () => {
  const layer = { clearLayers: () => { fake.markers = fake.markers.filter((m) => !m.inLayer); }, addTo: () => layer };
  const makeMap = () => ({
    handlers: {},
    setView: vi.fn(),
    fitBounds: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    remove: vi.fn(),
    invalidateSize: vi.fn(),
    on(event, fn) { this.handlers[event] = fn; },
    getZoom: () => fake.zoom,
    getMaxZoom: () => 18,
    // 1 degree = 1 000 000 px, in both directions: places 0.00001° apart are 10 px apart.
    latLngToContainerPoint: ([lat, lng]) => ({ x: lng * 1e6, y: -lat * 1e6 }),
    containerPointToLatLng: ([x, y]) => [-y / 1e6, x / 1e6],
  });
  const marker = (latlng, options) => {
    const record = { latlng, options, handlers: {}, inLayer: false, setLatLng: vi.fn(), setIcon: vi.fn(), getElement: () => null };
    record.on = (event, fn) => { record.handlers[event] = fn; return record; };
    record.addTo = (target) => { record.inLayer = target === layer; return record; };
    fake.markers.push(record);
    return record;
  };
  return {
    default: {
      map: vi.fn(() => { fake.map = makeMap(); return fake.map; }),
      tileLayer: vi.fn((url, options) => { fake.tiles.push({ url, options }); return { addTo: () => {} }; }),
      layerGroup: () => layer,
      marker: vi.fn(marker),
      divIcon: (options) => options,
      latLngBounds: (points) => points,
    },
  };
});

const ESTATE = { lat: 45.16369, lng: 4.63184 };
const renderMap = (places, props = {}) => {
  const ref = createRef();
  const onSelect = vi.fn();
  const onLocateError = vi.fn();
  render(<LangContext.Provider value="fr"><PlacesMap ref={ref} places={places} estate={ESTATE} selectedId={null} onSelect={onSelect} onLocateError={onLocateError} {...props} /></LangContext.Provider>);
  return { ref, onSelect, onLocateError };
};
const inLayer = () => fake.markers.filter((m) => m.inLayer);

beforeEach(() => { fake.markers = []; fake.tiles = []; fake.zoom = 13; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('PlacesMap — the map (rules 2, 3)', () => {
  it('asks for the tiles with a referrer: the app\'s own policy sends none and OpenStreetMap refuses a tile without one (rule 2)', () => {
    renderMap([BAKERY]);
    expect(fake.tiles[0].options.referrerPolicy).toBe('strict-origin-when-cross-origin');
  });

  it('redraws its markers on a zoom only, so a pan keeps the focus on a marker (rule 3)', () => {
    renderMap([BAKERY]);
    expect(Object.keys(fake.map.handlers)).toEqual(['zoomend']);
  });

  it('draws OpenStreetMap tiles, the estate\'s own marker that cannot be clicked, and one marker per place', () => {
    const { onSelect } = renderMap([BINS, BAKERY, BAKERY_2]);
    expect(fake.tiles).toHaveLength(1);
    expect(fake.tiles[0].url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    const estate = fake.markers.find((m) => !m.inLayer);
    expect(estate.latlng).toEqual([ESTATE.lat, ESTATE.lng]);
    expect(estate.options).toMatchObject({ interactive: false, keyboard: false });
    const pins = inLayer();
    expect(pins.map((m) => m.options.title)).toEqual(['Point de collecte du bourg', 'Maison Roux', 'Boulangerie du Lac']);
    pins[1].handlers.click();
    expect(onSelect).toHaveBeenCalledWith(BAKERY.id);
    expect(screen.getByRole('region', { name: /Carte des commerces/ })).toBeInTheDocument();
  });

  it('markers closer than 28 px become one counted bubble that zooms to its members when tapped', () => {
    // 0.00001° = 10 px: the two bakeries are 10 px apart, the waste place is far.
    const near = { ...BAKERY_2, lat: BAKERY.lat + 0.00001, lng: BAKERY.lng };
    renderMap([BAKERY, near, { ...BINS, lat: 45.3, lng: 4.9 }]);
    const drawn = inLayer();
    expect(drawn).toHaveLength(2);
    const bubble = drawn.find((m) => m.options.title === '2 lieux à cet endroit');
    expect(bubble).toBeTruthy();
    expect(bubble.options.icon.html).toContain('<b>2</b>');
    bubble.handlers.click();
    expect(fake.map.fitBounds).toHaveBeenLastCalledWith([[BAKERY.lat, BAKERY.lng], [near.lat, near.lng]], expect.objectContaining({ maxZoom: 18 }));
  });

  it('at the maximum zoom, markers on the same spot fan out instead of grouping', () => {
    fake.zoom = 18;
    renderMap([BAKERY, { ...BAKERY_2, lat: BAKERY.lat, lng: BAKERY.lng }]);
    const pins = inLayer();
    expect(pins).toHaveLength(2);
    expect(pins.every((m) => m.options.title !== '2 lieux à cet endroit')).toBe(true);
    expect(pins[0].latlng).not.toEqual(pins[1].latlng);
  });
});

describe('PlacesMap — « Me localiser » (rule 8)', () => {
  it('shows the device\'s position on the map and sends it nowhere', () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const getCurrentPosition = vi.fn((ok) => ok({ coords: { latitude: 45.17, longitude: 4.64 } }));
    vi.stubGlobal('navigator', { ...window.navigator, geolocation: { getCurrentPosition } });
    const { ref, onLocateError } = renderMap([BAKERY]);
    ref.current.locate();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    const dot = fake.markers.find((m) => m.latlng[0] === 45.17);
    expect(dot).toBeTruthy();
    expect(dot.options).toMatchObject({ interactive: false });
    expect(fake.map.setView).toHaveBeenLastCalledWith([45.17, 4.64], 14, expect.anything());
    expect(fetchStub).not.toHaveBeenCalled();
    expect(onLocateError).not.toHaveBeenCalled();
    ref.current.locate();
    expect(fake.markers.filter((m) => m.latlng[0] === 45.17)).toHaveLength(1);
  });

  it('a refused or unavailable position changes nothing and says so', () => {
    const getCurrentPosition = vi.fn((ok, fail) => fail({ code: 1 }));
    vi.stubGlobal('navigator', { ...window.navigator, geolocation: { getCurrentPosition } });
    const first = renderMap([BAKERY]);
    first.ref.current.locate();
    expect(first.onLocateError).toHaveBeenCalledTimes(1);
    expect(fake.markers.some((m) => m.latlng[0] === 45.17)).toBe(false);

    vi.stubGlobal('navigator', { ...window.navigator, geolocation: undefined });
    const second = renderMap([BAKERY]);
    second.ref.current.locate();
    expect(second.onLocateError).toHaveBeenCalledTimes(1);
  });
});
