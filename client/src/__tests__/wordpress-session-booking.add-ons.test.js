// specs/site/site-outside-resource-booking.md §3.H rule 37 — « Ajouter à la séance »: each add-on shows the server's `unitLabel` and prices, the limit reads « N au maximum par séance »
// (never « par bon »), and the gift voucher's own fold keeps « par bon ».
import { fireEvent, screen } from '@testing-library/react';
import { loadBlock } from './wordpressBookingFixtures';
import {
  BATH, setup, flat, resetPage,
} from './wordpressSessionFixtures';

afterEach(resetPage);

const PRICES = [650, 1280, 1850].map((cents, i) => ({ qty: i + 1, cents }));
const WITH_ADD_ONS = {
  ...BATH,
  addOns: [
    {
      articleRef: 'option:7', label: 'Boisson', maxQty: 3, unitLabel: 'l’unité', linear: true, prices: PRICES,
    },
    {
      articleRef: 'option:8', label: 'Peignoir', maxQty: 2, unitLabel: 'par personne', linear: false, prices: [{ qty: 1, cents: 500 }, { qty: 2, cents: 900 }],
    },
  ],
};
const row = (name) => [...document.querySelectorAll('.gf-fold-row')].find((r) => r.textContent.includes(name));
const more = (name) => screen.getByLabelText(`Ajouter : ${name}`);

test('rule 37 — the fold of the session reads each entry\'s unit label and price table, and announces the limit « au maximum par séance »', async () => {
  setup({ resources: [WITH_ADD_ONS] });
  await screen.findByText('Ajouter à la séance');
  fireEvent.click(document.querySelector('.gf-fold-head'));
  expect(flat(row('Boisson').textContent)).toContain('6,50 € l’unité');
  expect(flat(row('Peignoir').textContent)).toContain('5 € par personne');
  for (let i = 0; i < 3; i += 1) fireEvent.click(more('Boisson'));
  expect(flat(row('Boisson').textContent)).toContain('3 × 6,50 € = 18,50 € · 3 au maximum par séance');
  expect(flat(row('Boisson').textContent)).not.toContain('par bon');
});

test('rule 37 — the voucher\'s own fold keeps its limit text « au maximum par bon »', async () => {
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  const offer = {
    available: true, brand: 'Domaine', termsVersionId: 4, validityMonths: 12, ideas: [],
    campaigns: [{
      slug: 'bain', kind: 'resource', title: 'Un bain', validityMonths: 12, band: { key: 'day', label: 'journée', from: '10:00', to: '19:00' }, contents: [], totalCents: 5000, termsVersionId: 9, extraTime: null, addOns: [WITH_ADD_ONS.addOns[0]],
    }],
  };
  const routes = (method, p) => (p === '/gift-vouchers/offer' ? { status: 200, body: { data: offer } } : { status: 200, body: { data: { lines: [], totalCents: 5000, extrasCents: 0, vat: [] } } });
  loadBlock('blocks/gift-voucher/view.js', { routes, assets: ['assets/voucher-code.js', 'assets/voucher-parts.js', 'assets/voucher-card.js'] });
  await screen.findByText('Ajouter au bon');
  fireEvent.click(document.querySelector('.gf-fold-head'));
  for (let i = 0; i < 3; i += 1) fireEvent.click(more('Boisson'));
  expect(flat(row('Boisson').textContent)).toContain('3 au maximum par bon');
});
