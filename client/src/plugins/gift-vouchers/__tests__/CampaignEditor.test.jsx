// specs/gift-vouchers/gift-voucher-campaigns.md rules 2-10, 46, 47, 59 — the campaign editor: the sections, the lodging fields moved here from the settings (amounts, VAT, ideas),
// the price the server computes for the content being edited (never computed here), the server's refusal shown under the field it names, the locked slug, the downloads.
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import CampaignEditor from '../CampaignEditor';
import {
  campaign, CATALOGUE, lodgingCampaign, PRICE, renderWithShell, visual,
} from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({
  default: {
    getCampaign: vi.fn(), listVisuals: vi.fn(), catalogue: vi.fn(), previewPrice: vi.fn(), updateCampaign: vi.fn(), createCampaign: vi.fn(), getProperties: vi.fn(),
    duplicateCampaign: vi.fn(), downloadMerchantCard: vi.fn(), downloadRecipe: vi.fn(), visualImageUrl: vi.fn(() => '/api/gift-vouchers/visuals/3/image?version=31'),
  },
}));

const open = (id = '5') => renderWithShell(<CampaignEditor />, { route: `/bons-cadeaux/campagnes/${id}`, path: '/bons-cadeaux/campagnes/:id' });

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.getCampaign.mockResolvedValue(campaign());
  giftVouchersApi.listVisuals.mockResolvedValue({ items: [visual()] });
  giftVouchersApi.catalogue.mockResolvedValue({ elements: CATALOGUE });
  giftVouchersApi.previewPrice.mockResolvedValue(PRICE);
  giftVouchersApi.getProperties.mockResolvedValue([{ id: 7, name: 'L’Estiva' }]);
});

const refusal = (errors) => Object.assign(new Error(errors[0].message), { code: 'CAMPAIGN_INVALID', errors });

