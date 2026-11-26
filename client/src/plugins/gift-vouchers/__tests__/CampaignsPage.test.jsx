// specs/gift-vouchers/gift-voucher-campaigns.md rules 2, 6, 10 — the campaigns list: state, kind, validity and contents as the server describes them, the engine's reason when a campaign
// cannot be offered, « Nouvelle campagne », and « Importer une recette » with the server's per-field refusals.
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import CampaignsPage from '../CampaignsPage';
import { campaign, lodgingCampaign, renderWithShell } from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({ default: { listCampaigns: vi.fn(), importRecipe: vi.fn() } }));

const open = () => renderWithShell(<CampaignsPage />, { route: '/bons-cadeaux/campagnes', path: '/bons-cadeaux/campagnes' });

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  }));
});

test('lists each campaign with its state, kind, validity and the contents the server summarises', async () => {
  giftVouchersApi.listCampaigns.mockResolvedValue({ items: [campaign({ state: 'on_sale' }), lodgingCampaign({ state: 'draft' })] });
  open();
  expect((await screen.findAllByText('Bain journée')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Bain nordique : 2 h en journée · Planche apéro').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Montant libre de 20 € à 2 000 €').length).toBeGreaterThan(0);
  expect(screen.getAllByText('En vente').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Brouillon').length).toBeGreaterThan(0);
  expect(screen.getAllByText('12 mois').length).toBeGreaterThan(0);
});

test('a campaign the engine cannot price shows its reason', async () => {
  giftVouchersApi.listCampaigns.mockResolvedValue({ items: [campaign({ pricing: { priceable: false, reason: 'Aucune tranche horaire n’est réglée sur cette ressource.' } })] });
  open();
  expect((await screen.findAllByText(/Non proposée : Aucune tranche horaire/)).length).toBeGreaterThan(0);
});

test('an empty list offers « Nouvelle campagne » and a failure offers a retry', async () => {
  giftVouchersApi.listCampaigns.mockResolvedValueOnce({ items: [] });
  open();
  expect(await screen.findByText('Aucune campagne pour le moment.')).toBeInTheDocument();
});

test('a failed load says so and retries', async () => {
  giftVouchersApi.listCampaigns.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ items: [campaign()] });
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect((await screen.findAllByText('Bain journée')).length).toBeGreaterThan(0);
});

test('the recipe is sent to the server and its per-field refusals are listed, nothing opens', async () => {
  giftVouchersApi.listCampaigns.mockResolvedValue({ items: [campaign()] });
  giftVouchersApi.importRecipe.mockRejectedValue(Object.assign(new Error('Élément introuvable : Champagne.'), {
    errors: [{ field: 'composition.options[0].articleRef', message: 'Élément introuvable : Champagne.' }, { field: 'validityMonths', message: 'Validité : un nombre entier de mois.' }],
  }));
  open();
  await screen.findAllByText('Bain journée');
  const file = new File(['zip'], 'recette.zip', { type: 'application/zip' });
  await userEvent.upload(screen.getByTestId('recipe-input'), file);
  await waitFor(() => expect(giftVouchersApi.importRecipe).toHaveBeenCalledWith(file));
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText('Élément introuvable : Champagne.')).toBeInTheDocument();
  expect(within(alert).getByText('Validité : un nombre entier de mois.')).toBeInTheDocument();
  expect(screen.queryByTestId('elsewhere')).not.toBeInTheDocument();
});

test('an accepted recipe opens the new draft campaign', async () => {
  giftVouchersApi.listCampaigns.mockResolvedValue({ items: [campaign()] });
  giftVouchersApi.importRecipe.mockResolvedValue(campaign({ id: 8 }));
  open();
  await screen.findAllByText('Bain journée');
  await userEvent.upload(screen.getByTestId('recipe-input'), new File(['zip'], 'recette.zip'));
  expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
});

test('« Nouvelle campagne » opens the blank editor', async () => {
  giftVouchersApi.listCampaigns.mockResolvedValue({ items: [campaign()] });
  open();
  await screen.findAllByText('Bain journée');
  await userEvent.click(screen.getByRole('button', { name: 'Nouvelle campagne' }));
  expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
});
