// specs/reservation-payment-ledger.md rule 68 (D20) — a row whose action the server sends closed (`disabled` + `reason`) draws
// its button disabled with the reason as a caption under it, and a click does nothing. Same rendering at every width.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import LedgerList from '../LedgerList';
import { formatCurrency } from '../../utils/formatters';

const NONE = { editable: false, mode: 'none', min: null, max: null, reason: null };
const row = (action) => ({
  key: 'endOfStayComplement', label: 'Complément de fin de séjour', amount: 30, state: 'due', tone: 'due',
  stateLabel: 'À percevoir au départ', action, amountEdit: NONE,
});

function renderRow(action) {
  const onAction = vi.fn();
  render(<LedgerList rows={[row(action)]} formatAmount={formatCurrency} onAction={onAction} />);
  return onAction;
}

test('rule 68 — before the check-out the mark is closed, its caption under it, a click does nothing', () => {
  const onAction = renderRow({ kind: 'mark', label: 'Marquer perçu', disabled: true, reason: 'Après le départ.' });
  const button = screen.getByRole('button', { name: 'Marquer perçu : Complément de fin de séjour' });
  expect(button).toBeDisabled();
  expect(screen.getByText('Après le départ.')).toBeInTheDocument();
  expect(button).toHaveAttribute('aria-describedby', 'ledger-reason-endOfStayComplement');
  fireEvent.click(button);
  expect(onAction).not.toHaveBeenCalled();
});

test('rule 68 — after the check-out the same row is an ordinary mark, no caption', () => {
  const onAction = renderRow({ kind: 'mark', label: 'Marquer perçu' });
  const button = screen.getByRole('button', { name: 'Marquer perçu : Complément de fin de séjour' });
  expect(button).toBeEnabled();
  expect(screen.queryByText('Après le départ.')).toBeNull();
  fireEvent.click(button);
  expect(onAction).toHaveBeenCalledTimes(1);
});
