// Shared fixtures for the WordPress plugin's browser scripts (integrations/wordpress/guestflow-booking):
// they are plain ES files with no build, so the suites read them from disk and run them in jsdom, with
// the real French strings of class-gf-blocks.php and a fake plugin proxy in place of GF.api.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../integrations/wordpress/guestflow-booking');

const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');

/** The `i18n` map the PHP localizes, read from its source (French, the reference strings). */
export function frenchStrings() {
  const php = read('includes/class-gf-blocks.php');
  const out = {};
  for (const m of php.matchAll(/'([A-Za-z0-9_]+)'\s*=>\s*__\('((?:[^'\\]|\\.)*)'/g)) out[m[1]] = m[2].replace(/\\'/g, "'");
  return out;
}

const run = (rel) => new Function(read(rel))(); // eslint-disable-line no-new-func

// The scripts debounce with setTimeout (quote recompute, poll, slices). One still pending when a test
// ends would fire after jsdom is torn down ("document is not defined"), so the timers a block schedules
// are tracked and cleared after each test of every suite that imports this module.
const pendingTimers = new Set();
let saved = null;

// Reads the timer functions at call time and skips the wrapping under vi.useFakeTimers(), so a suite
// that fakes the clock keeps vitest's own setTimeout.
function trackTimers() {
  if (saved || vi.isFakeTimers()) return;
  saved = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = saved.set((...a) => { pendingTimers.delete(id); return fn(...a); }, ms, ...args);
    pendingTimers.add(id);
    return id;
  };
  globalThis.clearTimeout = (id) => { pendingTimers.delete(id); saved.clear(id); };
}

afterEach(() => {
  if (!saved) return;
  pendingTimers.forEach((id) => saved.clear(id));
  pendingTimers.clear();
  globalThis.setTimeout = saved.set;
  globalThis.clearTimeout = saved.clear;
  saved = null;
});

/**
 * Loads the runtime, then the block script `view`, for the containers already in the document.
 * `routes` answers the fake proxy: (method, path, body) → { status, body }.
 */
export function loadBlock(view, { routes, locale = 'fr-FR', lang = 'fr', configured = true }) {
  const calls = [];
  window.GFBooking = {
    restUrl: '/wp-json/guestflow/v1', nonce: 'n', configured, locale, lang,
    cgvPageUrl: 'https://site.example/cgv/', bookingPageUrl: '', i18n: frenchStrings(),
  };
  trackTimers();
  run('assets/runtime.js');
  window.GFBooking.api = (method, p, body) => {
    calls.push({ method, path: p, body });
    return Promise.resolve(routes(method, p.split('?')[0], body));
  };
  run(view);
  return { calls, GF: window.GFBooking };
}

export function bookingContainer({ propertyId = 1, payOnline = false } = {}) {
  document.body.innerHTML = `<div data-gf-booking data-property-id="${propertyId}" data-show-options="1" data-pay-online="${payOnline ? '1' : '0'}"></div>`;
  return document.querySelector('[data-gf-booking]');
}

export const DETAIL = { id: 1, name: 'La Granja', maxGuests: 6, maxBabies: 1, defaultCheckIn: '16:00', defaultCheckOut: '10:00' };
export const OPTIONS = { ungrouped: [{ id: 5, title: 'Petit déjeuner', price: 8, priceUnitLabel: 'par petit déjeuner' }], groups: [] };

export function quote(over = {}) {
  return {
    propertyId: 1, nights: 3, accommodationTotal: 300, options: [], resources: [], optionLimits: [],
    touristTax: { total: 10 }, finalPrice: 300, totalStayPrice: 310, available: true,
    payment: { mode: 'full', onlineReady: true },
    ...over,
  };
}

/** A proxy that answers the catalogue reads, and `extra` for everything else. */
export function catalogueRoutes(extra = () => null, { terms = { status: 200, body: { data: { version: 2 } } }, blocked = [] } = {}) {
  return (method, p, body) => {
    const own = extra(method, p, body);
    if (own) return own;
    if (p === '/properties/1') return { status: 200, body: { data: DETAIL } };
    if (p === '/properties/1/options') return { status: 200, body: { data: OPTIONS } };
    if (p === '/properties/1/resources') return { status: 200, body: { data: [] } };
    if (p === '/properties/1/availability') return { status: 200, body: { data: { blockedDates: blocked } } };
    if (p === '/terms') return terms;
    if (p === '/quote') return { status: 200, body: { data: quote() } };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
  };
}

/** Two days of next month, always inside the two-month window the widget opens on. */
export function nextMonthDays(a = 10, b = 13) {
  const now = new Date();
  const y = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
  const m = (now.getMonth() + 1) % 12;
  const label = (d) => new Date(y, m, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const iso = (d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { a: { label: label(a), iso: iso(a) }, b: { label: label(b), iso: iso(b) } };
}
