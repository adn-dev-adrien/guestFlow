// specs/gift-vouchers.md rules 24, 29, §6 — « Bons cadeaux »: the list with the server's states and outstanding total,
// the search and state filter sent to the server, the empty and error states.
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import GiftVouchersPage from '../GiftVouchersPage';
import { detail, PAYMENT_METHODS, renderWithShell, summary } from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({
  default: { list: vi.fn(), get: vi.fn(), create: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  }));
});

test('lists the vouchers with the server state labels and the outstanding total', async () => {
  giftVouchersApi.list.mockResolvedValue({
    items: [summary(), summary({ id: 2, number: 'BC-2026-0002', state: 'expired' }), summary({ id: 3, number: 'BC-2026-0003', state: 'cancelled', balanceCents: 0 })],
    outstandingCents: 30000,
    paymentMethods: PAYMENT_METHODS,
  });
  renderWithShell(<GiftVouchersPage />);
  expect(await screen.findByText('BC-2026-0001')).toBeInTheDocument();
  expect(screen.getByText('Valable')).toBeInTheDocument();
  expect(screen.getByText('Expiré')).toBeInTheDocument();
  expect(screen.getByText('Annulé')).toBeInTheDocument();
  expect(screen.getByTestId('outstanding')).toHaveTextContent('Solde en cours : 300,00 €');
  expect(screen.getByRole('button', { name: 'Nouveau bon' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument();
});

test('typing in the search asks the server, which judges the match', async () => {
  giftVouchersApi.list.mockResolvedValue({ items: [summary()], outstandingCents: 15000 });
  renderWithShell(<GiftVouchersPage />);
  await screen.findByText('BC-2026-0001');
  await userEvent.type(screen.getByLabelText('Numéro, e-mail ou nom'), 'paul');
  await waitFor(() => expect(giftVouchersApi.list).toHaveBeenLastCalledWith({ q: 'paul', state: '' }));
});

test('the state filter is sent to the server', async () => {
  giftVouchersApi.list.mockResolvedValue({ items: [summary()], outstandingCents: 15000 });
  renderWithShell(<GiftVouchersPage />);
  await screen.findByText('BC-2026-0001');
  await userEvent.click(screen.getByLabelText('État'));
  await userEvent.click(within(await screen.findByRole('listbox')).getByText('Expirés'));
  await waitFor(() => expect(giftVouchersApi.list).toHaveBeenLastCalledWith({ q: '', state: 'expired' }));
});

test('an empty list offers « Nouveau bon »; a search with no match only says so', async () => {
  giftVouchersApi.list.mockResolvedValue({ items: [], outstandingCents: 0 });
  renderWithShell(<GiftVouchersPage />);
  expect(await screen.findByText('Aucun bon cadeau pour le moment.')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Numéro, e-mail ou nom'), 'zz');
  expect(await screen.findByText('Aucun bon ne correspond à la recherche.')).toBeInTheDocument();
});

test('a failed load shows the error with a retry that reloads', async () => {
  giftVouchersApi.list.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ items: [summary()], outstandingCents: 15000 });
  renderWithShell(<GiftVouchersPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('BC-2026-0001')).toBeInTheDocument();
});

test('a click on a voucher opens its detail', async () => {
  giftVouchersApi.list.mockResolvedValue({ items: [summary()], outstandingCents: 15000 });
  giftVouchersApi.get.mockResolvedValue(detail());
  renderWithShell(<GiftVouchersPage />);
  await userEvent.click(await screen.findByText('BC-2026-0001'));
  expect(await screen.findByTestId('voucher-detail')).toBeInTheDocument();
  expect(giftVouchersApi.get).toHaveBeenCalledWith(1);
});

test('a started voucher reads « Entamé », and « Entamés » is a state filter', async () => {
  giftVouchersApi.list.mockResolvedValue({
    items: [summary({ state: 'started', balanceCents: 4000 })], outstandingCents: 4000, paymentMethods: PAYMENT_METHODS,
  });
  renderWithShell(<GiftVouchersPage />);
  expect(await screen.findByText('Entamé')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox', { name: 'État' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Entamés' }));
  await waitFor(() => expect(giftVouchersApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'started' })));
});
