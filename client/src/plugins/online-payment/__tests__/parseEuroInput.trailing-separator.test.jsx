// Loop t25 verifier (specs/qonto-bank-reconciliation.md §6; plugins-phase-1-sdk rule 54 reading of 2026-11-19) — `parseEuroInput` reads
// an amount being typed with its decimal separator last (« 100, ») as the whole amount, so the payout split and « Modifier la répartition »
// never flash « Montant invalide » / « — » for that keystroke. Everything else it refused stays refused (the server validates anyway).
import React from 'react';
import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseEuroInput } from '../reconciliationShared';

vi.mock('../../../api', () => ({ __esModule: true, default: { previewReconciliationAllocation: vi.fn() } }));
import api from '../../../api';
import SplitSharesDialog from '../SplitSharesDialog';

test.each([
  ['100,', 10000], ['100.', 10000], ['100', 10000], ['100,5', 10050], ['100,50', 10050], ['1 234,5 €', 123450], ['0,', 0],
  [',5', null], ['100,505', null], ['100,,', null], ['abc', null], ['', null], ['-5', null], ['1,2,3', null],
])('parseEuroInput(%j) = %s', (text, cents) => {
  expect(parseEuroInput(text)).toBe(cents);
});

test('the payout split: « 282, » is asked as 282,00 €, with no « Montant invalide »', async () => {
  api.previewReconciliationAllocation.mockResolvedValue({ valid: false, errors: [{ code: 'X', field: 'shares', message: 'Contrôle reçu.' }], pairs: [], receipts: [], leftover: [] });
  const proposal = {
    id: 'p', bank: { transactionId: 'p', amountCents: 70000, dateLabel: '15/10' },
    pairs: [{ transactionId: 'p', reservationId: 7, ledgerKey: 'balance', amountCents: 41800 }, { transactionId: 'p', reservationId: 8, ledgerKey: 'balance', amountCents: 25100 }],
  };
  render(<SplitSharesDialog open onClose={() => {}} onSubmit={() => {}} proposal={proposal} labels={{ '7|balance': 'Séjour 7', '8|balance': 'Séjour 8' }} />);
  await screen.findByText('Contrôle reçu.');
  fireEvent.change(screen.getByLabelText('Séjour 8 (€)'), { target: { value: '282,' } });
  expect(screen.queryByText(/Montant invalide/)).toBeNull();
  await waitFor(() => expect(api.previewReconciliationAllocation).toHaveBeenLastCalledWith(expect.objectContaining({
    pairs: [expect.objectContaining({ amountCents: 41800 }), expect.objectContaining({ amountCents: 28200 })],
  })));
});
