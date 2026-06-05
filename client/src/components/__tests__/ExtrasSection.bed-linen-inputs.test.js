import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import ExtrasSection from '../reservation/ExtrasSection';
import { ReservationFormProvider } from '../reservation/ReservationFormContext';

// specs/bed-config-in-linen-card.md §3 rules 2 + 3 + 10 + §7.2.
// Pin the new placement of the bed counters INSIDE the "Linge de lit" option card and the
// auto-zero on Switch OFF behaviour.

const BED_LINEN_OPT = {
  id: 1,
  title: 'Linge de lit',
  description: '',
  priceType: 'per_stay',
  price: 25,
  autoEnabled: 0,
  countsAsBedLinen: 1,
};
const REGULAR_OPT = {
  id: 2,
  title: 'Départ tardif',
  description: '',
  priceType: 'per_stay',
  price: 20,
  autoEnabled: 0,
  countsAsBedLinen: 0,
};
const SECOND_BED_LINEN_OPT = {
  id: 3,
  title: 'Linge de lit premium',
  description: '',
  priceType: 'per_stay',
  price: 40,
  autoEnabled: 0,
  countsAsBedLinen: 1,
};

function buildContext({
  propertyOptions = [BED_LINEN_OPT],
  selectedOptions = [],
  firstEnabledBedLinenOptionId = null,
  setOptionEnabled = () => {},
  updateForm = () => {},
} = {}) {
  return {
    formSectionCardSx: {},
    lockedSectionSx: {},
    formSectionContentSx: {},
    form: {
      selectedOptions,
      customOptions: [],
      selectedResources: [],
      autoOptionsInComplement: [],
      platform: 'direct',
      // Bed-counter fields read by `BedLinenInputsBlock`.
      singleBeds: '',
      doubleBeds: '',
      babyBeds: '',
    },
    propertyOptions,
    displayableResources: [],
    quantityPersons: 2,
    quantityNights: 2,
    toDisplayedQuantity: (q) => q,
    toBaseQuantity: (q) => q,
    getQuantityMultiplier: () => 1,
    setOptionEnabled,
    setOptionQuantity: () => {},
    setResourceEnabled: () => {},
    setResourceQuantity: () => {},
    addCustomOption: () => {},
    updateCustomOption: () => {},
    removeCustomOption: () => {},
    isReservationLocked: false,
    setOptionInComplement: () => {},
    setResourceInComplement: () => {},
    setAutoOptionInComplement: () => {},
    firstEnabledBedLinenOptionId,
    // BedLinenInputsBlock dependencies
    updateForm,
    maxSingleBeds: 6,
    maxDoubleBeds: 4,
    exceedsSingleBedsLimit: false,
    exceedsDoubleBedsLimit: false,
    bedsCapacityMismatch: false,
    reservationBedCapacity: 0,
    requiredRegularBeds: 0,
    maxBabyBedsByRule: 2,
    remainingBabyBeds: 2,
    handleSuggestBeds: () => {},
    selectedProp: 1,
  };
}

function renderWith(ctx) {
  return render(
    <ReservationFormProvider value={ctx}>
      <ExtrasSection />
    </ReservationFormProvider>
  );
}

test('bed-linen option enabled → 3 bed inputs + "Suggérer les lits" button rendered inside the option card', () => {
  renderWith(buildContext({
    selectedOptions: [{ optionId: 1, quantity: 1 }],
    firstEnabledBedLinenOptionId: 1,
  }));
  expect(screen.getByLabelText(/Lits doubles/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/Lits simples/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/Lits bébé/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Suggérer les lits/i })).toBeInTheDocument();
  // The sub-block header is present.
  expect(screen.getByText(/Configuration des lits/i)).toBeInTheDocument();
});

test('bed-linen option disabled → no bed inputs anywhere in the card', () => {
  renderWith(buildContext({
    selectedOptions: [], // option not selected → not enabled
    firstEnabledBedLinenOptionId: null,
  }));
  expect(screen.queryByLabelText(/Lits doubles/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Lits simples/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Lits bébé/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Configuration des lits/i)).not.toBeInTheDocument();
});

test('Switch ON → OFF calls setOptionEnabled(optId, false) for the bed-linen option', () => {
  const setOptionEnabled = vi.fn();
  renderWith(buildContext({
    selectedOptions: [{ optionId: 1, quantity: 1 }],
    firstEnabledBedLinenOptionId: 1,
    setOptionEnabled,
  }));
  // The activation Switch lives at the top of the option card. MUI's `<Switch>` exposes
  // role="switch" (since v5). The complement-routing Switch shares the role; the first
  // matching element in DOM order is the activation Switch (no `aria-label` on it, while
  // the small Switch below has aria-label "Forcer en complément").
  const switches = screen.getAllByRole('switch');
  fireEvent.click(switches[0]);
  expect(setOptionEnabled).toHaveBeenCalledWith(1, false);
});

test('multiple bed-linen-flagged options both enabled → bed inputs render exactly ONCE under the first', () => {
  renderWith(buildContext({
    propertyOptions: [BED_LINEN_OPT, REGULAR_OPT, SECOND_BED_LINEN_OPT],
    selectedOptions: [
      { optionId: 1, quantity: 1 },
      { optionId: 3, quantity: 1 },
    ],
    firstEnabledBedLinenOptionId: 1, // only opt 1 hosts the sub-block
  }));
  // Exactly one "Lits doubles" label across the whole card.
  expect(screen.getAllByLabelText(/Lits doubles/i)).toHaveLength(1);
  // The "Configuration des lits" header appears once.
  expect(screen.getAllByText(/Configuration des lits/i)).toHaveLength(1);
});
