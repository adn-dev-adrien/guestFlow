// specs/gift-voucher-campaigns.md rules 16-19, 37, 40 — the purchase block lists the campaigns on sale grouped by kind, a card
// address (`#campagne=<slug>`) opens one directly, a composed voucher draws the SERVER's contents, price lines, total and VAT (the
// page computes nothing), and the terms are those of the campaign's activity. Whatever the way into a campaign, its steppers work.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { loadBlock } from './wordpressBookingFixtures';

const ASSETS = ['assets/voucher-code.js', 'assets/voucher-parts.js'];
const VIEW = 'blocks/gift-voucher/view.js';

const LODGING = {
  slug: 'sejour', kind: 'lodging', title: 'Bon cadeau', validityMonths: 18, minAmountCents: 2000, maxAmountCents: 200000, ideas: [], termsVersionId: 4,
};
const BATH = {
  slug: 'bain-jour',
  kind: 'resource',
  title: 'Un bain nordique',
  validityMonths: 12,
  band: { key: 'day', label: 'journée', from: '10:00', to: '19:00' },
  contents: [
    { kind: 'session', label: 'Bain nordique', detail: '2 h en journée · de 10:00 à 19:00', qty: 1 },
    { kind: 'option', label: 'Planche apéro', detail: null, qty: 1 },
  ],
  addOns: [{
    articleRef: 'option:7', label: 'Boisson', maxQty: 20, unitLabel: 'l’unité', linear: true, prices: Array.from({ length: 20 }, (_, i) => ({ qty: i + 1, cents: (i + 1) * 777 })),
  }],
  extraTime: { maxMinutes: 120, stepMinutes: 60, prices: [{ minutes: 60, cents: 4321 }, { minutes: 120, cents: 8642 }] },
  totalCents: 10900,
  termsVersionId: 9,
};
const OFFER = {
  available: true, brand: 'Domaine Solio', termsVersionId: 4, minAmountCents: 2000, maxAmountCents: 200000, validityMonths: 18, ideas: [], campaigns: [LODGING, BATH],
};

// What the server answers for a composition: the page must draw THESE figures, whatever they are.
const PRICES = { base: 10900, extra: 4321, drink: 777 };
function priced(body) {
  const drinks = ((body.addOns || []).find((a) => a.articleRef === 'option:7') || {}).qty || 0;
  const extra = body.extraMinutes ? PRICES.extra : 0;
  const total = PRICES.base + extra + drinks * PRICES.drink;
  const lines = [{ kind: 'session', label: 'Bain nordique · journée', detail: null, qty: 1, unitCents: 9500, totalCents: 9500, vatRate: 20 }];
  if (extra) lines.push({ kind: 'extra', label: 'Temps supplémentaire · 1 h', detail: null, qty: 1, unitCents: extra, totalCents: extra, vatRate: 20 });
  if (drinks) lines.push({ kind: 'addOn', label: 'Boisson', detail: null, qty: drinks, unitCents: PRICES.drink, totalCents: drinks * PRICES.drink, vatRate: 10 });
  return { lines, totalCents: total, extrasCents: extra + drinks * PRICES.drink, vat: [{ rate: 20, cents: 1817 }, { rate: 5.5, cents: 12 }] };
}

function setup(over = {}) {
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  const orders = [];
  const routes = (method, p, body) => {
    if (p === '/gift-vouchers/offer') return { status: 200, body: { data: over.offer || OFFER } };
    if (p === '/gift-vouchers/offer/price') {
      if (over.refusePrice) return { status: 400, body: { error: { code: 'EXTRA_TIME_NOT_OFFERED', message: 'Temps supplémentaire : 2 h au plus.' } } };
      return { status: 200, body: { data: priced(body) } };
    }
    if (p === '/gift-vouchers/orders') { orders.push(body); return { status: 201, body: { data: { orderId: 12, token: 'tok-12' } } }; }
    if (p === '/gift-vouchers/orders/12/pay') return { status: 200, body: { data: { paymentUrl: 'https://pay.example/12' } } };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
  };
  const loaded = loadBlock(VIEW, { routes: over.routes || routes, assets: ASSETS });
  loaded.GF.voucherGo = vi.fn();
  return { ...loaded, orders };
}

const flat = (text) => text.replace(/\s/g, ' ');
const pricedCalls = (calls) => calls.filter((c) => c.path === '/gift-vouchers/offer/price');
const lastPrice = (calls) => pricedCalls(calls).at(-1).body;

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; window.location.hash = ''; });

test('rule 16: the campaigns on sale are listed grouped by kind, and a click opens the campaign', async () => {
  setup();
  expect(await screen.findByText('Séjours')).toBeTruthy();
  expect(screen.getByText('Séances')).toBeTruthy();
  expect(document.querySelectorAll('.gf-gv-offer')).toHaveLength(2);
  fireEvent.click(document.querySelector('.gf-gv-offer[data-slug="bain-jour"]'));
  expect(await screen.findByText('Le bon comprend')).toBeTruthy();
  expect(screen.getAllByText(/Planche apéro/).length).toBeGreaterThan(0);
  expect(screen.getByText('Séance en journée, de 10:00 à 19:00.')).toBeTruthy();
});

test('rule 16: a lodging campaign keeps the free-amount tunnel, sending its slug', async () => {
  const { calls } = setup();
  fireEvent.click(await screen.findByText('Bon cadeau', { selector: 'b' }));
  expect(document.querySelector('.gf-gv-amount-input')).toBeTruthy();
  expect(screen.getByText('De 20 € à 2 000 €.'.replace(/ /g, ' '), { exact: false })).toBeTruthy();
  expect(pricedCalls(calls)).toHaveLength(0);
});

