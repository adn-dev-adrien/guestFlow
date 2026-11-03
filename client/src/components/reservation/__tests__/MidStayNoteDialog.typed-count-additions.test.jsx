// specs/non-card-option-served-persons.md rule 13 (audit R21-S5) — what the note counts as added is the number typed:
// the line's `quantity` stays 1 whatever the operator adds, so it can say nothing.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import MidStayNoteDialog from '../MidStayNoteDialog';
import { ReservationFormProvider } from '../ReservationFormContext';
import { makeMockContext } from './mockReservationForm';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

const PER_PERSON = { id: 40, title: 'Repas', price: 8, priceType: 'per_person', autoEnabled: 0, displayToClient: 1 };

function renderDialog(line) {
  const ctx = makeMockContext({
    editingReservationId: 7,
    quantityPersons: 5,
    quantityNights: 3,
    propertyOptions: [PER_PERSON],
    pricingQuote: { midStayExtrasLines: [] },
    form: { selectedOptions: [line], customOptions: [], selectedResources: [] },
  });
  const element = (selectedOptions) => (
    <ReservationFormProvider value={{ ...ctx, form: { ...ctx.form, selectedOptions } }}>
      <MidStayNoteDialog open onClose={vi.fn()} pendingLines={[]} onSettle={vi.fn()} onSellOnly={vi.fn()} />
    </ReservationFormProvider>
  );
  const view = render(element([line]));
  return (selectedOptions) => view.rerender(element(selectedOptions));
}

const sellOnly = () => screen.queryByRole('button', { name: 'En fin de séjour' });

test('rule 13 — a higher typed count is an addition, though `quantity` never moved', () => {
  const rerenderWith = renderDialog({ optionId: 40, quantity: 1, totalPrice: 24, cardPersons: 3 });
  rerenderWith([{ optionId: 40, quantity: 1, totalPrice: 32, cardPersons: 4 }]);
  expect(sellOnly()).toBeInTheDocument();
});

test('rule 13 — a lower or equal typed count adds nothing', () => {
  const rerenderWith = renderDialog({ optionId: 40, quantity: 1, totalPrice: 24, cardPersons: 3 });
  rerenderWith([{ optionId: 40, quantity: 1, totalPrice: 16, cardPersons: 2 }]);
  expect(sellOnly()).not.toBeInTheDocument();
  rerenderWith([{ optionId: 40, quantity: 1, totalPrice: 24, cardPersons: 3 }]);
  expect(sellOnly()).not.toBeInTheDocument();
});
