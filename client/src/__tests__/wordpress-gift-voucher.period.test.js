// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 11 — the purchase block: the giver chooses « Semaine » or « Week-end » inside the campaign, each with the server's price;
// the choice is sent with every price request and with the order; the offer cards announce the lowest price as « dès ».
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { loadBlock } from './wordpressBookingFixtures';

const ASSETS = ['assets/voucher-code.js', 'assets/voucher-parts.js', 'assets/voucher-card.js'];
const BATH = {
  slug: 'bain-jour',
  kind: 'resource',
  title: 'Une heure de bain',
  validityMonths: 12,
  band: { key: 'day', label: 'journée', from: '10:00', to: '19:00' },
  contents: [{ kind: 'session', label: 'Bain nordique', detail: '1 h en journée · de 10:00 à 19:00', qty: 1 }],
  addOns: [],
  extraTime: null,
  periods: [{ period: 'week', priceCents: 5000, label: 'semaine' }, { period: 'weekend', priceCents: 7000, label: 'week-end' }],
  totalCents: 5000,
  termsVersionId: 9,
};
const ONE = { ...BATH, slug: 'bain-semaine', title: 'Semaine seule', periods: [{ period: 'week', priceCents: 5000, label: 'semaine' }] };
const OFFER = { available: true, brand: 'Domaine Solio', termsVersionId: 4, validityMonths: 12, ideas: [], campaigns: [BATH, ONE] };

const asked = [];
function setup() {
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  asked.length = 0;
  const routes = (method, p, body) => {
    if (p === '/gift-vouchers/offer') return { status: 200, body: { data: OFFER } };
    if (p === '/gift-vouchers/offer/price') {
      asked.push(body);
      const cents = body.period === 'weekend' ? 7000 : 5000;
      return { status: 200, body: { data: { lines: [], totalCents: cents, extrasCents: 0, vat: [] } } };
    }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
  };
  const loaded = loadBlock('blocks/gift-voucher/view.js', { routes, assets: ASSETS });
  loaded.GF.voucherGo = vi.fn();
  return loaded;
}

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; window.location.hash = ''; });

test('rule 11 — a campaign that sells two periods is announced « dès » its lowest price, one that sells one is announced at its price', async () => {
  setup();
  const card = (await screen.findByText('Une heure de bain', { selector: 'b' })).closest('button');
  expect(card.textContent.replace(/\s/g, ' ')).toMatch(/dès 50/);
  expect(screen.getByText('Semaine seule', { selector: 'b' }).closest('button').textContent).not.toMatch(/dès/);
});

test('rule 11 — « Semaine » is chosen first, both periods show the server\'s price, and choosing « Week-end » asks the price again with it', async () => {
  setup();
  fireEvent.click(await screen.findByText('Une heure de bain', { selector: 'b' }));
  await screen.findByText('Récapitulatif');
  const radios = [...document.querySelectorAll('.gf-gv-period-opt')];
  expect(radios.map((n) => [n.getAttribute('data-period'), n.getAttribute('aria-checked')])).toEqual([['week', 'true'], ['weekend', 'false']]);
  expect(radios[1].textContent.replace(/\s/g, ' ')).toMatch(/Week-end.*70/);
  expect(asked.at(-1)).toMatchObject({ slug: 'bain-jour', period: 'week' });
  fireEvent.click(radios[1]);
  await waitFor(() => expect(asked.at(-1)).toMatchObject({ slug: 'bain-jour', period: 'weekend' }));
  expect(radios[1].getAttribute('aria-checked')).toBe('true');
  expect(radios[0].getAttribute('aria-checked')).toBe('false');
});

test('rule 11 — a campaign that sells one period shows no control and sends that period', async () => {
  setup();
  fireEvent.click(await screen.findByText('Semaine seule', { selector: 'b' }));
  await screen.findByText('Récapitulatif');
  expect(document.querySelector('.gf-gv-period')).toBeNull();
  expect(asked.at(-1)).toMatchObject({ slug: 'bain-semaine', period: 'week' });
});

// Rule 11 — what a period means (the server's words) sits under the control and follows the choice; a single period is shown as a fact; the content lines and the extra-time steps follow the period.
test('rule 11 — the hint under the period control, the contents and the extra-time steps follow the period picked', async () => {
  const hinted = {
    ...BATH,
    periods: [
      { period: 'week', priceCents: 5000, label: 'semaine', hint: 'Semaine : du lundi au vendredi en journée.' },
      { period: 'weekend', priceCents: 7000, label: 'week-end', hint: 'Week-end : samedi, dimanche et jours fériés, en journée.' },
    ],
    contentsByPeriod: {
      week: [{ kind: 'session', label: 'Bain nordique', detail: '1 h en journée · semaine', qty: 1 }],
      weekend: [{ kind: 'session', label: 'Bain nordique', detail: '1 h en journée · week-end', qty: 1 }],
    },
    extraTime: {
      maxMinutes: 60, stepMinutes: 60, prices: [{ minutes: 60, cents: 4500 }], pricesByPeriod: { week: [{ minutes: 60, cents: 4500 }], weekend: [{ minutes: 60, cents: 6000 }] },
    },
  };
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  const routes = (method, p) => {
    if (p === '/gift-vouchers/offer') return { status: 200, body: { data: { ...OFFER, campaigns: [hinted] } } };
    if (p === '/gift-vouchers/offer/price') return { status: 200, body: { data: { lines: [], totalCents: 5000, extrasCents: 0, vat: [] } } };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
  };
  loadBlock('blocks/gift-voucher/view.js', { routes, assets: ASSETS });
  await screen.findByText('Récapitulatif');
  expect(document.querySelector('.gf-gv-period-hint').textContent).toBe('Semaine : du lundi au vendredi en journée.');
  expect(document.querySelector('.gf-gv-items').textContent).toMatch(/semaine/);
  fireEvent.click(document.querySelector('.gf-gv-period-opt[data-period="weekend"]'));
  await waitFor(() => expect(document.querySelector('.gf-gv-period-hint').textContent).toBe('Week-end : samedi, dimanche et jours fériés, en journée.'));
  expect(document.querySelector('.gf-gv-items').textContent).toMatch(/week-end/);
  expect(document.querySelector('.gf-gv-items').textContent).not.toMatch(/semaine/);
});

test('rule 11 — a single-period campaign shows its period as a fact, no control', async () => {
  const one = { ...ONE, periods: [{ period: 'week', priceCents: 5000, label: 'semaine', hint: 'Semaine : du lundi au vendredi en journée.' }] };
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  const routes = (method, p) => (p === '/gift-vouchers/offer'
    ? { status: 200, body: { data: { ...OFFER, campaigns: [one] } } }
    : { status: 200, body: { data: { lines: [], totalCents: 5000, extrasCents: 0, vat: [] } } });
  loadBlock('blocks/gift-voucher/view.js', { routes, assets: ASSETS });
  await screen.findByText('Récapitulatif');
  expect(document.querySelector('.gf-gv-period')).toBeNull();
  expect(document.querySelector('.gf-gv-period-hint').textContent).toBe('Semaine : du lundi au vendredi en journée.');
});