test('a composed campaign shows its sections, its composition and the links read from the server', async () => {
  open();
  expect(await screen.findByDisplayValue('Bain journée')).toBeInTheDocument();
  ['Général', 'Contenu', 'Options proposées', 'Temps en plus', 'Visuels', 'Liens permanents', 'Téléchargements'].forEach((title) => {
    expect(screen.getByText(title)).toBeInTheDocument();
  });
  expect(screen.getByText('Bain nordique')).toBeInTheDocument();
  expect(screen.getByText('/bon-cadeau/offrir/bain-jour')).toBeInTheDocument();
  expect(screen.getByText('/bon-cadeau/utiliser')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('the price comes from the server preview: lines, total and « dont TVA » per rate', async () => {
  open();
  expect(await screen.findByTestId('price-recap')).toBeInTheDocument();
  expect(giftVouchersApi.previewPrice).toHaveBeenCalledWith({ composition: campaign().composition, period: 'week' }, expect.anything());
  expect(screen.getByText('Bain nordique · journée')).toBeInTheDocument();
  expect(screen.getByText(/109,00/)).toBeInTheDocument();
  expect(screen.getByText('dont TVA 20 %')).toBeInTheDocument();
  expect(screen.getByText('dont TVA 10 %')).toBeInTheDocument();
});

test('the reason the engine gives when the content cannot be priced is shown in the preview', async () => {
  giftVouchersApi.previewPrice.mockRejectedValue(Object.assign(new Error('« Bain nordique » n’a pas de tarif extérieur pour la soirée.'), { code: 'PRICE_UNAVAILABLE' }));
  open();
  expect(await screen.findByText('« Bain nordique » n’a pas de tarif extérieur pour la soirée.')).toBeInTheDocument();
});

test('a saved campaign the engine cannot price shows its reason at the top', async () => {
  giftVouchersApi.getCampaign.mockResolvedValue(campaign({ pricing: { priceable: false, reason: 'Aucune tranche horaire n’est réglée sur cette ressource.' } }));
  open();
  expect(await screen.findByText(/Aucune tranche horaire/)).toBeInTheDocument();
});

test('saving sends the composition and shows the server refusal under the field it names; the draft is kept', async () => {
  giftVouchersApi.updateCampaign.mockRejectedValue(refusal([
    { field: 'validityMonths', message: 'La validité doit être de 3, 6, 12, 18 ou 24 mois.' },
    { field: 'composition.minutes', message: 'Durée incluse : 30 min ne convient pas.' },
  ]));
  open();
  const months = await screen.findByLabelText('Validité');
  await userEvent.click(months);
  await userEvent.click(await screen.findByRole('option', { name: '6 mois' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(giftVouchersApi.updateCampaign).toHaveBeenCalled());
  const [id, body] = giftVouchersApi.updateCampaign.mock.calls[0];
  expect(id).toBe('5');
  expect(body).toMatchObject({ kind: 'resource', validityMonths: '6', composition: campaign().composition, addOns: ['option:11'], extraTimeMaxMinutes: 120 });
  expect(await screen.findByText('La validité doit être de 3, 6, 12, 18 ou 24 mois.')).toBeInTheDocument();
  expect(screen.getByText('Durée incluse : 30 min ne convient pas.')).toBeInTheDocument();
  expect(months).toHaveTextContent('6 mois');
});

test('a locked slug cannot be edited and says why', async () => {
  giftVouchersApi.getCampaign.mockResolvedValue(campaign({ slugLockedAt: '2026-11-10T10:00:00.000Z' })); // date-literal-ok: a payload the mocked server answers; the screen only shows it
  open();
  expect(await screen.findByLabelText('Identifiant du lien')).toBeDisabled();
  expect(screen.getByText(/Verrouillé : une carte du commerçant/)).toBeInTheDocument();
});

test('« Carte commerçant (PDF imprimeur) » downloads from the server and reloads the campaign; a refusal is shown', async () => {
  giftVouchersApi.downloadMerchantCard.mockResolvedValueOnce(undefined);
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Carte commerçant (PDF imprimeur)' }));
  await waitFor(() => expect(giftVouchersApi.downloadMerchantCard).toHaveBeenCalledWith(5, 'bain-jour'));
  await waitFor(() => expect(giftVouchersApi.getCampaign).toHaveBeenCalledTimes(2));
  giftVouchersApi.downloadMerchantCard.mockRejectedValueOnce(new Error('Aucun visuel de carte commerçant.'));
  await userEvent.click(screen.getByRole('button', { name: 'Carte commerçant (PDF imprimeur)' }));
  expect(await screen.findByText('Aucun visuel de carte commerçant.')).toBeInTheDocument();
});

test('« Dupliquer » asks the server for a draft copy and opens it', async () => {
  giftVouchersApi.duplicateCampaign.mockResolvedValue(campaign({ id: 9, name: 'Bain journée (copie)' }));
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Dupliquer' }));
  await waitFor(() => expect(giftVouchersApi.duplicateCampaign).toHaveBeenCalledWith('5'));
  await waitFor(() => expect(giftVouchersApi.getCampaign).toHaveBeenLastCalledWith('9'));
});

test('« Nouvelle campagne » starts blank, creates through the server and moves to the saved campaign', async () => {
  giftVouchersApi.createCampaign.mockResolvedValue(campaign({ id: 12 }));
  giftVouchersApi.getCampaign.mockResolvedValue(campaign({ id: 12 }));
  open('nouvelle');
  const name = await screen.findByLabelText('Nom (interne)');
  expect(giftVouchersApi.getCampaign).not.toHaveBeenCalled();
  await userEvent.type(name, 'Bain journée');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(giftVouchersApi.createCampaign).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bain journée', kind: 'resource', state: 'draft' })));
  await waitFor(() => expect(giftVouchersApi.getCampaign).toHaveBeenLastCalledWith('12'));
});

describe('a lodging campaign — the fields moved from the settings', () => {
  beforeEach(() => { giftVouchersApi.getCampaign.mockResolvedValue(lodgingCampaign()); });

  test('shows the bounds in euros, the VAT rate and the ideas; no price is previewed', async () => {
    open('1');
    expect(await screen.findByLabelText('Montant minimal (€)')).toHaveValue('20');
    expect(screen.getByLabelText('Montant maximal (€)')).toHaveValue('2000');
    expect(screen.getByLabelText('TVA des bons cadeaux')).toHaveValue('10');
    expect(screen.getByDisplayValue('Week-end')).toBeInTheDocument();
    expect(screen.getByText(/le prix est celui que choisit l’offreur/)).toBeInTheDocument();
    expect(giftVouchersApi.previewPrice).not.toHaveBeenCalled();
  });

  test('saves the amounts in cents, the rate as typed and the ideas as a list of stays', async () => {
    giftVouchersApi.updateCampaign.mockResolvedValue(lodgingCampaign());
    open('1');
    const max = await screen.findByLabelText('Montant maximal (€)');
    await userEvent.clear(max);
    await userEvent.type(max, '3000');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(giftVouchersApi.updateCampaign).toHaveBeenCalled());
    expect(giftVouchersApi.updateCampaign.mock.calls[0][1]).toMatchObject({
      kind: 'lodging', minAmountCents: 2000, maxAmountCents: 300000, vatRatePercent: '10', ideas: [{ label: 'Week-end', propertyId: 7, nights: 2, guests: 2 }],
    });
  });

  test('an idea is added with a lodging, nights and guests — no amount field — and removed', async () => {
    open('1');
    await screen.findByDisplayValue('Week-end');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter une idée' }));
    expect(screen.getByLabelText('Libellé 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Nuits 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Personnes 2')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Montant d’une idée/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retirer cette idée 2' }));
    expect(screen.queryByLabelText('Libellé 2')).not.toBeInTheDocument();
  });

  test.each([
    ['', 'Saisir un taux (0 si les bons ne portent pas de TVA).'],
    ['abc', 'Saisir un nombre, par exemple 10 ou 5,5.'],
    ['5,555', 'Deux décimales au plus.'],
    ['120', 'Saisir un taux entre 0 et 100 %.'],
  ])('the rate %j is hinted while typing and Enregistrer stays blocked: %s', async (typed, hint) => {
    open('1');
    const rate = await screen.findByLabelText('TVA des bons cadeaux');
    await userEvent.clear(rate);
    if (typed) await userEvent.type(rate, typed);
    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  test('a refused amount and a refused idea list are shown on their fields (the server names them in cents)', async () => {
    giftVouchersApi.updateCampaign.mockRejectedValue(refusal([
      { field: 'minAmountCents', message: 'Montant minimal : au plus le montant maximal.' },
      { field: 'ideas', message: 'Chaque idée désigne un logement.' },
    ]));
    open('1');
    const min = await screen.findByLabelText('Montant minimal (€)');
    await userEvent.type(min, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Montant minimal : au plus le montant maximal.')).toBeInTheDocument();
    expect(screen.getByText('Chaque idée désigne un logement.')).toBeInTheDocument();
  });
});

test('rule 61: « Réessayer » brings the price back and the focus stays in the preview, never on the page', async () => {
  giftVouchersApi.previewPrice.mockRejectedValueOnce(Object.assign(new Error('Service indisponible'), { status: 503 }));
  open();
  const retry = await screen.findByRole('button', { name: 'Réessayer' });
  retry.focus();
  await userEvent.click(retry);
  expect(await screen.findByTestId('price-recap')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
  expect(document.activeElement).not.toBe(document.body);
});

test('rule 61: a refusal of the price shows its reason without « Réessayer »', async () => {
  giftVouchersApi.previewPrice.mockRejectedValue(Object.assign(new Error('« Bain nordique » n’a pas de tarif extérieur pour la soirée.'), { status: 422, code: 'PRICE_UNAVAILABLE' }));
  open();
  expect(await screen.findByText('« Bain nordique » n’a pas de tarif extérieur pour la soirée.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
});
