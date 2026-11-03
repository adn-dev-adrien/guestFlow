// specs/non-card-option-served-persons.md rules 13, 31, 32, 33 — « Annuler » restores the opening state
// whole, each row keeps its arrival floor and the fiche's ceiling, and « En fin de séjour » waits for an
// actual addition.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import MidStayNoteDialog from '../MidStayNoteDialog';
import { ReservationFormProvider } from '../ReservationFormContext';
import { makeMockContext } from './mockReservationForm';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  __esModule: true,
  default: { previewMidStayNote: vi.fn(async () => ({ items: [], total: 0 })) },
}));

const PER_PERSON = { id: 40, title: 'Repas', price: 8, priceType: 'per_person', autoEnabled: 0, displayToClient: 1 };
const PER_STAY = { id: 41, title: 'Ménage', price: 80, priceType: 'per_stay', autoEnabled: 0, displayToClient: 1 };
const CARD = { id: 42, title: 'Dîner', price: 20, priceType: 'per_person', showsPlanningCard: 1, autoEnabled: 0, displayToClient: 1 };

function setup({ lines, catalogue = [PER_PERSON], arrivalLines = {}, persons = 4, maxGuests = 5 }) {
  const ctx = makeMockContext({
    editingReservationId: 7,
    quantityPersons: persons,
    quantityNights: 3,
    maxGuestsAllowed: maxGuests,
    arrivalLines,
    propertyOptions: catalogue,
    pricingQuote: { midStayExtrasLines: [] },
    form: { selectedOptions: lines, customOptions: [], selectedResources: [] },
  });
  const onClose = vi.fn();
  const dialog = (value, open = true) => (
    <ReservationFormProvider value={value}>
      <MidStayNoteDialog open={open} onClose={onClose} pendingLines={[]} onSettle={vi.fn()} onSellOnly={vi.fn()} />
    </ReservationFormProvider>
  );
  const view = render(dialog(ctx));
  const withLines = (selectedOptions, open = true) => view.rerender(dialog({ ...ctx, form: { ...ctx.form, selectedOptions } }, open));
  return { ctx, onClose, withLines };
}

const type = (input, value) => {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

test('rule 31 — « Annuler » restores the state captured on opening, a removed line included', () => {
  const opening = [{ optionId: 40, quantity: 1, totalPrice: 24, cardPersons: 3, cardOccurrences: [] }];
  const { ctx, onClose, withLines } = setup({ lines: opening });
  withLines([]);
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(ctx.restoreOptionsState).toHaveBeenCalledTimes(1);
  expect(ctx.restoreOptionsState.mock.calls[0][0].selectedOptions).toEqual(opening);
  expect(onClose).toHaveBeenCalled();
});

test('rule 31 — a card line taken off and cancelled comes back with its grid', () => {
  const occurrences = [{ date: 'd1', time: '19:00', checked: true }];
  const opening = [{ optionId: 42, quantity: 1, totalPrice: 20, cardOccurrences: occurrences }];
  const { ctx, withLines } = setup({ lines: opening, catalogue: [CARD] });
  withLines([]);
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(ctx.restoreOptionsState.mock.calls[0][0].selectedOptions[0].cardOccurrences).toEqual(occurrences);
});

test('rule 32 — a typed line sold at arrival cannot go below what was sold', () => {
  const { ctx } = setup({
    lines: [{ optionId: 40, quantity: 1, totalPrice: 24, cardPersons: 3 }],
    arrivalLines: { 'opt:40': { minQuantity: 1, minTypedCount: 3, reason: 'arrival' } },
  });
  const field = screen.getByDisplayValue('3');
  type(field, '0');
  expect(ctx.setOptionEnabled).not.toHaveBeenCalled();
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(40, 'persons', 3);
});

test('rule 32 — a plain line sold at arrival keeps its floor in units', () => {
  const { ctx } = setup({
    lines: [{ optionId: 41, quantity: 3, totalPrice: 240 }],
    catalogue: [PER_STAY],
    arrivalLines: { 'opt:41': { minQuantity: 2, reason: 'arrival' } },
  });
  type(screen.getByDisplayValue('3'), '0');
  expect(ctx.setOptionEnabled).not.toHaveBeenCalled();
  expect(ctx.setOptionQuantity).toHaveBeenCalledWith(41, 2);
});

test('rule 32 — a card line sold at arrival cannot be taken off', () => {
  setup({
    lines: [{ optionId: 42, quantity: 1, totalPrice: 20, cardOccurrences: [] }],
    catalogue: [CARD],
    arrivalLines: { 'opt:42': { minQuantity: 1, reason: 'arrival' } },
  });
  fireEvent.click(screen.getByText('Prestations'));
  expect(screen.getByRole('button', { name: 'Ajouté ✓', hidden: true })).toBeDisabled();
});

test('rule 32 — a line without an arrival floor can still be removed by typing 0', () => {
  const { ctx } = setup({ lines: [{ optionId: 40, quantity: 1, totalPrice: 24, cardPersons: 3 }] });
  type(screen.getByDisplayValue('3'), '0');
  expect(ctx.setOptionEnabled).toHaveBeenCalledWith(40, false);
});

test('rule 32 — people served are capped like on the fiche: the larger of capacity, party and the value held', () => {
  const { ctx } = setup({ lines: [{ optionId: 40, quantity: 1, totalPrice: 8, cardPersons: 1 }], persons: 4, maxGuests: 5 });
  type(screen.getByDisplayValue('1'), '50');
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(40, 'persons', 5);
});

test('rule 33 — opening without touching anything offers no « En fin de séjour »', () => {
  setup({ lines: [{ optionId: 40, quantity: 1, totalPrice: 24, cardPersons: 3 }] });
  expect(screen.queryByRole('button', { name: 'En fin de séjour' })).not.toBeInTheDocument();
});

test('rule 33 — an addition offers it; a second opening compares with its own opening, not the first', () => {
  const opening = [{ optionId: 40, quantity: 1, totalPrice: 24, cardPersons: 3 }];
  const { withLines, ctx } = setup({ lines: opening });
  const raised = [{ optionId: 40, quantity: 1, totalPrice: 32, cardPersons: 4 }];
  withLines(raised);
  expect(screen.getByRole('button', { name: 'En fin de séjour' })).toBeInTheDocument();
  withLines(raised, false);
  ctx.captureOptionsState.mockReturnValue({ selectedOptions: raised });
  withLines(raised, true);
  expect(screen.queryByRole('button', { name: 'En fin de séjour' })).not.toBeInTheDocument();
});
