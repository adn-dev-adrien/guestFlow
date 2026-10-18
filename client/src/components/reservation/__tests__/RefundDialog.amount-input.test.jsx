import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RefundDialog from '../RefundDialog';

// specs/reservation-refunds.md rule 37 — the amount is typed as text, never back-computes a
// fractional quantity, and a refusal says why next to the button (final review 2026-10-18, UI #1:
// 45 typed on « Linge de lit » 28 € set the stepper to 6.43 and the button greyed without a reason).

const LINES = [
  { key: 'opt:3', label: 'Linge de lit', bucket: 'options', quantity: 4, unitPrice: 7, billedTtc: 28, refundedTtc: 0, refundableTtc: 28, vatRate: 10 },
];

function setup() {
  const onSubmit = vi.fn().mockResolvedValue();
  render(<RefundDialog open onClose={vi.fn()} refundableLines={LINES} collectedTtc={500} onSubmit={onSubmit} />);
  return { onSubmit, user: userEvent.setup() };
}

async function typeAmount(user, text) {
  const field = screen.getByLabelText('Montant');
  await user.clear(field);
  await user.type(field, text);
}

test('rule 37 — the ceiling shows before typing', async () => {
  const { user } = setup();
  await user.click(screen.getByRole('checkbox'));
  expect(screen.getByText('Max 28,00 €')).toBeInTheDocument();
  expect(screen.getByLabelText('Montant')).toHaveAttribute('inputmode', 'decimal');
});

test('rule 37 — 45 € on a 28 € line: no 6.43, the refusal next to the button', async () => {
  const { user } = setup();
  await user.click(screen.getByRole('checkbox'));
  await typeAmount(user, '45');
  expect(screen.queryByDisplayValue(/6[.,]43/)).not.toBeInTheDocument();
  expect(screen.getByText('Montant libre')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Linge de lit : dépasse le remboursable de 17,00 €.');
  expect(screen.getByRole('button', { name: 'Enregistrer le remboursement' })).toBeDisabled();
});

test('rule 37 — « 12,5 » is accepted and sent as 12,50 € without a quantity', async () => {
  const { user, onSubmit } = setup();
  await user.click(screen.getByRole('checkbox'));
  await typeAmount(user, '12,5');
  expect(screen.getByText('− 12,50 €')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
  expect(onSubmit.mock.calls[0][0].lines).toEqual([{ key: 'opt:3', amountTtc: 12.5, quantity: undefined }]);
});

test('rule 37 — a whole number of units moves the stepper to that count', async () => {
  const { user, onSubmit } = setup();
  await user.click(screen.getByRole('checkbox'));
  await typeAmount(user, '14');
  expect(screen.queryByText('Montant libre')).not.toBeInTheDocument();
  expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
  expect(onSubmit.mock.calls[0][0].lines).toEqual([{ key: 'opt:3', amountTtc: 14, quantity: 2 }]);
});

test('rule 37 — an unreadable amount blocks the save and says so', async () => {
  const { user } = setup();
  await user.click(screen.getByRole('checkbox'));
  await typeAmount(user, 'abc');
  expect(screen.getByRole('alert')).toHaveTextContent('Montant illisible.');
  expect(screen.getByRole('button', { name: 'Enregistrer le remboursement' })).toBeDisabled();
});
