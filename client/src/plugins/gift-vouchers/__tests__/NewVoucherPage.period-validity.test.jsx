// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 11, 13 — « Nouveau bon »: a « Période » select when the campaign sells two (required, with the server's price of each),
// a single period shown as a fact, the validity menu prefilled with the campaign's and sent with the request, « Valable jusqu'au » read from the server's answer, « Sur mesure » with its own
// period and validity; the server's refusal is shown on the field it names.
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import NewVoucherPage from '../NewVoucherPage';
import {
  CATALOGUE, OFFER, PRICE, renderWithShell, visual,
} from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({
  default: {
    getOffer: vi.fn(), listVisuals: vi.fn(), catalogue: vi.fn(), offerPrice: vi.fn(), previewPrice: vi.fn(), create: vi.fn(), visualImageUrl: vi.fn(() => '/img'),
  },
}));
vi.mock('../../../api', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, default: { ...mod.default, getToday: vi.fn().mockResolvedValue({ today: '2026-11-15' }) } }; // date-literal-ok: a payload the mocked server answers; the screen only shows it
});

const TWO = {
  ...OFFER,
  campaigns: [{
    ...OFFER.campaigns[0],
    periods: [{ period: 'week', priceCents: 5000, label: 'semaine' }, { period: 'weekend', priceCents: 7000, label: 'week-end' }],
    totalCents: 5000,
  }, OFFER.campaigns[1]],
};
const open = () => renderWithShell(<NewVoucherPage />, { route: '/bons-cadeaux/nouveau', path: '/bons-cadeaux/nouveau' });
const lastPrice = () => giftVouchersApi.offerPrice.mock.calls[giftVouchersApi.offerPrice.mock.calls.length - 1][0];
const refusal = (message, code) => Object.assign(new Error(message), { code });

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.getOffer.mockResolvedValue(TWO);
  giftVouchersApi.listVisuals.mockResolvedValue({ items: [visual()] });
  giftVouchersApi.catalogue.mockResolvedValue({ elements: CATALOGUE });
  giftVouchersApi.offerPrice.mockResolvedValue({ ...PRICE, validUntil: '2027-05-15' }); // date-literal-ok: a payload the mocked server answers
  giftVouchersApi.previewPrice.mockResolvedValue({ ...PRICE, validUntil: '2027-05-15' }); // date-literal-ok: a payload the mocked server answers
  giftVouchersApi.create.mockResolvedValue({ id: 42 });
});

test('rule 11 — a campaign that sells two periods asks for one, with the server\'s price of each, and prices nothing before it is chosen', async () => {
  open();
  const select = await screen.findByLabelText(/Période/);
  expect(giftVouchersApi.offerPrice).not.toHaveBeenCalled();
  await userEvent.click(select);
  expect(await screen.findByRole('option', { name: /Semaine · 50,00/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('option', { name: /Week-end · 70,00/ }));
  await waitFor(() => expect(lastPrice()).toMatchObject({ slug: 'bain-jour', period: 'weekend' }));
});

test('rule 11 — a campaign that sells one period shows it as a fact and sends it', async () => {
  giftVouchersApi.getOffer.mockResolvedValue(OFFER);
  open();
  expect(await screen.findByText('Période : Semaine')).toBeInTheDocument();
  await waitFor(() => expect(lastPrice()).toMatchObject({ slug: 'bain-jour', period: 'week' }));
});

test('rule 13 — the validity is a menu prefilled with the campaign\'s, sent with the request, and the recap says the end the server computed', async () => {
  giftVouchersApi.getOffer.mockResolvedValue(OFFER);
  open();
  const validity = await screen.findByLabelText('Validité');
  expect(validity).toHaveTextContent('12 mois');
  await waitFor(() => expect(screen.getByText('Valable jusqu’au 15/05/2027')).toBeInTheDocument());
  await userEvent.click(validity);
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['3 mois', '6 mois', '12 mois', '18 mois', '24 mois']);
  await userEvent.click(screen.getByRole('option', { name: '6 mois' }));
  await waitFor(() => expect(lastPrice()).toMatchObject({ slug: 'bain-jour', validityMonths: '6' }));
});

test('rule 13 — a refused validity is shown on the field, from the server\'s sentence', async () => {
  giftVouchersApi.getOffer.mockResolvedValue(OFFER);
  giftVouchersApi.offerPrice.mockRejectedValue(refusal('La validité doit être de 3, 6, 12, 18 ou 24 mois.', 'VALIDITY_INVALID'));
  open();
  expect(await screen.findByText('La validité doit être de 3, 6, 12, 18 ou 24 mois.')).toBeInTheDocument();
});
