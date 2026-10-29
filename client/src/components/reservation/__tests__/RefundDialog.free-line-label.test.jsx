import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RefundDialog from '../RefundDialog';

// specs/reservation-refunds.md rule 41 — a free line with an amount but no label is refused in the
// dialog, never dropped silently from the posted lines while still counted in the total.

const LINES = [
  { key: 'accommodation', label: 'Hébergement', bucket: 'accommodation', quantity: null, unitPrice: null, billedTtc: 380, refundedTtc: 0, refundableTtc: 380, vatRate: 10 },
];

test('rule 41 — an amount without a label blocks the save and says why', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<RefundDialog open onClose={vi.fn()} refundableLines={LINES} collectedTtc={480} onSubmit={onSubmit} />);

  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: '+ Ajouter une ligne libre' }));
  const amounts = screen.getAllByLabelText('Montant');
  await user.type(amounts[amounts.length - 1], '2');

  expect(screen.getByRole('alert')).toHaveTextContent('Libellé manquant.');
  expect(screen.getByRole('button', { name: 'Enregistrer le remboursement' })).toBeDisabled();

  await user.type(screen.getByLabelText('Libellé'), 'Geste commercial');
  expect(screen.queryByText('Libellé manquant.')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    lines: expect.arrayContaining([expect.objectContaining({ label: 'Geste commercial', amountTtc: 2 })]),
  }));
});

test('rule 41 — a blank free line the operator added and left empty does not block', async () => {
  const user = userEvent.setup();
  render(<RefundDialog open onClose={vi.fn()} refundableLines={LINES} collectedTtc={480} onSubmit={vi.fn()} />);
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: '+ Ajouter une ligne libre' }));
  expect(screen.getByRole('button', { name: 'Enregistrer le remboursement' })).toBeEnabled();
});

test('rule 42 — a refund opened on the trop-perçu says so to the server', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<RefundDialog open onClose={vi.fn()} refundableLines={LINES} collectedTtc={480} overpaymentTtc={28} onSubmit={onSubmit} />);
  await user.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ fromOverpayment: true, overpaymentTtc: 28 }));
});

test('rule 42 — a refund opened from « Nouveau remboursement » carries no trop-perçu flag', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<RefundDialog open onClose={vi.fn()} refundableLines={LINES} collectedTtc={480} onSubmit={onSubmit} />);
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
  expect(onSubmit.mock.calls[0][0].fromOverpayment).toBeUndefined();
});
