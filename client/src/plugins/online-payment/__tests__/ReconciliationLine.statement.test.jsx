// specs/mollie-settlement-receipts.md rules 10-11 — the statement of a Mollie credit on its reconciliation line: a chip
// per state, « Voir le relevé » (the PDF, in a new tab, built on the fly whatever the state), « Réessayer » when it can be tried again.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import DialogProvider from '../../../components/DialogProvider';
import ReconciliationLine from '../ReconciliationLine';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    retryMollieStatement: vi.fn(),
    mollieStatementUrl: (id) => `/api/payments/reconciliation/mollie-statements/${id}.pdf`,
  },
}));
import api from '../../../api';

const bank = (statement) => ({
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  transactionId: 'c1', amountCents: 58592, date: '2026-11-13', dateLabel: '13/11', counterparty: 'Stichting Mollie Payments',
  reference: 'REF T19274230.2610.01', allocatedCents: 58592, auto: false, alsoCovers: [],
  refs: { qonto: 'tx-1', mollieSettlement: 'T19274230.2610.01', molliePayment: null }, statement,
});
const item = (statement) => ({
  key: '101|balance#immediat', reservation: { id: 101, clientName: 'Jean Dupont', platform: null }, label: 'Solde · versement immédiat',
  expectedCents: 58592, expectedDateLabel: '15/11', paid: true, state: 'reconciled', stateLabel: 'Rapproché', tone: 'success', isGap: false,
  fixText: null, bank: [bank(statement)], proposal: null, alternatives: [], canUndo: true,
});
const noop = () => {};
const draw = (statement) => render(<DialogProvider><ReconciliationLine item={item(statement)} onConfirm={noop} onDiscard={noop} onUndo={noop} /></DialogProvider>);

beforeEach(() => { vi.clearAllMocks(); });

test('rule 11: a joined statement shows « Relevé joint » and « Voir le relevé », which opens the PDF in a new tab', () => {
  draw({ state: 'attached', error: null, attachedAt: '2026-11-14T08:00:00.000Z', gapCents: null }); // date-literal-ok: fixture data drawn as given
  expect(screen.getByText('Relevé joint')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Voir le relevé' });
  expect(link).toHaveAttribute('href', '/api/payments/reconciliation/mollie-statements/c1.pdf');
  expect(link).toHaveAttribute('target', '_blank');
  expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
});

test('rule 11: a statement still waiting says so and can already be read, with no retry', () => {
  draw({ state: 'pending', error: null, attachedAt: null, gapCents: null });
  expect(screen.getByText('Relevé en attente')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Voir le relevé' })).toHaveAttribute('target', '_blank');
  expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
});

test('rule 11: a credit without a statement shows nothing', () => {
  draw(null);
  expect(screen.queryByTestId('mollie-statement')).not.toBeInTheDocument();
});

test('rule 10: a mismatch names the gap and offers « Réessayer »; the new state replaces the chip', async () => {
  api.retryMollieStatement.mockResolvedValue({ statement: { state: 'attached', error: null, attachedAt: null, gapCents: null } });
  draw({ state: 'mismatch', error: 'Le relevé totalise 80,00 €, le virement 79,99 €.', attachedAt: null, gapCents: 1 });
  expect(screen.getByText(/À revoir : écart de 0,01\s*€/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(api.retryMollieStatement).toHaveBeenCalledWith('c1');
  await waitFor(() => expect(screen.getByText('Relevé joint')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
});

test('rule 10: failed and reauth offer « Réessayer »; reauth says « Reconnecter Qonto »', () => {
  const { unmount } = draw({ state: 'failed', error: 'HTTP 500', attachedAt: null, gapCents: null });
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  unmount();
  draw({ state: 'reauth', error: 'Reconnecter Qonto pour joindre les relevés.', attachedAt: null, gapCents: null });
  expect(screen.getByText('Reconnecter Qonto')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
});

test('rule 10: a retry that fails says so in a toast and leaves the line as it was', async () => {
  api.retryMollieStatement.mockRejectedValue(new Error('Qonto injoignable'));
  draw({ state: 'failed', error: 'HTTP 500', attachedAt: null, gapCents: null });
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Qonto injoignable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réessayer' })).not.toBeDisabled();
});

test('rule 10: the state of a retry gives way to the page\'s own once the page brings a new one', async () => {
  api.retryMollieStatement.mockResolvedValue({ statement: { state: 'pending', error: null, attachedAt: null, gapCents: null } });
  const view = draw({ state: 'failed', error: 'HTTP 500', attachedAt: null, gapCents: null });
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(screen.getByText('Relevé en attente')).toBeInTheDocument());
  view.rerender(<DialogProvider><ReconciliationLine item={item({ state: 'attached', error: null, attachedAt: null, gapCents: null })} onConfirm={noop} onDiscard={noop} onUndo={noop} /></DialogProvider>);
  await waitFor(() => expect(screen.getByText('Relevé joint')).toBeInTheDocument());
});
