// specs/gift-vouchers/gift-voucher-campaigns.md rule 64 — the extra time and the add-ons sit in one fold « Ajouter au bon », closed by default; its head says what is inside and, once
// something is chosen, the names and the server's `extrasCents`; each line shows the price the server gives for its quantity, read in the `prices` arrays, never multiplied;
// at the maximum the « + » is disabled and the line says so. The same fold serves the purchase block and « Utiliser un bon cadeau ».
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { loadBlock } from './wordpressBookingFixtures';

const ASSETS = ['assets/voucher-code.js', 'assets/voucher-parts.js', 'assets/voucher-card.js'];

// Deliberately not multiples of the unit: a page that multiplied would show another figure.
const DRINK_PRICES = [650, 1280, 1850, 2400, 2950].map((cents, i) => ({ qty: i + 1, cents }));
const BATH = {
  slug: 'bain-jour',
  kind: 'resource',
  title: 'Un bain nordique',
  validityMonths: 12,
  band: { key: 'day', label: 'journée', from: '10:00', to: '19:00' },
  contents: [{ kind: 'session', label: 'Bain nordique', detail: '2 h en journée · de 10:00 à 19:00', qty: 1 }],
  addOns: [
    {
      articleRef: 'option:7', label: 'Boisson', maxQty: 5, unitLabel: 'l’unité', linear: true, prices: DRINK_PRICES,
    },
    {
      articleRef: 'option:8', label: 'Peignoir', maxQty: 3, unitLabel: 'par personne', linear: false, prices: [{ qty: 1, cents: 500 }, { qty: 2, cents: 900 }, { qty: 3, cents: 1200 }],
    },
  ],
  extraTime: { maxMinutes: 120, stepMinutes: 60, prices: [{ minutes: 60, cents: 4500 }, { minutes: 120, cents: 8700 }] },
  totalCents: 10900,
  termsVersionId: 9,
};
const LODGING = {
  slug: 'sejour', kind: 'lodging', title: 'Bon cadeau', validityMonths: 18, minAmountCents: 2000, maxAmountCents: 200000, ideas: [], termsVersionId: 4,
};
const OFFER = { available: true, brand: 'Domaine Solio', termsVersionId: 4, validityMonths: 12, ideas: [], campaigns: [LODGING, BATH] };

function setup({ pricing = () => ({ status: 200, body: { data: { lines: [], totalCents: 10900, extrasCents: 4321, vat: [] } } }), offer = OFFER } = {}) {
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  const routes = (method, p, body) => {
    if (p === '/gift-vouchers/offer') return { status: 200, body: { data: offer } };
    if (p === '/gift-vouchers/offer/price') return pricing(body);
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
  };
  const loaded = loadBlock('blocks/gift-voucher/view.js', { routes, assets: ASSETS });
  loaded.GF.voucherGo = vi.fn();
  return loaded;
}

const flat = (text) => text.replace(/\s/g, ' ');
const fold = () => document.querySelector('.gf-fold');
const head = () => document.querySelector('.gf-fold-head');
const lineOf = (name) => [...document.querySelectorAll('.gf-fold-row')].find((row) => row.textContent.includes(name));
const openBlock = async () => {
  setup();
  fireEvent.click(await screen.findByText('Un bain nordique', { selector: 'b' }));
  await screen.findByText('Récapitulatif');
};

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; window.location.hash = ''; });

test('rule 64: the fold is closed on the first draw, its body inert, and the head counts what is inside with the lowest first price', async () => {
  await openBlock();
  expect(document.querySelectorAll('.gf-fold')).toHaveLength(1);
  expect(head().getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('.gf-fold-inner').hasAttribute('inert')).toBe(true);
  expect(head().getAttribute('aria-controls')).toBe(document.querySelector('.gf-fold-body').id);
  expect(document.querySelector('.gf-fold-title').textContent).toBe('Ajouter au bon');
  expect(flat(document.querySelector('.gf-fold-sub').textContent)).toBe('3 disponibles · dès 5 €');
});

test('rule 64: the head opens and closes the fold, and the closed body is inert again', async () => {
  await openBlock();
  fireEvent.click(head());
  expect(head().getAttribute('aria-expanded')).toBe('true');
  expect(fold().classList.contains('is-open')).toBe(true);
  expect(document.querySelector('.gf-fold-inner').hasAttribute('inert')).toBe(false);
  fireEvent.click(head());
  expect(head().getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('.gf-fold-inner').hasAttribute('inert')).toBe(true);
});

