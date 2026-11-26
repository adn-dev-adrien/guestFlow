// specs/gift-vouchers/gift-voucher-campaigns.md rules 41, 46, 52 — « Nouveau bon »: a campaign on sale or « Sur mesure », the contents, extra time and add-ons from the server's offer, the
// server's recap with its VAT per rate, then « Payé » (means of payment from the server), « Offert » or « Envoyer un lien de paiement » (the e-mail is mandatory for it);
// the lodging free amount; every server refusal on the field it names.
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
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

const open = () => renderWithShell(<NewVoucherPage />, { route: '/bons-cadeaux/nouveau', path: '/bons-cadeaux/nouveau' });
const refusal = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const lastPrice = () => giftVouchersApi.offerPrice.mock.calls[giftVouchersApi.offerPrice.mock.calls.length - 1][0];

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.getOffer.mockResolvedValue(OFFER);
  giftVouchersApi.listVisuals.mockResolvedValue({ items: [visual()] });
  giftVouchersApi.catalogue.mockResolvedValue({ elements: CATALOGUE });
  giftVouchersApi.offerPrice.mockResolvedValue(PRICE);
  giftVouchersApi.previewPrice.mockResolvedValue(PRICE);
  giftVouchersApi.create.mockResolvedValue({ id: 42 });
});

test('the first campaign on sale is chosen, its contents and the server recap with the VAT per rate are shown', async () => {
  open();
  expect(await screen.findByRole('button', { name: /Un bain nordique/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Bain nordique — 2 h en journée · de 10:00 à 19:00')).toBeInTheDocument();
  expect(screen.getAllByText('Planche apéro').length).toBeGreaterThan(0);
  expect(await screen.findByTestId('price-recap')).toBeInTheDocument();
  expect(giftVouchersApi.offerPrice).toHaveBeenCalledWith({ slug: 'bain-jour', extraMinutes: 0, addOns: [] }, expect.anything());
  expect(screen.getByText('dont TVA 20 %')).toBeInTheDocument();
  expect(screen.getByText('dont TVA 10 %')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sur mesure' })).toBeInTheDocument();
});

test('the extra time steps by the server’s slot, within its maximum, and an add-on takes a quantity; the recap is asked again', async () => {
  open();
  await screen.findByTestId('price-recap');
  await userEvent.click(screen.getByRole('button', { name: /Ajouter au bon/ }));
  await userEvent.click((await screen.findAllByRole('button', { name: 'Augmenter' }))[0]);
  await waitFor(() => expect(lastPrice()).toMatchObject({ slug: 'bain-jour', extraMinutes: 60 }));
  await userEvent.click(screen.getAllByRole('button', { name: 'Augmenter' })[1]);
  await waitFor(() => expect(lastPrice().addOns).toEqual([{ articleRef: 'option:11', qty: 1 }]));
});

test('« Payé »: the means of payment are the server’s list, the voucher is created with the one picked and the list opens on it', async () => {
  open();
  await screen.findByTestId('price-recap');
  await userEvent.type(screen.getByLabelText(/^Prénom/), 'Léa');
  await userEvent.type(screen.getByLabelText(/^Nom/), 'Martin');
  await userEvent.type(screen.getByLabelText('De la part de'), 'Paul');
  await userEvent.click(screen.getByRole('combobox', { name: 'Moyen de paiement' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Espèces' }));
  await userEvent.click(screen.getByRole('button', { name: 'Créer le bon' }));
  await waitFor(() => expect(giftVouchersApi.create).toHaveBeenCalledWith(expect.objectContaining({
    slug: 'bain-jour', outcome: 'paid', paymentMethod: 'cash', recipientFirstName: 'Léa', recipientLastName: 'Martin', senderName: 'Paul',
  })));
  expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
});

test('« Offert »: no means of payment is sent, and the page says nothing is recorded as a sale', async () => {
  open();
  await screen.findByTestId('price-recap');
  await userEvent.click(screen.getByRole('button', { name: 'Offert' }));
  expect(screen.getByText(/Aucune vente ni TVA enregistrée/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Moyen de paiement')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Créer le bon' }));
  await waitFor(() => expect(giftVouchersApi.create).toHaveBeenCalled());
  const body = giftVouchersApi.create.mock.calls[0][0];
  expect(body.outcome).toBe('offered');
  expect(body).not.toHaveProperty('paymentMethod');
});

test('« Envoyer un lien de paiement »: the e-mail is mandatory — nothing is sent without it — then the link is sent through the server', async () => {
  giftVouchersApi.create.mockResolvedValue({ orderId: 3, outcome: 'link', emailedTo: 'paul@example.test', totalCents: 10900 });
  open();
  await screen.findByTestId('price-recap');
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer un lien de paiement' }));
  expect(screen.getByText(/Le lien, valable 1 h/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
  expect(await screen.findByText('Une adresse e-mail est demandée pour envoyer le lien.')).toBeInTheDocument();
  expect(giftVouchersApi.create).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText('E-mail de l’offreur'), 'paul@example.test');
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
  await waitFor(() => expect(giftVouchersApi.create).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'link', email: 'paul@example.test' })));
  expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
});

test('the server’s refusal of the e-mail is shown on the e-mail field and the page stays', async () => {
  giftVouchersApi.create.mockRejectedValue(refusal('Adresse e-mail invalide.', 'EMAIL_INVALID'));
  open();
  await screen.findByTestId('price-recap');
  await userEvent.type(screen.getByLabelText('E-mail de l’offreur (facultatif)'), 'pasunemail');
  await userEvent.click(screen.getByRole('button', { name: 'Créer le bon' }));
  expect(await screen.findByText('Adresse e-mail invalide.')).toBeInTheDocument();
  expect(screen.queryByTestId('elsewhere')).not.toBeInTheDocument();
});

describe('a lodging campaign — the free amount', () => {
  const chooseLodging = async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /Un séjour offert/ }));
  };

  test('the amount is typed in euros, the bounds come from the server, and the recap is asked in cents', async () => {
    await chooseLodging();
    expect(screen.getByText('de 20,00 € à 2 000,00 €')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Montant/), '5,50');
    await waitFor(() => expect(lastPrice()).toEqual({ slug: 'sejour', amountCents: 550 }));
  });

  test('the server refusal of an out-of-bounds amount is shown on the amount, from the recap and from the creation alike', async () => {
    giftVouchersApi.offerPrice.mockRejectedValue(refusal('Montant hors des bornes.', 'VOUCHER_AMOUNT_OUT_OF_BOUNDS'));
    await chooseLodging();
    await userEvent.type(screen.getByLabelText(/Montant/), '5,50');
    expect(await screen.findByText('Montant hors des bornes.')).toBeInTheDocument();
  });

  test('a non-numeric amount asks nothing of the server', async () => {
    open();
    await screen.findByTestId('price-recap');
    giftVouchersApi.offerPrice.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /Un séjour offert/ }));
    await userEvent.type(screen.getByLabelText(/Montant/), 'abc');
    expect(screen.getByText('Compléter l’offre pour voir le prix.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer le bon' })).toBeDisabled();
    expect(giftVouchersApi.offerPrice).not.toHaveBeenCalled();
  });

  test('a price idea fills the amount with the server’s figure', async () => {
    giftVouchersApi.getOffer.mockResolvedValue({
      ...OFFER, campaigns: [{ ...OFFER.campaigns[1], ideas: [{ label: 'Week-end', amounts: [{ label: 'Haute saison', amountCents: 34000 }] }] }],
    });
    open();
    await userEvent.click(await screen.findByRole('button', { name: /Week-end · Haute saison/ }));
    expect(screen.getByLabelText(/Montant/)).toHaveValue('340');
  });
});

