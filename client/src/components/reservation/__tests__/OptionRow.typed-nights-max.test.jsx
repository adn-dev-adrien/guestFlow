// specs/non-card-option-served-persons.md rule 34 — the nights field of a per-night option stops at 366;
// a stored count above it is shown as it is, and can only come down.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import OptionRow from '../OptionRow';
import { ReservationFormProvider } from '../ReservationFormContext';
import { makeMockContext } from './mockReservationForm';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

const PER_NIGHT = { id: 32, title: 'Bois', price: 5, priceType: 'per_night', autoEnabled: 0 };

function renderRow(line) {
  const ctx = makeMockContext({
    propertyOptions: [PER_NIGHT],
    quantityPersons: 5,
    quantityNights: 3,
    form: { selectedOptions: [{ optionId: 32, quantity: 1, totalPrice: 0, ...line }], customOptions: [], selectedResources: [] },
  });
  render(<ReservationFormProvider value={ctx}><OptionRow opt={PER_NIGHT} /></ReservationFormProvider>);
  return ctx;
}

const type = (value) => {
  const input = screen.getByLabelText('Qté');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

test('rule 34 — a typed number of nights stops at 366', () => {
  const ctx = renderRow({ cardNights: 4 });
  type('1000000');
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(32, 'nights', 366);
});

test('rule 34 — 366 itself goes through', () => {
  const ctx = renderRow({ cardNights: 4 });
  type('366');
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(32, 'nights', 366);
});

test('rule 34 — a stored count above the ceiling is not moved by the field', () => {
  renderRow({ cardNights: 400 });
  expect(screen.getByLabelText('Qté').value).toBe('400');
});

test('rule 34 — a stored count above the ceiling keeps it as its own ceiling', () => {
  const ctx = renderRow({ cardNights: 400 });
  type('500');
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(32, 'nights', 400);
});
