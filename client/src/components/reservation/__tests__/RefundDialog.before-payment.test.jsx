// specs/reservation-refunds.md rule 53 (verification R35b, finding 5) — the server refuses a book refund dated before the
// stay's last book payment (400 REFUND_BEFORE_PAYMENT); the dialog shows its message and stays open, nothing closed.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RefundDialog from '../RefundDialog';

const LINES = [
  { key: 'accommodation', label: 'Hébergement', bucket: 'accommodation', quantity: null, unitPrice: null, billedTtc: 380, refundedTtc: 0, refundableTtc: 380, vatRate: 10 },
];

test('rule 53 — the server\'s refusal of a date before the last payment is shown, the dialog stays open', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onSubmit = vi.fn().mockRejectedValue(new Error('Date antérieure au dernier paiement (12/11/2026).'));
  render(<RefundDialog open onClose={onClose} refundableLines={LINES} collectedTtc={480} onSubmit={onSubmit} />);
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
  expect(await screen.findByText('Date antérieure au dernier paiement (12/11/2026).')).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Date du remboursement')).toBeInTheDocument();
});