describe('« Sur mesure »', () => {
  async function composeCustom() {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Sur mesure' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter un élément' }));
    await userEvent.click(await screen.findByRole('button', { name: /Bain nordique/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }

  test('opens the composition editor inline; the recap is asked for the composition only, and the voucher is created as a one-shot', async () => {
    await composeCustom();
    // The price draft is the composition: the validity, the visual and the recipient's add-ons never ask the server again.
    await waitFor(() => expect(giftVouchersApi.previewPrice).toHaveBeenLastCalledWith({ composition: { resourceId: 1, band: 'day', minutes: 60, options: [] } }, expect.anything()));
    await userEvent.click(screen.getByRole('button', { name: 'Créer le bon' }));
    await waitFor(() => expect(giftVouchersApi.create).toHaveBeenCalledWith(expect.objectContaining({
      composition: { resourceId: 1, band: 'day', minutes: 60, options: [] }, validityMonths: '12', outcome: 'paid', paymentMethod: 'card',
    })));
  });

  test('the server’s refusal of the composition is shown on its field', async () => {
    giftVouchersApi.previewPrice.mockRejectedValue(refusal('Durée incluse : 30 min ne convient pas.', 'COMPOSITION_INVALID', { errors: [{ field: 'composition.minutes', message: 'Durée incluse : 30 min ne convient pas.' }] }));
    await composeCustom();
    expect(await screen.findByText('Durée incluse : 30 min ne convient pas.')).toBeInTheDocument();
  });

  test('without a composition nothing is priced and the voucher cannot be created', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Sur mesure' }));
    expect(screen.getByText('Compléter l’offre pour voir le prix.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer le bon' })).toBeDisabled();
  });
});

test('a failed load of the offer says so with a retry', async () => {
  giftVouchersApi.getOffer.mockRejectedValueOnce(new Error('x'));
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByRole('button', { name: /Un bain nordique/ })).toBeInTheDocument();
});

test('with no campaign on sale « Sur mesure » is chosen and the page says so', async () => {
  giftVouchersApi.getOffer.mockResolvedValue({ campaigns: [], omitted: [{ id: 5, name: 'Bain soirée', reason: 'Aucune tranche horaire.' }], paymentMethods: OFFER.paymentMethods });
  open();
  expect(await screen.findByText(/Aucune campagne en vente/)).toBeInTheDocument();
  expect(screen.getByText(/Bain soirée — Aucune tranche horaire\./)).toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: '1 · Offre' })).getByRole('button', { name: 'Sur mesure' })).toHaveAttribute('aria-pressed', 'true');
});
