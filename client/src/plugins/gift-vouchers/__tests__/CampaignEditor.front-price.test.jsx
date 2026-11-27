// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 21-22 — the campaign editor: « Position du prix » (five choices, « En bas à droite » by default) with a miniature of the visual
// showing where the server's lowest price prints, « Imprimer… » beside the download, and the sentence that the printed price is the price of the day.
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import CampaignEditor from '../CampaignEditor';
import {
  campaign, CATALOGUE, PRICE, renderWithShell, visual,
} from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({
  default: {
    getCampaign: vi.fn(), listVisuals: vi.fn(), catalogue: vi.fn(), previewPrice: vi.fn(), updateCampaign: vi.fn(), createCampaign: vi.fn(), getProperties: vi.fn(),
    duplicateCampaign: vi.fn(), downloadMerchantCard: vi.fn(), downloadRecipe: vi.fn(), visualImageUrl: vi.fn(() => '/img'), campaignPrintLayout: vi.fn(), downloadCampaignPrint: vi.fn(),
  },
}));

const open = () => renderWithShell(<CampaignEditor />, { route: '/bons-cadeaux/campagnes/5', path: '/bons-cadeaux/campagnes/:id' });

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.getCampaign.mockResolvedValue(campaign({ merchantVisualId: 4, frontPricePosition: 'bottom-right', pricing: { priceable: true, totalCents: 5000 } }));
  giftVouchersApi.listVisuals.mockResolvedValue({ items: [visual({ id: 4, use: 'merchant', name: 'Carte' })] });
  giftVouchersApi.catalogue.mockResolvedValue({ elements: CATALOGUE });
  giftVouchersApi.previewPrice.mockResolvedValue(PRICE);
  giftVouchersApi.getProperties.mockResolvedValue([]);
  giftVouchersApi.updateCampaign.mockImplementation(async (id, body) => ({ ...campaign(), ...body, id: Number(id) }));
  giftVouchersApi.campaignPrintLayout.mockResolvedValue({ pages: [], pageCount: 0 });
});

test('rule 21 — the position is a menu of the four corners and « Aucun », the bottom right by default, and the miniature puts the server\'s lowest price there', async () => {
  open();
  const field = await screen.findByLabelText('Position du prix');
  expect(field).toHaveTextContent('En bas à droite');
  const preview = screen.getByTestId('front-price-preview');
  expect(preview.querySelector('[data-corner="bottom-right"]')).toHaveTextContent('50 €');
  await userEvent.click(field);
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['En bas à droite', 'En bas à gauche', 'En haut à droite', 'En haut à gauche', 'Aucun']);
  await userEvent.click(screen.getByRole('option', { name: 'En haut à gauche' }));
  expect(preview.querySelector('[data-corner="top-left"]')).not.toBeNull();
  await userEvent.click(screen.getByLabelText('Position du prix'));
  await userEvent.click(screen.getByRole('option', { name: 'Aucun' }));
  expect(preview.querySelector('[data-corner]')).toBeNull();
});

test('rule 21 — the position is saved with the campaign', async () => {
  open();
  await userEvent.click(await screen.findByLabelText('Position du prix'));
  await userEvent.click(screen.getByRole('option', { name: 'En bas à gauche' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(giftVouchersApi.updateCampaign).toHaveBeenCalled());
  expect(giftVouchersApi.updateCampaign.mock.calls[0][1]).toMatchObject({ frontPricePosition: 'bottom-left' });
});

test('rule 21 — the editor says the printed price is the price of the day, beside the download and « Imprimer… »', async () => {
  open();
  await screen.findByLabelText('Position du prix');
  expect(screen.getAllByText('Le prix est celui du jour de l’impression.').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Imprimer…' })).toBeEnabled();
  expect(screen.getByRole('button', { name: /Carte commerçant/ })).toBeInTheDocument();
});

test('rule 22 — « Imprimer… » opens the print dialog on the campaign, previewing the server\'s layout and downloading the PDF', async () => {
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Imprimer…' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Imprimer des cartes commerçant')).toBeInTheDocument();
  await waitFor(() => expect(giftVouchersApi.campaignPrintLayout).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: 'recto-verso', perSheet: 4 })));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Télécharger le PDF' }));
  await waitFor(() => expect(giftVouchersApi.downloadCampaignPrint).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ count: 4 })));
});

test('rule 21 — « Le prix est celui du jour de l’impression. » is said only where a price prints: not once the position is « Aucun »', async () => {
  open();
  const field = await screen.findByLabelText('Position du prix');
  expect(screen.getAllByText('Le prix est celui du jour de l’impression.').length).toBeGreaterThan(0);
  await userEvent.click(field);
  await userEvent.click(screen.getByRole('option', { name: 'Aucun' }));
  expect(screen.queryByText('Le prix est celui du jour de l’impression.')).not.toBeInTheDocument();
});
