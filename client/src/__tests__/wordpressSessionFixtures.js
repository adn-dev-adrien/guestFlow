// Shared fixtures of the « Réserver une séance » suites (specs/site/site-outside-resource-booking.md): the real scripts of the WordPress plugin, run in jsdom against a fake proxy that answers
// what GuestFlow answers. Not a test file. A suite keeps its own `vi.mock`-free setup: the block talks to `GF.api`, which `loadBlock` replaces.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, waitFor } from '@testing-library/react';
import { loadBlock } from './wordpressBookingFixtures';

// The plugin's own code module, read as Node does (it exports itself under `module`): a code with a good check character.
const VC = (() => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../integrations/wordpress/guestflow-booking/assets/voucher-code.js');
  const holder = { exports: {} };
  new Function('module', 'window', fs.readFileSync(file, 'utf8'))(holder); // eslint-disable-line no-new-func
  return holder.exports;
})();

export const ASSETS = ['assets/voucher-code.js', 'assets/voucher-parts.js'];
export const VIEW = 'blocks/session-booking/view.js';

export function validCode() {
  const base = '7K2QHD9M4TXB3NP';
  return [...VC.ALPHABET].map((c) => base + c).find((c) => VC.hasValidCheck(c));
}

export const monthsAhead = (n) => {
  const d = new Date();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 28);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-28`;
};

export const flat = (text) => text.replace(/\s/g, ' ');
export const callsTo = (calls, path_) => calls.filter((c) => c.path === path_);

export const BATH = {
  id: 3,
  name: 'Bain nordique',
  blurb: 'Au feu de bois',
  fromCents: 5000,
  minMinutes: 60,
  stepMinutes: 60,
  maxMinutes: 720,
  maxPeople: 8,
  horizonUntil: monthsAhead(2),
  termsVersionId: 9,
  addOns: [{
    articleRef: 'option:7', label: 'Planche apéro', maxQty: 4, unitLabel: 'l’unité', linear: true, prices: [{ qty: 1, cents: 1400 }, { qty: 2, cents: 2800 }],
  }],
};

const dayOf = (from) => `${from.slice(0, 8)}20`;

/** What `/sessions/slots` answers: the price of the whole session from each start, the evening marked, a start taken. */
export function sessionSlots(body) {
  return {
    status: 200,
    body: {
      data: {
        horizonUntil: BATH.horizonUntil,
        days: [{
          date: dayOf(body.from),
          slots: [
            { start: '10:00', end: `${10 + body.minutes / 60}:00`.padStart(5, '0'), dueCents: 5000 + 4500 * (body.minutes / 60 - 1), evening: false },
            { start: '14:00', end: '16:00', taken: true },
            { start: '19:00', end: '21:00', dueCents: 11300, evening: true },
          ],
        }],
      },
    },
  };
}

/** What `/sessions/quote` answers. */
export function sessionQuote(body) {
  const evening = body.start.endsWith('T19:00');
  const parts = evening
    ? [{ label: '19:00 – 20:00 · journée', band: 'day', cents: 5000 }, { label: '20:00 – 21:00 · soirée', band: 'evening', cents: 6300 }]
    : [{ label: '10:00 – 11:00 · journée', band: 'day', cents: 5000 }];
  const boards = ((body.addOns || []).find((a) => a.articleRef === 'option:7') || {}).qty || 0;
  const extras = boards ? [{ label: 'Planche apéro', detail: null, qty: boards, cents: boards * 1400 }] : [];
  const dueCents = parts.reduce((s, p) => s + p.cents, 0) + extras.reduce((s, e) => s + e.cents, 0);
  return {
    status: 200,
    body: {
      data: {
        date: body.start.slice(0, 10), start: body.start.slice(11), end: evening ? '21:00' : '11:00', parts, extras, dueCents, vat: [{ rate: 10, cents: 1027 }],
      },
    },
  };
}

/** The block, with a fake proxy: `over.routes(method, path, body)` answers first. Returns the calls, the confirmations and the runtime. */
export function setup(over = {}) {
  document.body.innerHTML = '<div data-gf-session-booking></div>';
  const confirmations = [];
  const routes = (method, p, body) => {
    if (over.routes) { const own = over.routes(method, p, body); if (own) return own; }
    if (p === '/sessions/resources') return { status: 200, body: { data: over.resources || [BATH] } };
    if (p === '/sessions/slots') return sessionSlots(body);
    if (p === '/sessions/quote') return sessionQuote(body);
    if (p === '/sessions/confirm') {
      confirmations.push(body);
      return { status: 200, body: { data: { payUrl: 'https://pay.example/session/1', heldUntil: '2026-11-18T10:15:00.000Z', dueCents: 11300 } } }; // date-literal-ok: a payload the mocked server answers; the screen only shows it
    }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
  };
  const loaded = loadBlock(VIEW, { routes, assets: ASSETS, config: over.config || {} });
  loaded.GF.voucherGo = vi.fn();
  return { ...loaded, confirmations };
}

export const firstFreeDay = () => waitFor(() => {
  const found = document.querySelector('.gf-sb-days button.gf-free');
  if (!found) throw new Error('no free day yet');
  return found;
});

export const slotButton = (start) => waitFor(() => {
  const found = document.querySelector(`.gf-sb-slot[data-start="${start}"]`);
  if (!found) throw new Error('no slot yet');
  return found;
});

/** Opens the block on a day and a start; resolves once the server's recap is drawn. */
export async function pickSlot(start = '10:00') {
  fireEvent.click(await firstFreeDay());
  fireEvent.click(await slotButton(start));
  await waitFor(() => expect(document.querySelector('.gf-summary').textContent).toMatch(/À payer|Rien à payer/));
}

export function fillWho({
  first = 'Marie', last = 'Dupont', email = 'marie@example.test', phone = '06 12 34 56 78', terms = true,
} = {}) {
  const inputs = [...document.querySelectorAll('.gf-sb-who input')];
  const [firstInput, lastInput, emailInput, phoneInput] = inputs;
  fireEvent.change(firstInput, { target: { value: first } });
  fireEvent.change(lastInput, { target: { value: last } });
  fireEvent.change(emailInput, { target: { value: email } });
  fireEvent.change(phoneInput, { target: { value: phone } });
  if (terms) fireEvent.click(document.querySelector('.gf-cgv-accept input'));
}

export const bar = () => document.querySelector('.gf-sb > .gf-bar');
export const barButton = () => document.querySelector('.gf-sb > .gf-bar .gfb-cta');

export function resetPage() {
  document.body.innerHTML = '';
  delete window.GFBooking;
  window.location.hash = '';
  window.history.replaceState(null, '', '/');
}