test('rule 64: every line shows the price of one step, read from the server, with its unit', async () => {
  await openBlock();
  expect(flat(lineOf('Temps supplémentaire').textContent)).toContain('45 € par tranche de 1 h');
  expect(flat(lineOf('Boisson').textContent)).toContain('6,50 € l’unité');
  expect(flat(lineOf('Peignoir').textContent)).toContain('5 € par personne');
  expect(document.querySelector('.gf-fold-foot').textContent).toBe('Prix TTC, ajoutés au montant du bon.');
});

test('rule 64: a chosen line shows its price for that quantity — looked up, never multiplied — and the head shows the names and the server’s extrasCents', async () => {
  await openBlock();
  const more = (name) => screen.getByLabelText(`Ajouter : ${name}`);
  fireEvent.click(more('Boisson'));
  fireEvent.click(more('Boisson'));
  expect(flat(lineOf('Boisson').textContent)).toContain('2 × 6,50 € = 12,80 €');
  fireEvent.click(more('Peignoir'));
  fireEvent.click(more('Peignoir'));
  expect(flat(lineOf('Peignoir').textContent)).toContain('2 : 9 €');
  fireEvent.click(more('Temps supplémentaire'));
  expect(flat(lineOf('Temps supplémentaire').textContent)).toContain('+1 h = 45 €');
  expect(document.querySelector('.gf-fold-names').textContent).toBe('+1 h, Boisson ×2, Peignoir ×2');
  expect(document.querySelector('.gf-fold-count').textContent).toBe('3');
  await waitFor(() => expect(flat(document.querySelector('.gf-fold-y').textContent)).toBe('+ 43,21 €'));
});

test('rule 64: while the price is being asked the head shows « … » in place of the amount, and nothing when nothing is chosen', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  setup({ pricing: () => pending });
  fireEvent.click(await screen.findByText('Un bain nordique', { selector: 'b' }));
  expect(document.querySelector('.gf-fold-y').textContent).toBe('');
  fireEvent.click(screen.getByLabelText('Ajouter : Boisson'));
  expect(document.querySelector('.gf-fold-y').textContent).toBe('+ …');
  release({ status: 200, body: { data: { lines: [], totalCents: 10900, extrasCents: 650, vat: [] } } });
  await waitFor(() => expect(flat(document.querySelector('.gf-fold-y').textContent)).toBe('+ 6,50 €'));
});

test('rule 64: at the maximum the « + » is disabled and the line says so; the extra time stops at the server’s maximum', async () => {
  await openBlock();
  const peignoir = screen.getByLabelText('Ajouter : Peignoir');
  [1, 2, 3].forEach(() => fireEvent.click(peignoir));
  expect(peignoir.disabled).toBe(true);
  expect(flat(lineOf('Peignoir').textContent)).toContain('3 au maximum par bon');
  const time = screen.getByLabelText('Ajouter : Temps supplémentaire');
  fireEvent.click(time);
  fireEvent.click(time);
  expect(time.disabled).toBe(true);
  expect(flat(lineOf('Temps supplémentaire').textContent)).toContain('+2 h = 87 €');
  expect(flat(lineOf('Temps supplémentaire').textContent)).toContain('2 h au maximum par bon');
});

test('rule 64: a campaign offering neither extra time nor an add-on draws no fold', async () => {
  setup({ offer: { ...OFFER, campaigns: [LODGING, { ...BATH, addOns: [], extraTime: null }] } });
  fireEvent.click(await screen.findByText('Un bain nordique', { selector: 'b' }));
  await screen.findByText('Récapitulatif');
  expect(fold()).toBeNull();
});

test('rule 64: a line the server could not price is not drawn, and with none left there is no fold', async () => {
  setup({ offer: { ...OFFER, campaigns: [LODGING, { ...BATH, addOns: [{ ...BATH.addOns[0], prices: [] }], extraTime: { ...BATH.extraTime, prices: [] } }] } });
  fireEvent.click(await screen.findByText('Un bain nordique', { selector: 'b' }));
  await screen.findByText('Récapitulatif');
  expect(fold()).toBeNull();
});
