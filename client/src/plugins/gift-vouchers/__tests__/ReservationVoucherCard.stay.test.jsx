// specs/gift-vouchers/gift-vouchers.md rules 40-41 — the fiche's card: what the server shaped is rendered; paying checks the code and the
// amount inline before any call and shows the server's refusal; a payment is taken back after a confirmation; a cancelled stay
// offers « Recréditer le bon »; and the card is absent where there is nothing to show.
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import giftVouchersApi from '../giftVouchersApi';
import ReservationVoucherCard from '../ReservationVoucherCard';
import { renderWithShell } from './giftVoucherFixtures';

vi.mock('../giftVouchersApi', () => ({
  default: {
    getStay: vi.fn(), payStay: vi.fn(), undoStayPayment: vi.fn(), recreditStay: vi.fn(),
  },
}));

const line = (over = {}) => ({
  ref: '12', label: 'Bon cadeau BC-2026-0001', amountCents: 5000, paidDate: '2026-11-15', buckets: ['deposit'], undoable: true, ...over, // date-literal-ok: a payload the mocked server answers; the screen only shows it
});
const stay = (over = {}) => ({
  reservationId: 5, kind: 'reservation', canPay: true, owedCents: 25000, lines: [], ...over,
});
const renderCard = (props = {}) => renderWithShell(<ReservationVoucherCard reservationId={5} reloadFinance={vi.fn()} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
  giftVouchersApi.getStay.mockResolvedValue(stay());
});

test('shows what the stay still owes and a payment form: code and amount', async () => {
  renderCard();
  expect(await screen.findByText('Reste à payer : 250,00 €.')).toBeInTheDocument();
  expect(screen.getByLabelText('Code du bon')).toBeInTheDocument();
  expect(screen.getByLabelText('Montant (€)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Payer par bon cadeau' })).toBeInTheDocument();
});

test('refuses an empty code, an invalid amount and an amount above what the stay owes, inline, before any call', async () => {
  renderCard();
  await screen.findByText('Reste à payer : 250,00 €.');
  await userEvent.click(screen.getByRole('button', { name: 'Payer par bon cadeau' }));
  expect(screen.getByText('Le code du bon est attendu.')).toBeInTheDocument();
  expect(screen.getByText('Montant invalide.')).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Code du bon'), '7K2Q-HD9M-4TXB-3NPC');
  await userEvent.type(screen.getByLabelText('Montant (€)'), '260');
  await userEvent.click(screen.getByRole('button', { name: 'Payer par bon cadeau' }));
  expect(screen.getByText('Au plus 250,00 €.')).toBeInTheDocument();
  expect(giftVouchersApi.payStay).not.toHaveBeenCalled();
});

test('pays in cents, shows the new line, empties the fields and asks the fiche to reload its payments', async () => {
  const reloadFinance = vi.fn();
  giftVouchersApi.payStay.mockResolvedValue(stay({ owedCents: 20000, lines: [line()] }));
  renderCard({ reloadFinance });
  await userEvent.type(await screen.findByLabelText('Code du bon'), '7K2Q-HD9M-4TXB-3NPC');
  await userEvent.type(screen.getByLabelText('Montant (€)'), '50,00');
  await userEvent.click(screen.getByRole('button', { name: 'Payer par bon cadeau' }));
  await waitFor(() => expect(giftVouchersApi.payStay).toHaveBeenCalledWith(5, { code: '7K2Q-HD9M-4TXB-3NPC', amountCents: 5000 }));
  expect(await screen.findByText(/Bon cadeau BC-2026-0001 · 50,00 €/)).toBeInTheDocument();
  expect(screen.getByText('Reste à payer : 200,00 €.')).toBeInTheDocument();
  expect(screen.getByLabelText('Code du bon')).toHaveValue('');
  expect(reloadFinance).toHaveBeenCalled();
});

test('shows the server’s refusal on the code, or on the amount when it is about the amount', async () => {
  giftVouchersApi.payStay.mockRejectedValueOnce(new Error('Code inconnu.')).mockRejectedValueOnce(new Error('Le montant dépasse le solde du bon.'));
  renderCard();
  await userEvent.type(await screen.findByLabelText('Code du bon'), '7K2Q-HD9M-4TXB-3NPC');
  await userEvent.type(screen.getByLabelText('Montant (€)'), '50');
  await userEvent.click(screen.getByRole('button', { name: 'Payer par bon cadeau' }));
  expect(await screen.findByText('Code inconnu.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Payer par bon cadeau' }));
  expect(await screen.findByText('Le montant dépasse le solde du bon.')).toBeInTheDocument();
});

test('takes a payment back only after a confirmation', async () => {
  giftVouchersApi.getStay.mockResolvedValue(stay({ owedCents: 20000, lines: [line()] }));
  giftVouchersApi.undoStayPayment.mockResolvedValue(stay());
  renderCard();
  await userEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
  expect(giftVouchersApi.undoStayPayment).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByRole('button', { name: 'Annuler le paiement' }));
  await waitFor(() => expect(giftVouchersApi.undoStayPayment).toHaveBeenCalledWith(5, '12'));
  await waitFor(() => expect(screen.queryByText(/Bon cadeau BC-2026-0001/)).not.toBeInTheDocument());
});

test('a payment that cannot be undone (the booking’s own) has no undo', async () => {
  giftVouchersApi.getStay.mockResolvedValue(stay({ owedCents: 0, lines: [line({ undoable: false })] }));
  renderCard();
  expect(await screen.findByText(/Bon cadeau BC-2026-0001 · 50,00 €/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Annuler' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Code du bon')).not.toBeInTheDocument();
});

test('a cancelled stay offers « Recréditer le bon » for the voucher part, never money', async () => {
  giftVouchersApi.getStay.mockResolvedValue(stay({
    kind: 'cancelled', canPay: false, owedCents: 0, lines: [line({ undoable: false })], recredit: { voucherCents: 5000, recreditCents: 2040, keptCents: 6000 },
  }));
  giftVouchersApi.recreditStay.mockResolvedValue(stay({ kind: 'cancelled', canPay: false, owedCents: 0, lines: [line({ undoable: false })], recredit: { voucherCents: 2960, recreditCents: 0, keptCents: 6000 } }));
  renderCard();
  expect(await screen.findByText(/20,40 € sur 50,00 € payés par bon cadeau peuvent retourner sur le bon/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Recréditer le bon' }));
  await waitFor(() => expect(giftVouchersApi.recreditStay).toHaveBeenCalledWith(5));
  expect(await screen.findByText('L’indemnité d’annulation retient toute la part payée par bon cadeau.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Recréditer le bon' })).not.toBeInTheDocument();
});

test('renders nothing for a stay with nothing owed and no voucher payment, a quote, or a refused read', async () => {
  giftVouchersApi.getStay.mockResolvedValue(stay({ owedCents: 0 }));
  const { container, unmount } = renderCard();
  await waitFor(() => expect(giftVouchersApi.getStay).toHaveBeenCalled());
  expect(container.textContent).toBe('');
  unmount();

  giftVouchersApi.getStay.mockRejectedValue(Object.assign(new Error('Accès refusé'), { status: 403 }));
  const refused = renderCard();
  await waitFor(() => expect(giftVouchersApi.getStay).toHaveBeenCalledTimes(2));
  expect(refused.container.textContent).toBe('');
  refused.unmount();

  const fresh = renderCard({ reservationId: null });
  expect(fresh.container.textContent).toBe('');
});
