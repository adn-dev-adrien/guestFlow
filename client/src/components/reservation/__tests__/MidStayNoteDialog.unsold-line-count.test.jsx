// specs/non-card-option-served-persons.md rules 32 and 35 (audit R22-C3, C5) — a number typed on an unsold line of
// the note sells that number, on the fiche's bounds; the nights stop at the longest stay, like OptionRow.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import MidStayNoteDialog from '../MidStayNoteDialog';
import { ReservationFormProvider } from '../ReservationFormContext';
import { makeMockContext } from './mockReservationForm';
import { MAX_TYPED_NIGHTS } from '../../../utils/optionTypedCount';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  __esModule: true,
  default: { previewMidStayNote: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));

const PLAIN = { id: 50, title: 'Jus de pomme', price: 1, priceType: 'per_stay', autoEnabled: 0, displayToClient: 1 };
const PER_NIGHT = { id: 51, title: 'Bois', price: 5, priceType: 'per_night', autoEnabled: 0, displayToClient: 1 };
const PER_PERSON = { id: 52, title: 'Repas', price: 8, priceType: 'per_person', autoEnabled: 0, displayToClient: 1 };

function renderDialog(selectedOptions = []) {
  const ctx = makeMockContext({
    editingReservationId: 7,
    quantityPersons: 5,
    quantityNights: 3,
    maxGuestsAllowed: 6,
    propertyOptions: [PLAIN, PER_NIGHT, PER_PERSON],
    pricingQuote: { midStayExtrasLines: [] },
    form: { selectedOptions, customOptions: [], selectedResources: [] },
  });
  render(
    <ReservationFormProvider value={ctx}>
      <MidStayNoteDialog open onClose={vi.fn()} pendingLines={[]} onSettle={vi.fn()} onSellOnly={vi.fn()} />
    </ReservationFormProvider>,
  );
  return ctx;
}

const fieldOf = (title) => within(screen.getByText(title).closest('.MuiBox-root')).getByRole('textbox', { hidden: true });

const type = (title, value) => {
  const input = fieldOf(title);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

test('rule 35 — a plain unsold line sells the typed number, through the quantity setter alone', () => {
  const ctx = renderDialog();
  type('Jus de pomme', '5');
  expect(ctx.setOptionQuantity).toHaveBeenCalledWith(50, 5);
  expect(ctx.setOptionEnabled).not.toHaveBeenCalled();
});

test('rule 35 — an unsold per-night line sells the typed nights, not the stay', () => {
  const ctx = renderDialog();
  type('Bois', '1');
  expect(ctx.setOptionEnabled).toHaveBeenCalledWith(51, true);
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(51, 'nights', 1);
  expect(ctx.setOptionEnabled.mock.invocationCallOrder[0]).toBeLessThan(ctx.setOptionTypedCount.mock.invocationCallOrder[0]);
});

test('rule 35 — an unsold per-person line sells the typed people, not the party', () => {
  const ctx = renderDialog();
  type('Repas', '2');
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(52, 'persons', 2);
});

test('rule 35 — a line already sold takes the count alone, it is not enabled again', () => {
  const ctx = renderDialog([{ optionId: 51, quantity: 1, totalPrice: 15 }]);
  type('Bois', '2');
  expect(ctx.setOptionEnabled).not.toHaveBeenCalled();
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(51, 'nights', 2);
});

test('rule 35 — 0 on an unsold line still sells nothing', () => {
  const ctx = renderDialog();
  type('Bois', '0');
  expect(ctx.setOptionTypedCount).not.toHaveBeenCalled();
  expect(ctx.setOptionEnabled).toHaveBeenCalledWith(51, false);
});

test('rule 32 — typed nights stop at the shared ceiling, with no refusal after the click', () => {
  const ctx = renderDialog([{ optionId: 51, quantity: 1, totalPrice: 15 }]);
  type('Bois', '500');
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(51, 'nights', MAX_TYPED_NIGHTS);
  expect(MAX_TYPED_NIGHTS).toBe(366);
});

test('rule 32 — a stored count above the ceiling stays its own ceiling, as on the fiche', () => {
  const ctx = renderDialog([{ optionId: 51, quantity: 1, totalPrice: 2000, cardNights: 400 }]);
  expect(fieldOf('Bois').value).toBe('400');
  type('Bois', '500');
  expect(ctx.setOptionTypedCount).toHaveBeenCalledWith(51, 'nights', 400);
});
