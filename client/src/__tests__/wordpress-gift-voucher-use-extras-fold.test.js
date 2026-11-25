// specs/gift-voucher-campaigns.md rule 63 — « Utiliser un bon cadeau »: the same « Ajouter au bon » fold, whose extra-time row shows the offer's prices until a slot is chosen and then
// the prices the server's quote answers for that start (`extraTimePrices`), so the row never disagrees with the recap; the head's amount is the quote's `extrasCents`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { loadBlock } from './wordpressBookingFixtures';

// The plugin's own code module, read as Node does (it exports itself under `module`): a code with a good check character.
const VC = (() => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../integrations/wordpress/guestflow-booking/assets/voucher-code.js');
  const holder = { exports: {} };
  new Function('module', 'window', fs.readFileSync(file, 'utf8'))(holder); // eslint-disable-line no-new-func
  return holder.exports;
})();

const ASSETS = ['assets/voucher-code.js', 'assets/voucher-parts.js'];
const VIEW = 'blocks/gift-voucher-use/view.js';
const validCode = () => {
  const base = '7K2QHD9M4TXB3NP';
  return [...VC.ALPHABET].map((c) => base + c).find((c) => VC.hasValidCheck(c));
};
const monthsAhead = (n) => {
  const d = new Date();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 28);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-28`;
};

// Past the band's end the dateless pricing cannot price a step: the server lists it with `cents: null`, and the slot's own quote prices it.
const OFFER_TIME = [{ minutes: 60, cents: 4500 }, { minutes: 120, cents: 9000 }, { minutes: 180, cents: 13500 }, { minutes: 240, cents: null }, { minutes: 300, cents: null }];
const EVENING_TIME = [{ minutes: 60, cents: 6300 }, { minutes: 120, cents: 12600 }];
const VOUCHER = {
  kind: 'resource',
  title: 'Un bain nordique',
  number: 'BC-1',
  resource: { id: 1, name: 'Bain nordique', band: 'day', minutes: 120 },
  contents: [{ kind: 'session', label: 'Bain nordique', detail: '2 h en journée', qty: 1 }],
  recipientName: '',
  senderName: '',
  message: '',
  expiresOn: '2099-01-01', // date-literal-ok: a payload the mocked server answers; the screen only shows it
  usedOn: null,
  addOns: [{
    articleRef: 'option:7', label: 'Boisson', maxQty: 2, unitLabel: 'l’unité', linear: true, prices: [{ qty: 1, cents: 777 }, { qty: 2, cents: 1554 }],
  }],
  extraTime: { stepMinutes: 60, prices: OFFER_TIME },
  horizonUntil: monthsAhead(2),
  termsVersionId: 9,
};

function quoted(body) {
  const evening = body.start.endsWith('T17:00');
  const extras = body.extraMinutes ? [{ label: 'Temps supplémentaire', detail: null, qty: 1, cents: evening ? 6300 : 4500 }] : [];
  return {
    date: body.start.slice(0, 10),
    start: body.start.slice(11),
    end: '12:00',
    included: [{ label: 'Bain nordique · 2 h', detail: null, qty: 1, valueCents: 9500, vatRate: 20 }],
    supplement: null,
    extras,
    extrasCents: extras.reduce((sum, e) => sum + e.cents, 0),
    extraTimePrices: evening ? EVENING_TIME : OFFER_TIME,
    dueCents: extras.reduce((sum, e) => sum + e.cents, 0),
    totalCents: 9500,
    vat: [{ rate: 20, cents: 2 }],
  };
}

function setup() {
  document.body.innerHTML = '<div data-gf-gift-voucher-use></div>';
  const routes = (method, p, body) => {
    if (p === '/gift-vouchers/offer') return { status: 200, body: { data: { available: true, campaigns: [] } } };
    if (p === '/gift-vouchers/use') return { status: 200, body: { data: VOUCHER } };
    if (p === '/gift-vouchers/use/slots') {
      const day = `${body.from.slice(0, 8)}20`;
      return { status: 200, body: { data: { horizonUntil: VOUCHER.horizonUntil, days: [{ date: day, slots: [{ start: '10:00', end: '12:00', tag: 'in', supplementCents: 0 }, { start: '17:00', end: '19:00', tag: 'supplement', supplementCents: 1500 }] }] } } };
    }
    if (p === '/gift-vouchers/use/quote') return { status: 200, body: { data: quoted(body) } };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
  };
  const loaded = loadBlock(VIEW, { routes, assets: ASSETS });
  loaded.GF.voucherGo = vi.fn();
  return loaded;
}

const flat = (text) => text.replace(/\s/g, ' ');
const extraRow = () => [...document.querySelectorAll('.gf-fold-row')].find((row) => row.textContent.includes('Temps supplémentaire'));
async function chooseSlot(slot, { extra = false } = {}) {
  window.location.hash = `#bon=${validCode()}`;
  setup();
  await screen.findByText('Votre bon comprend');
  if (extra) fireEvent.click(screen.getByLabelText('Ajouter : Temps supplémentaire'));
  fireEvent.click(await waitFor(() => {
    const found = document.querySelector('.gf-use-days button.gf-free');
    if (!found) throw new Error('no free day yet');
    return found;
  }));
  fireEvent.click(await waitFor(() => {
    const found = document.querySelector(`.gf-use-slot[data-start="${slot}"]`);
    if (!found) throw new Error('no slot yet');
    return found;
  }));
}

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; window.location.hash = ''; window.history.replaceState(null, '', '/'); });

test('rule 63: the fold is drawn on « Utiliser un bon », closed, with the offer’s extra-time price; the stepper reaches the last listed step, a step with no price says it depends on the slot', async () => {
  window.location.hash = `#bon=${validCode()}`;
  setup();
  await screen.findByText('Votre bon comprend');
  expect(document.querySelector('.gf-fold-head').getAttribute('aria-expanded')).toBe('false');
  expect(flat(extraRow().textContent)).toContain('45 € par tranche de 1 h');
  const more = screen.getByLabelText('Ajouter : Temps supplémentaire');
  [1, 2, 3].forEach(() => fireEvent.click(more));
  expect(flat(extraRow().textContent)).toContain('+3 h = 135 €');
  expect(more.disabled).toBe(false);
  fireEvent.click(more);
  expect(flat(extraRow().textContent)).toContain('+4 h · prix selon le créneau');
  fireEvent.click(more);
  expect(more.disabled).toBe(true);
  expect(extraRow().textContent).not.toContain('au maximum');
});

test('rule 63: once a slot is chosen the extra-time row reads the prices the quote answers for that start, and the head shows the quote’s extrasCents', async () => {
  await chooseSlot('17:00', { extra: true });
  await waitFor(() => expect(flat(document.querySelector('.gf-use-recap').textContent)).toContain('63,00 €'));
  expect(flat(extraRow().textContent)).toContain('+1 h = 63 €');
  expect(flat(document.querySelector('.gf-fold-y').textContent)).toBe('+ 63 €');
});

test('rule 63: while the next quote is pending the extra-time row keeps the prices of the chosen start, and does not fall back to the offer’s', async () => {
  await chooseSlot('17:00');
  await waitFor(() => expect(flat(extraRow().textContent)).toContain('63 € par tranche de 1 h'));
  fireEvent.click(screen.getByLabelText('Ajouter : Boisson'));
  expect(flat(extraRow().textContent)).toContain('63 € par tranche de 1 h');
  await waitFor(() => expect(document.querySelector('.gf-use-recap').textContent).toContain('Récapitulatif'));
  expect(flat(extraRow().textContent)).toContain('63 € par tranche de 1 h');
});