test('rule 17: the recap is the server’s — lines, total and VAT — and every change asks the server again', async () => {
  const { calls } = setup();
  fireEvent.click(await screen.findByText('Un bain nordique', { selector: 'b' }));
  await screen.findByText('Récapitulatif');
  expect(flat(document.querySelector('.gf-gv-recap').textContent)).toContain('109,00 €');
  expect(document.querySelector('.gf-gv-recap').textContent).toMatch(/dont TVA 20 %.*18,17/);
  expect(document.querySelector('.gf-gv-recap').textContent).toContain('dont TVA 5,5 %');
  expect(lastPrice(calls)).toEqual({ slug: 'bain-jour', extraMinutes: 0, addOns: [] });
  fireEvent.click(screen.getByLabelText('Ajouter : Temps supplémentaire'));
  await waitFor(() => expect(flat(document.querySelector('.gf-gv-recap').textContent)).toContain('152,21 €'));
  expect(lastPrice(calls).extraMinutes).toBe(60);
  expect(screen.getByText('Temps supplémentaire · 1 h')).toBeTruthy();
});

test('rule 17: the extra time follows the server’s step and stops at the server’s maximum', async () => {
  setup();
  fireEvent.click(await screen.findByText('Un bain nordique', { selector: 'b' }));
  const more = await screen.findByLabelText('Ajouter : Temps supplémentaire');
  fireEvent.click(more);
  fireEvent.click(more);
  expect(more.disabled).toBe(true);
  expect(document.querySelector('.gf-step-val').textContent).toBe('+2 h');
});

test('a server refusal of the price is shown as its sentence, and nothing can be paid', async () => {
  const { orders } = setup({ refusePrice: true });
  fireEvent.click(await screen.findByText('Un bain nordique', { selector: 'b' }));
  expect(await screen.findByText('Temps supplémentaire : 2 h au plus.')).toBeTruthy();
  fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: 'paul@example.test' } });
  fireEvent.click(document.querySelector('.gf-cgv-accept input'));
  fireEvent.click(document.querySelector('.gf-gv-pay'));
  expect(orders).toHaveLength(0);
});

// Whatever the way in, the options can be added: the card address and the site chooser share the same code (owner's report on the mock-up).
describe.each([
  ['the address of a printed card', async () => { window.location.hash = '#campagne=bain-jour'; setup(); }],
  ['the chooser of the site', async () => { setup(); fireEvent.click(await screen.findByText('Un bain nordique', { selector: 'b' })); }],
])('rules 16-17: options can be added after arriving by %s', (_name, enter) => {
  test('a drink is added and priced by the server', async () => {
    await enter();
    const add = await screen.findByLabelText('Ajouter : Boisson');
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(flat(document.querySelector('.gf-gv-recap').textContent)).toContain('124,54 €'));
    expect(screen.getByText('2 × Boisson')).toBeTruthy();
  });
});

test('rule 16: a card address opens its campaign directly, with no chooser, and sends the add-ons asked', async () => {
  window.location.hash = '#campagne=bain-jour';
  const { calls, orders } = setup();
  const add = await screen.findByLabelText('Ajouter : Boisson');
  expect(document.querySelector('.gf-gv-offer')).toBeNull();
  fireEvent.click(add);
  await waitFor(() => expect(lastPrice(calls).addOns).toEqual([{ articleRef: 'option:7', qty: 1 }]));
  await waitFor(() => expect(flat(document.querySelector('.gf-gv-recap').textContent)).toContain('116,77 €'));
  fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: 'paul@example.test' } });
  fireEvent.click(document.querySelector('.gf-cgv-accept input'));
  fireEvent.click(document.querySelector('.gf-gv-pay'));
  await waitFor(() => expect(orders).toHaveLength(1));
  expect(orders[0]).toMatchObject({
    slug: 'bain-jour', extraMinutes: 0, addOns: [{ articleRef: 'option:7', qty: 1 }], email: 'paul@example.test', termsVersionId: 9, language: 'fr',
  });
  expect(orders[0].amountCents).toBeUndefined();
  await waitFor(() => expect(window.GFBooking.voucherGo).toHaveBeenCalledWith('https://pay.example/12'));
});

test('rule 37: the terms box is the activity’s — its link names the activity — and must be ticked', async () => {
  window.location.hash = '#campagne=bain-jour';
  const { orders } = setup();
  await screen.findByText('Récapitulatif');
  const link = document.querySelector('.gf-cgv-accept a');
  expect(link.getAttribute('href')).toBe('https://site.example/cgv/?activity=resource');
  fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: 'paul@example.test' } });
  fireEvent.click(document.querySelector('.gf-gv-pay'));
  expect(screen.getByText('Les conditions de vente doivent être acceptées.')).toBeTruthy();
  expect(orders).toHaveLength(0);
});

test('an unknown address falls back to the chooser', async () => {
  window.location.hash = '#campagne=inconnue';
  setup();
  expect(await screen.findByText('Séances')).toBeTruthy();
});

test('an older GuestFlow with no campaign list keeps the one free-amount tunnel', async () => {
  const { offer } = { offer: { available: true, termsVersionId: 4, minAmountCents: 2000, maxAmountCents: 200000, validityMonths: 18, ideas: [] } };
  setup({ offer });
  await waitFor(() => expect(document.querySelector('.gf-gv-amount-input')).toBeTruthy());
  expect(document.querySelector('.gf-gv-offer')).toBeNull();
});

test('rules 1, 40: with the plugin off in GuestFlow the block renders nothing', async () => {
  setup({ routes: () => ({ status: 404, body: { error: 'PLUGIN_INACTIVE', plugin: 'gift-vouchers' } }) });
  const container = document.querySelector('[data-gf-gift-voucher]');
  await waitFor(() => expect(container.hidden).toBe(true));
  expect(container.textContent).toBe('');
});
