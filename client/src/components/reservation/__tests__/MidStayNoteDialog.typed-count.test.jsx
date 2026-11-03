// specs/non-card-option-served-persons.md rule 13 — the note's quantity field is the fiche's: a number of
// people or nights is carried as typed, counts as an addition, and « Annuler » puts it back.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import MidStayNoteDialog from '../MidStayNoteDialog';
import { ReservationFormProvider } from '../ReservationFormContext';
import { makeMockContext } from '../mockReservationForm';

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
  const onClose = vi.fn();
  const view = render(
    <ReservationFormProvider value={ctx}>
      <MidStayNoteDialog open onClose={onClose} pendingLines={[]} onSettle={vi.fn()} onSellOnly={vi.fn()} />
    </ReservationFormProvider>,
  );
  const rerenderWith = (selectedOptions) => view.rerender(
    <ReservationFormProvider value={{ ...ctx, form: { ...ctx.form, selectedOptions } }}>
      <MidStayNoteDialog open onClose={onClose} pendingLines={[]} onSettle={vi.fn()} onSellOnly={vi.fn()} />
    </ReservationFormProvider>,
  );
  return { ctx, onClose, rerenderWith };
}

const field = () => screen.getByDisplayValue(/^\d+$/);

test('rule 13 — shows the people served and carries what is typed, unconverted', () => {
  const { ctx } = renderDialog({ optionId: 40, quantity: 1, totalPrice: 24, cardPersons: 3 });
  expect(field().value).toBe('3');
  fireEvent.focus(field());
  fireEvent.change(field(), { target: { value: '4' } });
  fireEvent.blur(field());
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(40, 'persons', 4);
  expect(ctx.setOptionQuantity).not.toHaveBeenCalled();
});

test('rule 13 — a line nobody typed shows the party', () => {
  renderDialog({ optionId: 40, quantity: 1, totalPrice: 40 });
  expect(field().value).toBe('5');
});

test('rule 13 — « Annuler » puts the typed number back, though `quantity` never moved', () => {
  const { ctx, onClose, rerenderWith } = renderDialog({ optionId: 40, quantity: 1, totalPrice: 24, cardPersons: 3 });
  rerenderWith([{ optionId: 40, quantity: 1, totalPrice: 32, cardPersons: 4 }]);
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(40, 'persons', 3);
  expect(onClose).toHaveBeenCalled();
});
