import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import ExtrasSection from '../ExtrasSection';
import { ReservationFormProvider } from '../ReservationFormContext';

// specs/reservation-quantity-stepper.md §3 rule 7 — REGRESSION PIN.
// Before QuantityField, clearing the option « Qté » committed 0 → setOptionQuantity dropped the
// line → the option silently deselected. Now the field has min 1 and commits on blur, so an empty
// field falls back to 1 and the option stays selected.

const REGULAR_OPT = {
  id: 2,
  title: 'Départ tardif',
  description: '',
  priceType: 'per_stay',
  price: 20,
  autoEnabled: 0,
  countsAsBedLinen: 0,
};

function buildContext(setOptionQuantity) {
  return {
    formSectionCardSx: {},
    lockedSectionSx: {},
    formSectionContentSx: {},
    form: {
      selectedOptions: [{ optionId: 2, quantity: 3, totalPrice: 20 }],
      customOptions: [],
      selectedResources: [],
      autoOptionsInComplement: [],
      platform: 'direct',
      singleBeds: '',
      doubleBeds: '',
      babyBeds: '',
    },
    updateForm: () => {},
    propertyOptions: [REGULAR_OPT],
    displayableResources: [],
    quantityPersons: 2,
    quantityNights: 2,
    toDisplayedQuantity: (q) => q,
    toBaseQuantity: (q) => q,
    getQuantityMultiplier: () => 1,
    setOptionEnabled: () => {},
    setOptionQuantity,
    setResourceEnabled: () => {},
    setResourceQuantity: () => {},
    addCustomOption: () => {},
    updateCustomOption: () => {},
    removeCustomOption: () => {},
    isReservationLocked: false,
    setOptionInComplement: () => {},
    setResourceInComplement: () => {},
    setAutoOptionInComplement: () => {},
    firstEnabledBedLinenOptionId: null,
    bedLinenForcedOptionIds: new Set(),
  };
}

function renderWith(setOptionQuantity) {
  return render(
    <ReservationFormProvider value={buildContext(setOptionQuantity)}>
      <ExtrasSection />
    </ReservationFormProvider>
  );
}

test('clearing the option « Qté » commits 1 (not 0) → the option is NOT deselected', () => {
  const setOptionQuantity = vi.fn();
  renderWith(setOptionQuantity);
  const input = screen.getByRole('textbox'); // the only text input on the card is the Qté field
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.blur(input);
  expect(setOptionQuantity).toHaveBeenCalledWith(2, 1);
  expect(setOptionQuantity).not.toHaveBeenCalledWith(2, 0);
});

test('typing a new quantity commits it on blur', () => {
  const setOptionQuantity = vi.fn();
  renderWith(setOptionQuantity);
  const input = screen.getByRole('textbox');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '5' } });
  expect(setOptionQuantity).not.toHaveBeenCalled(); // draft only, no per-keystroke commit
  fireEvent.blur(input);
  expect(setOptionQuantity).toHaveBeenCalledWith(2, 5);
});
