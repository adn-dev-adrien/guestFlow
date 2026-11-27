// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 11 (G16) — a campaign that sells two periods on a grid where the week-end is the cheaper: the page opens on the cheapest period (the
// first the server lists), its « Ajouter au bon » fold shows that period's extra-time figure, switching period changes the figure, the order carries the period picked and the back of the card
// follows it. Nothing is computed by the page.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { loadBlock } from './wordpressBookingFixtures';

const ASSETS = ['assets/voucher-code.js', 'assets/voucher-parts.js', 'assets/voucher-card.js'];
const LINE = (period) => [{ kind: 'session', label: 'Bain nordique', detail: `1 h en journée · ${period}`, qty: 1 }];
const CHEAPER_WEEKEND = {
  slug: 'bain-jour',
  kind: 'resource',
  title: 'Une heure de bain',
  validityMonths: 12,
  band: { key: 'day', label: 'journée', from: '10:00', to: '19:00' },
  contents: LINE('week-end'),
  contentsByPeriod: { weekend: LINE('week-end'), week: LINE('semaine') },
  addOns: [],
  extraTime: {
    maxMinutes: 60, stepMinutes: 60, prices: [{ minutes: 60, cents: 3000 }], pricesByPeriod: { weekend: [{ minutes: 60, cents: 3000 }], week: [{ minutes: 60, cents: 4500 }] },
  },
  periods: [{ period: 'weekend', priceCents: 4000, label: 'week-end' }, { period: 'week', priceCents: 5000, label: 'semaine' }],
  totalCents: 4000,
  termsVersionId: 9,
  visual: { versionId: 5, width: 720, height: 1015 },
  back: {
    lines: ['Bain nordique : 1 h en journée · week-end'],
    linesByPeriod: { weekend: ['Bain nordique : 1 h en journée · week-end'], week: ['Bain nordique : 1 h en journée · semaine'] },
    titles: { weekend: 'Une heure de bain · week-end', week: 'Une heure de bain · semaine' },
    validUntil: '15 novembre 2027',
    extraTime: {},
    addOns: {},
  },
};
const BACK = {
  design: {
    layout: { trimMm: { width: 105, height: 148 }, pt: {}, lines: {} },
    voucherLayout: { trimMm: { width: 105, height: 148 }, pt: {}, lines: {} },
    texts: { title: 'BON CADEAU', includes: 'Votre bon comprend — {lines}', validUntil: 'Valable jusqu’au {date}', codePlaceholder: 'XXXX', steps: [] },
  },
  layout: { trimMm: { width: 105, height: 148 }, pt: {}, lines: {} },
  texts: { title: 'BON CADEAU' },
  companyName: 'Domaine Solio',
  identity: 'Domaine Solio',
  website: 'site.example',
  link: 'site.example/bon-cadeau/utiliser',
  previewQrSvg: '<svg viewBox="0 0 3 3"><path d="M0 0h1v1H0z"/></svg>',
};

const orders = [];
function open() {
  window.location.hash = '#campagne=bain-jour';
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  orders.length = 0;
  const routes = (method, p, body) => {
    if (p === '/gift-vouchers/offer') return { status: 200, body: { data: { available: true, brand: 'Domaine Solio', termsVersionId: 4, validityMonths: 12, ideas: [], campaigns: [CHEAPER_WEEKEND], back: BACK } } };
    if (p === '/gift-vouchers/offer/price') return { status: 200, body: { data: { lines: [], totalCents: body.period === 'weekend' ? 4000 : 5000, extrasCents: 0, vat: [] } } };
    if (p === '/gift-vouchers/orders') { orders.push(body); return { status: 201, body: { data: { orderId: 12, token: 'tok-12' } } }; }
    if (p === '/gift-vouchers/orders/12/pay') return { status: 200, body: { data: { paymentUrl: 'https://pay.example/12' } } };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
  };
  const loaded = loadBlock('blocks/gift-voucher/view.js', { routes, assets: ASSETS });
  loaded.GF.voucherGo = vi.fn();
  return loaded;
}
const flat = (text) => text.replace(/\s/g, ' ');

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; window.location.hash = ''; });

test('the page opens on the cheapest period, its fold shows that period\'s extra-time figure and switching changes it', async () => {
  open();
  await screen.findByText('Récapitulatif');
  expect([...document.querySelectorAll('.gf-gv-period-opt')].map((n) => [n.getAttribute('data-period'), n.getAttribute('aria-checked')])).toEqual([['weekend', 'true'], ['week', 'false']]);
  expect(flat(document.querySelector('.gf-fold-row').textContent)).toContain('30 € par tranche de 1 h');
  fireEvent.click(document.querySelector('.gf-gv-period-opt[data-period="week"]'));
  await waitFor(() => expect(flat(document.querySelector('.gf-fold-row').textContent)).toContain('45 € par tranche de 1 h'));
});

test('the order carries the period picked, and the back of the card follows it', async () => {
  open();
  await screen.findByText('Récapitulatif');
  fireEvent.click(document.querySelector('.gf-gv-period-opt[data-period="week"]'));
  await waitFor(() => expect(document.querySelector('.gf-gv-period-opt[data-period="week"]').getAttribute('aria-checked')).toBe('true'));
  const [first, last] = document.querySelectorAll('.gf-gv-names input');
  fireEvent.change(first, { target: { value: 'Marie' } });
  fireEvent.change(last, { target: { value: 'Durand' } });
  await waitFor(() => expect(flat(document.querySelector('.gf-card-flip .gf-v-title').textContent)).toBe('Une heure de bain · semaine'));
  expect(flat(document.querySelector('.gf-card-flip .gf-v-includes').textContent)).toContain('1 h en journée · semaine');
  fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: 'paul@example.test' } });
  fireEvent.click(document.querySelector('.gf-cgv-accept input'));
  fireEvent.click(document.querySelector('.gf-gv-pay'));
  await waitFor(() => expect(orders).toHaveLength(1));
  expect(orders[0]).toMatchObject({ slug: 'bain-jour', period: 'week' });
});
