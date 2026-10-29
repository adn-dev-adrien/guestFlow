import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RefundDialog from '../RefundDialog';

// specs/reservation-refunds.md rule 44 — « + Nouveau remboursement » warns while a trop-perçu is open, and
// offers to refund it instead; a dialog already opened on the trop-perçu does not warn.

const LINES = [
  { key: 'accommodation', label: 'Hébergement', bucket: 'accommodation', quantity: null, unitPrice: null, billedTtc: 380, refundedTtc: 0, refundableTtc: 380, vatRate: 10 },
];

test('rule 44 — an open trop-perçu is announced, with an action that refunds it instead', async () => {
  const user = userEvent.setup();
  const onUse = vi.fn();
  render(<RefundDialog open onClose={vi.fn()} refundableLines={LINES} collectedTtc={480} openOverpaymentTtc={176.3} onUseOverpayment={onUse} onSubmit={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent(/Un trop-perçu de 176,30\s€ est ouvert\./);
  await user.click(screen.getByRole('button', { name: 'Rembourser le trop-perçu' }));
  expect(onUse).toHaveBeenCalledTimes(1);
});

test('rule 44 — no warning without an open trop-perçu, nor when the dialog is opened on it', () => {
  const { rerender } = render(<RefundDialog open onClose={vi.fn()} refundableLines={LINES} collectedTtc={480} onUseOverpayment={vi.fn()} onSubmit={vi.fn()} />);
  expect(screen.queryByText(/est ouvert/)).not.toBeInTheDocument();
  rerender(<RefundDialog open onClose={vi.fn()} refundableLines={LINES} collectedTtc={480} overpaymentTtc={176.3} openOverpaymentTtc={176.3} onUseOverpayment={vi.fn()} onSubmit={vi.fn()} />);
  expect(screen.queryByText(/est ouvert/)).not.toBeInTheDocument();
});
