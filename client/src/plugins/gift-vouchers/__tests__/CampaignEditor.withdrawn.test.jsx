// specs/gift-voucher-campaigns.md rule 65 — a campaign that carries an option the catalogue no longer sells is reported, never repaired: a warning Alert opens the editor with the
// server's `withdrawn` list, the chip of each one is drawn in the warning colour with the reason as its tooltip, and nothing is removed from the draft.
import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import CampaignEditor from '../CampaignEditor';
import {
  campaign, CATALOGUE, PRICE, renderWithShell, visual,
} from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({
  default: {
    getCampaign: vi.fn(), listVisuals: vi.fn(), catalogue: vi.fn(), previewPrice: vi.fn(), updateCampaign: vi.fn(), createCampaign: vi.fn(), getProperties: vi.fn(),
    duplicateCampaign: vi.fn(), downloadMerchantCard: vi.fn(), downloadRecipe: vi.fn(), visualImageUrl: vi.fn(() => '/api/gift-vouchers/visuals/3/image?version=31'),
  },
}));

const REASON = 'Le prix « par jour » a besoin d’un séjour : il ne se vend pas seul.';
const withdrawn = [{ articleRef: 'option:12', label: 'Petit-déjeuner', reason: REASON }];
const open = () => renderWithShell(<CampaignEditor />, { route: '/bons-cadeaux/campagnes/5', path: '/bons-cadeaux/campagnes/:id' });

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.listVisuals.mockResolvedValue({ items: [visual()] });
  giftVouchersApi.catalogue.mockResolvedValue({ elements: CATALOGUE });
  giftVouchersApi.previewPrice.mockResolvedValue(PRICE);
  giftVouchersApi.getProperties.mockResolvedValue([{ id: 7, name: 'L’Estiva' }]);
});

test('rule 65 — the editor opens on a warning that names each withdrawn option and its reason, and keeps it in the draft', async () => {
  giftVouchersApi.getCampaign.mockResolvedValue(campaign({ addOns: ['option:11', 'option:12'], withdrawn }));
  open();
  const alert = await screen.findByText(/Retirée de l’offre/);
  expect(alert).toHaveTextContent(`Retirée de l’offre : « Petit-déjeuner » — ${REASON} La retirer de la campagne pour pouvoir l’enregistrer.`);
  expect(alert.closest('[role="alert"]')).toBeInTheDocument();
  const chip = screen.getByText('Petit-déjeuner', { selector: '.MuiChip-label' });
  expect(chip.closest('.MuiChip-root')).toHaveClass('MuiChip-colorWarning');
  expect(screen.getByText('Boisson', { selector: '.MuiChip-label' }).closest('.MuiChip-root')).not.toHaveClass('MuiChip-colorWarning');
  await userEvent.hover(chip);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
});

test('rule 65 — several are listed in the campaign’s order, a composition option is drawn in the warning colour, and a clean campaign shows no such alert', async () => {
  giftVouchersApi.getCampaign.mockResolvedValue(campaign({
    composition: { resourceId: 1, band: 'day', minutes: 120, options: [{ articleRef: 'option:12', qty: 1 }] },
    withdrawn: [...withdrawn, { articleRef: 'option:13', label: 'Atelier', reason: 'Archivée : retirée du catalogue.' }],
  }));
  const { unmount } = open();
  const alert = await screen.findByText(/Retirées de l’offre/);
  expect(alert).toHaveTextContent(`Retirées de l’offre : « Petit-déjeuner » — ${REASON} ; « Atelier » — Archivée : retirée du catalogue. Les retirer de la campagne pour pouvoir l’enregistrer.`);
  const card = screen.getByText('Petit-déjeuner', { selector: 'p' }).closest('.MuiCard-root');
  expect(within(card).getByText('Par jour').closest('.MuiChip-root')).toHaveClass('MuiChip-colorWarning');
  unmount();

  giftVouchersApi.getCampaign.mockResolvedValue(campaign({ withdrawn: [] }));
  open();
  expect(await screen.findByDisplayValue('Bain journée')).toBeInTheDocument();
  expect(screen.queryByText(/Retirées? de l’offre/)).not.toBeInTheDocument();
});
