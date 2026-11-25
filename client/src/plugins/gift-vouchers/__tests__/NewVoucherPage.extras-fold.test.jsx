// specs/gift-voucher-campaigns.md rule 63 — « Nouveau bon »: the extra time and the add-ons of a campaign sit in one fold « Ajouter au bon », closed by default; its head counts
// what is inside, then names what is chosen with the price answer's `extrasCents`; each line shows the price the server gives for its quantity (looked up, never multiplied);
// at the maximum the « + » is disabled and the line says so.
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
const head = () => screen.getByRole('button', { name: /Ajouter au bon/ });
const norm = (text) => text.replace(/\s/g, ' ');
const lineOf = (label) => screen.getByText(label, { selector: 'p' }).parentElement.parentElement;

// Not multiples of the unit: a page that multiplied would draw another figure.
const withExtras = (cents) => ({ ...PRICE, extrasCents: cents });

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.getOffer.mockResolvedValue(OFFER);
  giftVouchersApi.listVisuals.mockResolvedValue({ items: [visual()] });
  giftVouchersApi.catalogue.mockResolvedValue({ elements: CATALOGUE });
  giftVouchersApi.offerPrice.mockImplementation(async (body) => withExtras(body.extraMinutes ? 4321 : 0));
  giftVouchersApi.previewPrice.mockResolvedValue(PRICE);
});

test('rule 63: the fold is closed by default; its head counts what is inside with the lowest first price, and the lines appear when it opens', async () => {
  open();
  await screen.findByTestId('price-recap');
  expect(head()).toHaveAttribute('aria-expanded', 'false');
  expect(norm(head().textContent)).toContain('2 disponibles · dès 6,50 €');
  expect(screen.queryByText('Boisson')).not.toBeInTheDocument();
  await userEvent.click(head());
  expect(head()).toHaveAttribute('aria-expanded', 'true');
  expect(await screen.findByText('Boisson')).toBeInTheDocument();
  expect(screen.getByText('Prix TTC, ajoutés au montant du bon.')).toBeInTheDocument();
});

test('rule 63: each line shows the server’s price for one step, then for the quantity chosen, and the head shows the names and the server’s extrasCents', async () => {
  open();
  await screen.findByTestId('price-recap');
  await userEvent.click(head());
  expect(norm(lineOf('Temps en plus').textContent)).toContain('45,00 € par tranche de 1 h');
  expect(norm(lineOf('Boisson').textContent)).toContain('6,50 € l’unité');
  const drink = lineOf('Boisson');
  await userEvent.click(within(drink).getByRole('button', { name: 'Augmenter' }));
  await userEvent.click(within(drink).getByRole('button', { name: 'Augmenter' }));
  expect(norm(drink.textContent)).toContain('2 × 6,50 € = 12,50 €');
  await userEvent.click(within(lineOf('Temps en plus')).getByRole('button', { name: 'Augmenter' }));
  expect(norm(lineOf('Temps en plus').textContent)).toContain('+1 h = 45,00 €');
  await waitFor(() => expect(norm(head().textContent)).toContain('+1 h, Boisson ×2'));
  await waitFor(() => expect(norm(head().textContent)).toContain('+ 43,21 €'));
  expect(head().textContent).toContain('2');
});

test('rule 63: at the maximum the « + » is disabled and the line says so', async () => {
  open();
  await screen.findByTestId('price-recap');
  await userEvent.click(head());
  const time = within(lineOf('Temps en plus'));
  await userEvent.click(time.getByRole('button', { name: 'Augmenter' }));
  await userEvent.click(time.getByRole('button', { name: 'Augmenter' }));
  expect(time.getByRole('button', { name: 'Augmenter' })).toBeDisabled();
  expect(norm(lineOf('Temps en plus').textContent)).toContain('2 h au maximum par bon');
});

test('rule 63: a campaign whose extras the server could not price draws no fold', async () => {
  const [bath, lodging] = OFFER.campaigns;
  giftVouchersApi.getOffer.mockResolvedValue({ ...OFFER, campaigns: [{ ...bath, addOns: [], extraTime: null }, lodging] });
  open();
  await screen.findByTestId('price-recap');
  expect(screen.queryByRole('button', { name: /Ajouter au bon/ })).not.toBeInTheDocument();
});

test('rule 63: changing the campaign forgets the extras chosen on the other, and a refusal for the extras shows in the closed fold’s head', async () => {
  open();
  await screen.findByTestId('price-recap');
  await userEvent.click(head());
  await userEvent.click(within(lineOf('Boisson')).getByRole('button', { name: 'Augmenter' }));
  await waitFor(() => expect(giftVouchersApi.offerPrice.mock.calls.at(-1)[0].addOns).toEqual([{ articleRef: 'option:11', qty: 1 }]));
  await userEvent.click(screen.getByRole('button', { name: /Un séjour offert/ }));
  await userEvent.click(screen.getByRole('button', { name: /Un bain nordique/ }));
  await waitFor(() => expect(giftVouchersApi.offerPrice.mock.calls.at(-1)[0]).toEqual({ slug: 'bain-jour', extraMinutes: 0, addOns: [] }));
  expect(head()).toHaveAttribute('aria-expanded', 'false');
  giftVouchersApi.offerPrice.mockRejectedValue(Object.assign(new Error('Temps supplémentaire : 2 h au plus.'), { code: 'EXTRA_TIME_NOT_OFFERED' }));
  await userEvent.click(head());
  await userEvent.click(within(await screen.findByText('Temps en plus', { selector: 'p' }).then((el) => el.parentElement.parentElement)).getByRole('button', { name: 'Augmenter' }));
  await userEvent.click(head());
  expect(head()).toHaveAttribute('aria-expanded', 'false');
  expect(await screen.findByText('Temps supplémentaire : 2 h au plus.')).toBeInTheDocument();
});
