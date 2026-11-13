/**
 * StandaloneSaleDialog — « Vente hors séjour » (specs/pricing-components.md rules 53, 74; specs/outside-booking-sas.md rule 8, owner M4): articles from the catalogue, the quote's figures and
 * VAT rows rendered from the payload, the customer (« Passage », an exact e-mail match, « Enregistrer comme client »), the payment with « Reste à percevoir » only or a link, the saved
 * screen and « Nouvelle vente ».
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getSuggestedArticlesCatalogue: vi.fn(),
    quoteStandaloneSale: vi.fn(),
    sellStandaloneSale: vi.fn(),
    mintStandaloneSaleLink: vi.fn(),
    withdrawStandaloneSaleLink: vi.fn(),
    emailStandaloneSaleLink: vi.fn(),
  },
}));

import api from '../../api';
import StandaloneSaleDialog from '../StandaloneSaleDialog';

const CATALOGUE = [
  { articleRef: 'option:7', label: 'Bière locale', unitCents: 650, max: 12, category: 'Boissons' },
  { articleRef: 'option:8', label: 'Limonade', unitCents: 400, max: 12, category: 'Boissons' },
];
const NO_LINK = { available: false, reason: 'PROVIDER_NOT_READY', email: null, open: null };
const line = (over) => ({
  id: null, ref: 'draft:0', kind: 'extra', label: 'Bière locale', detail: '1 × 6,50 €', quantity: 1, unitCents: 650, totalCents: 650, catalogueCents: 650, offered: false, status: 'due', statusLabel: 'À payer', ...over,
});
const quoteOf = (extras, { link = NO_LINK, kind = 'passage', label = 'Passage' } = {}) => {
  const lines = extras.map((e, i) => line({ ref: `draft:${i}`, label: CATALOGUE.find((c) => c.articleRef === e.articleRef).label, quantity: e.quantity, totalCents: e.offered ? 0 : e.quantity * (e.articleRef === 'option:7' ? 650 : 400), catalogueCents: e.quantity * (e.articleRef === 'option:7' ? 650 : 400), offered: Boolean(e.offered) }));
  const total = lines.reduce((sum, l) => sum + l.totalCents, 0);
  return {
    document: { lines, totals: { totalCents: total, paidCents: 0, remainingCents: total, refundOwedCents: 0 }, vatByRate: [{ rate: 20, vatCents: Math.round((total * 20) / 120) }] },
    customer: { clientId: 1, label, kind }, refusals: [], quoted: true, paymentLink: link,
  };
};
const SOLD = (over = {}) => ({
  document: { document: { id: 301, ref: 'standalone:301' } },
  sale: { id: 301, clientLabel: 'Passage', lines: ['Bière locale × 2'], totalCents: 1300, remainingCents: 0, statusLabel: 'Payée', tone: 'paid' },
  paymentLink: NO_LINK,
  ...over,
});

const mount = () => {
  const onSold = vi.fn();
  render(<StandaloneSaleDialog open onClose={() => {}} onSold={onSold} />);
  return { onSold };
};
const addBeer = async () => fireEvent.click(await screen.findByRole('button', { name: /Bière locale/ }));

beforeEach(() => {
  vi.clearAllMocks();
  api.getSuggestedArticlesCatalogue.mockResolvedValue({ articles: CATALOGUE });
  api.quoteStandaloneSale.mockImplementation(async (body) => quoteOf(body.lines));
  api.sellStandaloneSale.mockResolvedValue(SOLD());
});

test('rule 53 — the articles come from the catalogue; adding one asks the quote, whose total and external-VAT row are rendered as answered', async () => {
  mount();
  await addBeer();
  await addBeer();
  await waitFor(() => expect(api.quoteStandaloneSale).toHaveBeenLastCalledWith(expect.objectContaining({ lines: [{ articleRef: 'option:7', quantity: 2, offered: false }] }), expect.anything()));
  await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('13,00 €'));
  expect(screen.getByText('dont TVA 20 % (client extérieur) : 2,17 €')).toBeInTheDocument();
});

test('rule 8 — an anonymous sale reads « Passage »; an exact e-mail match says the sale is attached to that record and hides « Enregistrer comme client »', async () => {
  api.quoteStandaloneSale.mockImplementation(async (body) => quoteOf(body.lines, body.customer && body.customer.email === 'connu@exemple.fr' ? { kind: 'match', label: 'Claire Martin' } : {}));
  mount();
  await addBeer();
  expect(await screen.findByText('Vente sans client nommé.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'connu@exemple.fr' } });
  expect(await screen.findByText('Même e-mail qu’une fiche client : la vente y est rattachée.')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Enregistrer comme client' })).toBeNull();
});

test('rule 8 — « Enregistrer comme client » needs a name; an invalid e-mail is a hint and asks nothing of the server', async () => {
  mount();
  await addBeer();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Enregistrer comme client' }));
  expect(await screen.findByText('Un nom pour enregistrer le client.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Enregistrer la vente/ })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Claire Martin' } });
  await waitFor(() => expect(screen.getByRole('button', { name: /Enregistrer la vente/ })).toBeEnabled());
  const calls = api.quoteStandaloneSale.mock.calls.length;
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'pas-une-adresse' } });
  expect(await screen.findByText('Adresse e-mail invalide.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Enregistrer la vente/ })).toBeDisabled();
  expect(api.quoteStandaloneSale.mock.calls.length).toBe(calls);
});

test('rule 53 — a quantity out of bounds is the server\'s refusal under its line and blocks the sale', async () => {
  api.quoteStandaloneSale.mockImplementation(async (body) => ({
    ...quoteOf([]), refusals: body.lines.some((l) => l.quantity > 12) ? [{ articleRef: 'option:7', code: 'QUANTITY_OUT_OF_BOUNDS', message: 'Quantité : 1 à 12.' }] : [],
    document: { lines: [], totals: { totalCents: 0, paidCents: 0, remainingCents: 0, refundOwedCents: 0 }, vatByRate: [] },
  }));
  mount();
  await addBeer();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Quantité Bière locale' }), { target: { value: '13' } });
  expect(await screen.findByText('Quantité : 1 à 12.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Enregistrer la vente/ })).toBeDisabled();
});

test('rule 74 — saving sends the lines, the customer, the total the operator saw and the payment; a gap offers « Reste à percevoir » only; the saved screen offers « Nouvelle vente »', async () => {
  const { onSold } = mount();
  await addBeer();
  await addBeer();
  const amount = await screen.findByRole('textbox', { name: 'Montant CB' });
  fireEvent.change(amount, { target: { value: '5' } });
  expect(await screen.findByRole('button', { name: /Reste à percevoir/ })).toBeInTheDocument();
  expect(screen.queryByText('Geste commercial')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Reste à percevoir/ }));
  const save = await screen.findByRole('button', { name: 'Enregistrer la vente · encaisser 5,00 €' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(api.sellStandaloneSale).toHaveBeenCalled());
  expect(api.sellStandaloneSale.mock.calls[0][0]).toEqual({
    lines: [{ articleRef: 'option:7', quantity: 2, offered: false }], customer: {}, acceptedTotalCents: 1300,
    payment: { tenders: [{ method: 'card', amountCents: 500, internal: false }], shortfall: { kind: 'due' } },
  });
  expect(await screen.findByText('Vente n° 301 enregistrée · Passage')).toBeInTheDocument();
  expect(screen.getByText('Payée')).toBeInTheDocument();
  expect(onSold).toHaveBeenCalledWith(expect.objectContaining({ id: 301 }));
  fireEvent.click(screen.getByRole('button', { name: 'Nouvelle vente' }));
  expect(await screen.findByText('Aucun article ajouté.')).toBeInTheDocument();
});

test('rule 39 — with a ready provider « Envoyer un lien » is offered; the sale is saved with no payment and its link is created and shown, nothing e-mailed', async () => {
  const READY = { available: true, reason: null, email: 'a@exemple.fr', open: null };
  api.quoteStandaloneSale.mockImplementation(async (body) => quoteOf(body.lines, { link: READY }));
  const OPEN = { id: 5, url: 'https://pay.exemple.fr/l/xyz', amountCents: 650, expiresAt: '2099-02-14T08:00:00.000Z' };
  api.mintStandaloneSaleLink.mockResolvedValue({ ...SOLD(), paymentLink: { ...READY, open: OPEN }, link: OPEN });
  mount();
  await addBeer();
  fireEvent.click(await screen.findByRole('button', { name: 'Envoyer un lien' }));
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@exemple.fr' } });
  const save = await screen.findByRole('button', { name: 'Enregistrer et créer le lien' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(api.sellStandaloneSale).toHaveBeenCalled());
  expect(api.sellStandaloneSale.mock.calls[0][0].payment).toBeUndefined();
  await waitFor(() => expect(api.mintStandaloneSaleLink).toHaveBeenCalledWith(301, { email: 'a@exemple.fr' }));
  expect(await screen.findByText('https://pay.exemple.fr/l/xyz')).toBeInTheDocument();
  expect(api.emailStandaloneSaleLink).not.toHaveBeenCalled();
});

test('without a ready provider « Envoyer un lien » is not offered; a refused sale shows the server\'s words and keeps the draft', async () => {
  api.sellStandaloneSale.mockRejectedValue(new Error('Prix modifié — relire le panier'));
  mount();
  await addBeer();
  await screen.findByRole('textbox', { name: 'Montant CB' });
  expect(screen.queryByRole('button', { name: 'Envoyer un lien' })).toBeNull();
  const save = await screen.findByRole('button', { name: /Enregistrer la vente/ });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  expect(await screen.findByText('Prix modifié — relire le panier')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Quantité Bière locale' })).toBeInTheDocument();
});

test('everything offered: nothing to collect, the sale still saves', async () => {
  mount();
  await addBeer();
  fireEvent.click(await screen.findByRole('button', { name: 'Offrir' }));
  expect(await screen.findByText('Tout est offert : rien à encaisser.')).toBeInTheDocument();
  const save = screen.getByRole('button', { name: 'Enregistrer la vente' });
  await waitFor(() => expect(save).toBeEnabled());
});
