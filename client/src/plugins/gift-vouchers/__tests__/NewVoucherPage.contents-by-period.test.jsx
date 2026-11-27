// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 20 (G8) — « Nouveau bon » on a campaign that sells two periods: the contents list and the extra-time prices of « Ajouter au bon » are
// the server's lines and prices of the period chosen, not the cheapest's.
import React from 'react';
import { screen, within } from '@testing-library/react';
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

const base = OFFER.campaigns[0];
const TWO = {
  ...OFFER,
  campaigns: [{
    ...base,
    periods: [{ period: 'week', priceCents: 5000, label: 'semaine' }, { period: 'weekend', priceCents: 7000, label: 'week-end' }],
    totalCents: 5000,
    contents: [{ kind: 'session', label: 'Bain nordique', detail: '1 h en journée · semaine', qty: 1 }],
    contentsByPeriod: {
      week: [{ kind: 'session', label: 'Bain nordique', detail: '1 h en journée · semaine', qty: 1 }],
      weekend: [{ kind: 'session', label: 'Bain nordique', detail: '1 h en journée · week-end', qty: 1 }],
    },
    extraTime: {
      maxMinutes: 120,
      stepMinutes: 60,
      prices: [{ minutes: 60, cents: 4500 }, { minutes: 120, cents: 8700 }],
      pricesByPeriod: {
        week: [{ minutes: 60, cents: 4500 }, { minutes: 120, cents: 8700 }],
        weekend: [{ minutes: 60, cents: 6000 }, { minutes: 120, cents: 11700 }],
      },
    },
  }, OFFER.campaigns[1]],
};

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.getOffer.mockResolvedValue(TWO);
  giftVouchersApi.listVisuals.mockResolvedValue({ items: [visual()] });
  giftVouchersApi.catalogue.mockResolvedValue({ elements: CATALOGUE });
  giftVouchersApi.offerPrice.mockResolvedValue({ ...PRICE, validUntil: '2027-05-15' }); // date-literal-ok: a payload the mocked server answers
});

test('the contents and the extra-time price follow the period chosen', async () => {
  renderWithShell(<NewVoucherPage />, { route: '/bons-cadeaux/nouveau', path: '/bons-cadeaux/nouveau' });
  expect(await screen.findByText(/1 h en journée · semaine/)).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText(/Période/));
  await userEvent.click(await screen.findByRole('option', { name: /Week-end · 70,00/ }));
  expect(await screen.findByText(/1 h en journée · week-end/)).toBeInTheDocument();
  expect(screen.queryByText(/1 h en journée · semaine/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /Ajouter au bon/ }));
  expect(within(document.body).getByText(/60,00 €/)).toBeInTheDocument();
});
