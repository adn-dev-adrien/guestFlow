// Shared fixtures of the guest app suites (specs/guest-app.md). Not a test file: a fetch stub that answers the
// guest API from a route table, the payloads the server sends, and a render of the whole app at a path.
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import App from '../App';

export const ME_STAY = {
  mode: 'stay',
  lodging: { id: 1, name: 'La Granja', slug: 'la-granja' },
  language: 'fr',
  tiles: [
    { key: 'gate', label: 'Portail', order: 0 },
    { key: 'wifi', label: 'Wifi', order: 1 },
    { key: 'shop', label: 'Boutique', order: 2 },
    { key: 'booklet', label: 'Livret', order: 3 },
  ],
  guest: { firstName: 'Marie' },
  stay: { arrival: '2099-07-06T16:00:00+02:00', departure: '2099-07-09T10:00:00+02:00', partySize: 3, statusLine: 'Jour 2 sur 4' },
};

export const LODGING = {
  name: 'La Granja',
  heroUrl: null,
  modules: [
    { key: 'gate', label: 'Portail', order: 0 },
    { key: 'wifi', label: 'Wifi', order: 1 },
    { key: 'shop', label: 'Boutique', order: 2 },
    { key: 'booklet', label: 'Livret', order: 3 },
    { key: 'orders', label: 'Mes commandes', order: 4 },
  ],
  wifi: { network: 'Solio', password: 'chenes', joinQr: 'data:image/png;base64,AAAA' },
  contacts: [],
};

export const item = (over = {}) => ({
  kind: 'option', id: 11, title: 'Cidre', shortDescription: null, imageUrl: null, price: 4.5, priceLabel: '4,50 €', priceUnitLabel: 'la bouteille', maxQuantity: 10, needsStaff: false, ...over,
});

export const SHOP = {
  open: true, service: { openNow: true }, canPayCard: true, canPayNote: true,
  categories: [{ name: 'Boissons', items: [item()] }],
};

const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

/** A route answer that fails like a phone without network (`fetch` rejects). */
export const OFFLINE = Object.freeze({ offline: true });

/**
 * `stubApi({ 'GET /me': ME_STAY, 'POST /orders/quote': (body) => ({ … }) })` — a value answers `{ data: value }`
 * with 200; `{ status, error }` answers that error; `OFFLINE` fails as without network; a function receives the
 * parsed body. Unknown routes 404.
 */
export function stubApi(routes) {
  const calls = [];
  const fetchStub = vi.fn((url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const path = String(url).replace(/^\/public\/v1\/guest/, '').split('?')[0];
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, url: String(url) });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      return m === method && (p === path || (p.endsWith('*') && path.startsWith(p.slice(0, -1))));
    });
    if (!key) return json(404, { error: { code: 'NOT_STUBBED', message: `${method} ${path}` } });
    let answer = routes[key];
    if (typeof answer === 'function') answer = answer(body, calls);
    if (answer === OFFLINE) return Promise.reject(new TypeError('Failed to fetch'));
    if (answer && answer.status && answer.error) return json(answer.status, { error: answer.error, ...(answer.plugin ? { plugin: answer.plugin } : {}) });
    return json(200, { data: answer });
  });
  vi.stubGlobal('fetch', fetchStub);
  return { calls, fetchStub };
}

export function renderApp(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

export const baseRoutes = (over = {}) => ({
  'GET /me': ME_STAY,
  'GET /lodging': LODGING,
  'GET /gate': { state: 'active', url: 'https://gate.example.test/k/1' },
  'GET /orders': { orders: [] },
  'GET /booklet': { version: 1, pages: [] },
  'GET /shop': SHOP,
  ...over,
});
