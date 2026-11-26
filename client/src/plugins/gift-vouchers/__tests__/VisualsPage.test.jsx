// specs/gift-vouchers/gift-voucher-campaigns.md rules 47-48 — the visual library: thumbnails with name, use, the campaigns that use each and the valid vouchers carrying it; add with
// the server's refusal of the image; rename and replace (the vouchers already issued keep their version); delete with the server's refusal.
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import VisualsPage from '../VisualsPage';
import { renderWithShell, visual } from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({
  default: {
    listVisuals: vi.fn(), createVisual: vi.fn(), updateVisual: vi.fn(), deleteVisual: vi.fn(), visualImageUrl: vi.fn((v) => `/api/gift-vouchers/visuals/${v.id}/image?version=${v.versionId}`),
  },
}));

const open = () => renderWithShell(<VisualsPage />);

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.listVisuals.mockResolvedValue({ items: [visual(), visual({ id: 4, name: 'Recto carte', use: 'merchant', campaigns: [], validVouchers: 0, versionId: 41 })] });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

test('each visual shows its thumbnail, name, use, the campaigns using it and the valid vouchers carrying it', async () => {
  open();
  const img = await screen.findByAltText('Recto bain');
  expect(img).toHaveAttribute('src', '/api/gift-vouchers/visuals/3/image?version=31');
  expect(screen.getByText('Recto de la carte commerçant')).toBeInTheDocument();
  expect(screen.getByText('Campagnes : Bain journée')).toBeInTheDocument();
  expect(screen.getByText('Bons valides : 2')).toBeInTheDocument();
  expect(screen.getByText('Campagnes : Aucune')).toBeInTheDocument();
});

test('adding sends the file, the name and the use; the server’s refusal of the image is shown on the image', async () => {
  giftVouchersApi.createVisual.mockRejectedValueOnce(Object.assign(new Error('Image trop petite : 800 × 1000 px (1240 × 1748 au minimum).'), { code: 'IMAGE_REFUSED' }));
  open();
  await screen.findByAltText('Recto bain');
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter un visuel' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText(/Nom/), 'Nouveau recto');
  const file = new File(['x'], 'recto.jpg', { type: 'image/jpeg' });
  await userEvent.upload(within(dialog).getByTestId('image-drop-input'), file);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(giftVouchersApi.createVisual).toHaveBeenCalledWith({ file, name: 'Nouveau recto', use: 'both' }));
  expect(await within(dialog).findByText(/Image trop petite/)).toBeInTheDocument();
  giftVouchersApi.createVisual.mockResolvedValueOnce(visual({ id: 9, name: 'Nouveau recto' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(giftVouchersApi.listVisuals).toHaveBeenCalledTimes(2));
});

test('renaming and replacing keeps the same visual, and says the vouchers already issued keep their version', async () => {
  giftVouchersApi.updateVisual.mockResolvedValue(visual());
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Renommer Recto bain' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Les bons déjà émis gardent leur version.')).toBeInTheDocument();
  const name = within(dialog).getByLabelText(/Nom/);
  await userEvent.clear(name);
  await userEvent.type(name, 'Recto bain 2');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(giftVouchersApi.updateVisual).toHaveBeenCalledWith(3, { file: null, name: 'Recto bain 2', use: 'both' }));
});

test('deleting asks for confirmation; the server’s refusal naming the on-sale campaign is shown', async () => {
  giftVouchersApi.deleteVisual.mockRejectedValue(new Error('Utilisé par la campagne en vente « Bain journée ». Retirez-le de la campagne d’abord.'));
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Retirer Recto bain' }));
  expect(giftVouchersApi.deleteVisual).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByRole('button', { name: 'Retirer' }));
  await waitFor(() => expect(giftVouchersApi.deleteVisual).toHaveBeenCalledWith(3));
  expect(await screen.findByText(/Utilisé par la campagne en vente/)).toBeInTheDocument();
});

test('an empty library invites to add a visual', async () => {
  giftVouchersApi.listVisuals.mockResolvedValue({ items: [] });
  open();
  expect(await screen.findByText('Aucun visuel dans la bibliothèque.')).toBeInTheDocument();
});
