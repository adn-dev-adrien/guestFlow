// specs/pricing-components.md §3 rule 72 (owner O-3) — « Carte » is a means of refund; it asks for the provider's reference,
// which rides the payload. No other means shows the field.
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RefundDialog from '../RefundDialog';

const LINES = [{ key: 'opt:1', label: 'Linge', bucket: 'options', billedTtc: 40, refundedTtc: 0, refundableTtc: 40, unitPrice: null, vatRate: 10 }];
const open = (onSubmit = vi.fn().mockResolvedValue(undefined)) => {
  render(<RefundDialog open onClose={() => {}} refundableLines={LINES} collectedTtc={100} onSubmit={onSubmit} />);
  return onSubmit;
};

test('rule 72 — the provider reference is asked for a card refund only', async () => {
  const user = userEvent.setup();
  open();
  expect(screen.queryByLabelText('Référence du remboursement')).toBeNull();
  await user.click(screen.getByRole('radio', { name: /Carte/ }));
  expect(screen.getByLabelText('Référence du remboursement')).toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: /Virement/ }));
  expect(screen.queryByLabelText('Référence du remboursement')).toBeNull();
});

test('rule 72 — a card refund carries the trimmed reference; without one the payload has none', async () => {
  const user = userEvent.setup();
  const onSubmit = open();
  await user.click(screen.getByRole('radio', { name: /Carte/ }));
  await user.type(screen.getByLabelText('Référence du remboursement'), '  re_42 ');
  await user.click(screen.getByRole('checkbox', { name: /Linge/ }));
  await user.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ method: 'card', providerRefundRef: 're_42' });
});
