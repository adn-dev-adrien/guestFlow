// specs/pricing/pricing-components.md rule 112 (loop t9 UI9-2) — the cash-part announcement describes the lines the dialog opened with: typing
// another amount drops it (« Reste 30,00 € » would be false once 60 € leave the caisse interne), putting the amount back restores it.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RefundDialog from '../RefundDialog';

vi.mock('../../../api', () => ({ __esModule: true, default: {} }));

const LINES = [{ bucket: 'options', label: 'Prestations complémentaires', amountTtc: 60 }];
const CASH = { amountTtc: 30, restTtc: 30, lines: [{ bucket: 'options', label: 'Prestations complémentaires', amountTtc: 30 }] };

test('rule 112 — another amount on the cash line drops the announcement, the proposed amount brings it back', async () => {
  render(<RefundDialog open onClose={vi.fn()} refundableLines={[]} collectedTtc={360} overpaymentTtc={60} overpaymentLines={LINES} cashPart={CASH} onSubmit={vi.fn()} />);
  expect(screen.getByText(/payés en espèces/)).toBeInTheDocument();
  const amount = screen.getByLabelText('Montant');
  const proposed = amount.value;
  await userEvent.clear(amount);
  await userEvent.type(amount, '60');
  expect(screen.getByRole('radio', { name: /Caisse interne/ })).toBeChecked();
  expect(screen.queryByText(/payés en espèces/)).toBeNull();
  await userEvent.clear(amount);
  await userEvent.type(amount, proposed);
  expect(screen.getByText(/payés en espèces/)).toBeInTheDocument();
});

test('rule 112 — removing the cash line drops the announcement', async () => {
  render(<RefundDialog open onClose={vi.fn()} refundableLines={[]} collectedTtc={360} overpaymentTtc={60} overpaymentLines={LINES} cashPart={CASH} onSubmit={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Retirer la ligne' }));
  expect(screen.queryByText(/payés en espèces/)).toBeNull();
});
