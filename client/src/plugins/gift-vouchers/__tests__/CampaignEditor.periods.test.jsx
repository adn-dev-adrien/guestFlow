// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 10, 13 — the campaign editor: « Périodes proposées » (one or both, at least one sent to the server, which judges),
// one price per period read from the server, and the validity picked in a menu of 3, 6, 12, 18 or 24 months.
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import CampaignEditor from '../CampaignEditor';
import {
  campaign, CATALOGUE, PRICE, renderWithShell, visual,
} from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({
  default: {
    getCampaign: vi.fn(), listVisuals: vi.fn(), catalogue: vi.fn(), previewPrice: vi.fn(), updateCampaign: vi.fn(), createCampaign: vi.fn(), getProperties: vi.fn(),
    duplicateCampaign: vi.fn(), downloadMerchantCard: vi.fn(), downloadRecipe: vi.fn(), visualImageUrl: vi.fn(() => '/img'),
  },
}));

const open = () => renderWithShell(<CampaignEditor />, { route: '/bons-cadeaux/campagnes/5', path: '/bons-cadeaux/campagnes/:id' });

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.getCampaign.mockResolvedValue(campaign({ periods: ['week', 'weekend'] }));
  giftVouchersApi.listVisuals.mockResolvedValue({ items: [visual()] });
  giftVouchersApi.catalogue.mockResolvedValue({ elements: CATALOGUE });
  giftVouchersApi.previewPrice.mockImplementation(async (body) => ({ ...PRICE, totalCents: body.period === 'weekend' ? 12900 : 10900 }));
  giftVouchersApi.getProperties.mockResolvedValue([]);
  giftVouchersApi.updateCampaign.mockImplementation(async (id, body) => ({ ...campaign(), ...body, id: Number(id) }));
});

test('rule 10 — both periods are ticked as the campaign sells them, and the preview shows one price per period, each asked of the server', async () => {
  open();
  expect(await screen.findByRole('checkbox', { name: 'Semaine' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Week-end' })).toBeChecked();
  await waitFor(() => expect(screen.getAllByTestId('price-recap')).toHaveLength(2));
  expect(giftVouchersApi.previewPrice).toHaveBeenCalledWith(expect.objectContaining({ period: 'week' }), expect.anything());
  expect(giftVouchersApi.previewPrice).toHaveBeenCalledWith(expect.objectContaining({ period: 'weekend' }), expect.anything());
  expect(screen.getByText(/129,00/)).toBeInTheDocument();
});

test('rule 10 — unticking a period sends the one left and drops its price from the preview', async () => {
  open();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Week-end' }));
  await waitFor(() => expect(screen.getAllByTestId('price-recap')).toHaveLength(1));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(giftVouchersApi.updateCampaign).toHaveBeenCalled());
  expect(giftVouchersApi.updateCampaign.mock.calls[0][1]).toMatchObject({ periods: ['week'] });
});

test('rule 10 — a campaign with no period left shows the server\'s sentence under the periods', async () => {
  giftVouchersApi.updateCampaign.mockRejectedValue(Object.assign(new Error('x'), { code: 'CAMPAIGN_INVALID', errors: [{ field: 'periods', message: 'Périodes proposées : au moins une période est à choisir.' }] }));
  open();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Week-end' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Semaine' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Périodes proposées : au moins une période est à choisir.')).toBeInTheDocument();
});

test('rule 13 — the validity is a menu of 3, 6, 12, 18 and 24 months', async () => {
  open();
  await userEvent.click(await screen.findByLabelText('Validité'));
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['3 mois', '6 mois', '12 mois', '18 mois', '24 mois']);
});
