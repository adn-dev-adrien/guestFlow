// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 10, 13 — the campaign editor does not keep a server sentence about a field the operator has since changed (the periods, the
// validity), and the preview says so when no period is ticked.
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

test('a server sentence about the periods goes as soon as a period is ticked again', async () => {
  giftVouchersApi.updateCampaign.mockRejectedValue(Object.assign(new Error('x'), { code: 'CAMPAIGN_INVALID', errors: [{ field: 'periods', message: 'Périodes proposées : au moins une période est à choisir.' }] }));
  open();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Week-end' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Semaine' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Périodes proposées : au moins une période est à choisir.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Semaine' }));
  expect(screen.queryByText('Périodes proposées : au moins une période est à choisir.')).not.toBeInTheDocument();
});

test('a server sentence about the validity goes as soon as the validity is changed', async () => {
  giftVouchersApi.updateCampaign.mockRejectedValue(Object.assign(new Error('x'), { code: 'CAMPAIGN_INVALID', errors: [{ field: 'validityMonths', message: 'La validité doit être de 3, 6, 12, 18 ou 24 mois.' }] }));
  open();
  await userEvent.click(await screen.findByLabelText('Validité'));
  await userEvent.click(screen.getByRole('option', { name: '6 mois' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('La validité doit être de 3, 6, 12, 18 ou 24 mois.')).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Validité'));
  await userEvent.click(screen.getByRole('option', { name: '18 mois' }));
  expect(screen.queryByText('La validité doit être de 3, 6, 12, 18 ou 24 mois.')).not.toBeInTheDocument();
});

test('with no period ticked the preview says no price can be shown because nothing is sold', async () => {
  open();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Week-end' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Semaine' }));
  expect(await screen.findByText('Aucune période n’est cochée : le bon ne peut pas se vendre.')).toBeInTheDocument();
});
