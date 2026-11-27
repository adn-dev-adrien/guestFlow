// specs/site/site-outside-resource-booking.md rule 32 — the purchase block: « Pour » is « Prénom » and « Nom » of the recipient, both required with their own inline refusal, 40 characters each, sent
// as `recipientFirstName` and `recipientLastName`; the card preview names the first name only; a server refusal lands on its field.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { loadBlock } from './wordpressBookingFixtures';

const ASSETS = ['assets/voucher-code.js', 'assets/voucher-parts.js', 'assets/voucher-card.js'];
const OFFER = {
  available: true,
  brand: 'Domaine Solio',
  termsVersionId: 4,
  validityMonths: 18,
  ideas: [],
  // The back of specs/gift-vouchers/gift-voucher-campaigns.md rule 66, reduced to what this suite reads: the card that names the first name only.
  back: {
    layout: { trimMm: { width: 105, height: 148 }, pt: {}, lines: {}, lineHeight: {} },
    texts: { title: 'BON CADEAU', subtitleRecipient: 'offert à {recipient}', subtitleSender: 'offert par {sender}', subtitle: 'offert par {sender} à {recipient}', codePlaceholder: 'XXXX', validUntil: '{date}', steps: [] },
    companyName: 'Domaine Solio',
  },
  campaigns: [{
    slug: 'sejour', kind: 'lodging', title: 'Bon cadeau', validityMonths: 18, minAmountCents: 2000, maxAmountCents: 200000, ideas: [], termsVersionId: 4,
    back: { lineTemplate: '{amount}', validUntil: '' },
  }],
};

function setup({ order = { status: 201, body: { data: { orderId: 12, token: 'tok-12' } } } } = {}) {
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  const orders = [];
  const routes = (method, p, body) => {
    if (p === '/gift-vouchers/offer') return { status: 200, body: { data: OFFER } };
    if (p === '/gift-vouchers/orders') { orders.push(body); return order; }
    if (p === '/gift-vouchers/orders/12/pay') return { status: 200, body: { data: { paymentUrl: 'https://pay.example/12' } } };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
  };
  const loaded = loadBlock('blocks/gift-voucher/view.js', { routes, assets: ASSETS });
  loaded.GF.voucherGo = vi.fn();
  return { ...loaded, orders };
}

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; window.location.hash = ''; });

const fields = () => {
  const [first, last] = document.querySelectorAll('.gf-gv-names input');
  return { first, last };
};
const fillRest = () => {
  fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: 'paul@example.test' } });
  fireEvent.click(document.querySelector('.gf-cgv-accept input'));
};
const amount = () => document.querySelector('.gf-gv-amount-input');
const typeAmount = () => fireEvent.change(amount(), { target: { value: '100' } });

test('« Pour » is two labelled fields, « Prénom » and « Nom », of 40 characters each', async () => {
  setup();
  await screen.findByLabelText('Prénom');
  expect(screen.getByLabelText('Nom')).toBeTruthy();
  expect(screen.queryByLabelText(/^Pour$/)).toBeNull();
  const { first, last } = fields();
  expect([first.getAttribute('maxlength'), last.getAttribute('maxlength')]).toEqual(['40', '40']);
});

test('both are required: each empty one has its own inline refusal, the first takes the focus and nothing is sent', async () => {
  const { orders } = setup();
  await screen.findByLabelText('Prénom');
  typeAmount();
  fillRest();
  fireEvent.click(document.querySelector('.gf-gv-pay'));
  expect(screen.getByText('Saisissez le prénom de la personne à qui le bon est offert.')).toBeTruthy();
  expect(screen.getByText('Saisissez son nom.')).toBeTruthy();
  expect(document.activeElement).toBe(fields().first);
  fireEvent.input(fields().first, { target: { value: 'Marie' } });
  expect(screen.queryByText('Saisissez le prénom de la personne à qui le bon est offert.')).toBeNull();
  fireEvent.click(document.querySelector('.gf-gv-pay'));
  expect(document.activeElement).toBe(fields().last);
  expect(orders).toHaveLength(0);
});

test('the order carries both names, trimmed, and the preview card names the first name only', async () => {
  const { orders } = setup();
  await screen.findByLabelText('Prénom');
  typeAmount();
  fireEvent.input(fields().first, { target: { value: ' Marie ' } });
  fireEvent.input(fields().last, { target: { value: 'Durand' } });
  const card = document.querySelector('.gf-vcard');
  expect(card.textContent).toContain('Marie');
  expect(card.textContent).not.toContain('Durand');
  fillRest();
  fireEvent.click(document.querySelector('.gf-gv-pay'));
  await waitFor(() => expect(orders).toHaveLength(1));
  expect(orders[0]).toMatchObject({ recipientFirstName: 'Marie', recipientLastName: 'Durand' });
  expect(orders[0]).not.toHaveProperty('recipientName');
});

test('a server refusal of a name is shown on that name and takes the focus', async () => {
  setup({ order: { status: 400, body: { error: { code: 'RECIPIENT_LAST_NAME_REQUIRED', message: 'Le nom du destinataire est demandé.', details: [{ field: 'recipientLastName' }] } } } });
  await screen.findByLabelText('Prénom');
  typeAmount();
  fireEvent.input(fields().first, { target: { value: 'Marie' } });
  fireEvent.input(fields().last, { target: { value: 'Durand' } });
  fillRest();
  fireEvent.click(document.querySelector('.gf-gv-pay'));
  expect(await screen.findByText('Le nom du destinataire est demandé.')).toBeTruthy();
  expect(document.activeElement).toBe(fields().last);
});
