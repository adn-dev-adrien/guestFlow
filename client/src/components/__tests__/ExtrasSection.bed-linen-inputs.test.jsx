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
  bedLinenForcedOptionIds = new Set(),
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
    bedLinenForcedOptionIds,
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

test('bed-linen option enabled → lits doubles/simples + "Suggérer les lits" rendered inside the option card (NOT lits bébé)', () => {
  renderWith(buildContext({
    selectedOptions: [{ optionId: 1, quantity: 1 }],
    firstEnabledBedLinenOptionId: 1,
  }));
  expect(screen.getByLabelText(/Lits doubles/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/Lits simples/i)).toBeInTheDocument();
  // specs/bed-config-in-linen-card.md §10 follow-up #6 — "Lits bébé" moved OUT of the linen card
  // into the Voyageurs card (shown whenever babies > 0). It must NOT be here anymore.
  expect(screen.queryByLabelText(/Lits bébé/i)).not.toBeInTheDocument();
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

test('CREATE mode — bed-linen option forced by property default → Switch checked + disabled + bed inputs + "Inclus" caption', () => {
  // specs/reservation-option-immutability.md rule 4 — ReservationPage passes a populated
  // bedLinenForcedOptionIds ONLY when creating. The new reservation has no explicit entry in
  // `selectedOptions`, but the property declares the option a default: the Switch shows ON +
  // disabled and the bed-inputs sub-block surfaces because the contract treats it as enabled.
  renderWith(buildContext({
    selectedOptions: [], // no explicit entry
    firstEnabledBedLinenOptionId: 1, // computed by the page from the forced set
    bedLinenForcedOptionIds: new Set([1]),
  }));
  // Switch is checked + disabled.
  const switches = screen.getAllByRole('switch');
  expect(switches[0]).toBeChecked();
  expect(switches[0]).toBeDisabled();
  // Bed inputs are rendered.
  expect(screen.getByLabelText(/Lits doubles/i)).toBeInTheDocument();
  // Caption surfaces the "forced by property" affordance.
  expect(screen.getByText(/^Inclus$/i)).toBeInTheDocument();
});

test('EDIT mode (empty forced set) — a property-default option the reservation lacks renders as a normal OFF toggle, no "Inclus"', () => {
  // specs/reservation-option-immutability.md rule 4 — in edit mode ReservationPage passes an EMPTY
  // bedLinenForcedOptionIds, so an existing reservation is frozen: a property default it doesn't
  // already carry shows as a normal, toggleable Switch (OFF, enabled), never forced "Inclus", and
  // no bed inputs surface. The operator can still add it manually.
  const setOptionEnabled = vi.fn();
  renderWith(buildContext({
    selectedOptions: [],                 // reservation does NOT carry the option
    firstEnabledBedLinenOptionId: null,
    bedLinenForcedOptionIds: new Set(),  // edit mode → nothing forced
    setOptionEnabled,
  }));
  const sw = screen.getAllByRole('switch')[0];
  expect(sw).not.toBeChecked();
  expect(sw).not.toBeDisabled();
  expect(screen.queryByText(/^Inclus$/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Lits doubles/i)).not.toBeInTheDocument();
  fireEvent.click(sw);
  expect(setOptionEnabled).toHaveBeenCalledWith(1, true);
});

test('a non-bed-linen option in the same catalog stays toggleable when the bed-linen option is forced', () => {
  // The forcing applies ONLY to bed-linen-flagged options. A regular option (e.g. "Départ
  // tardif") on the same property must keep its normal Switch behaviour. Without scoping
  // the forcing to bed-linen-flagged ids, ALL property defaults would silently lock — a
  // regression we pin against.
  const setOptionEnabled = vi.fn();
  renderWith(buildContext({
    propertyOptions: [BED_LINEN_OPT, REGULAR_OPT],
    selectedOptions: [],
    firstEnabledBedLinenOptionId: 1,
    bedLinenForcedOptionIds: new Set([1]), // ONLY the bed-linen option (id=1) is forced
    setOptionEnabled,
  }));
  // We want to assert the REGULAR_OPT's activation Switch is not disabled. The forced
  // bed-linen card renders the activation Switch + a complement-routing Switch (since the
  // option is shown as enabled), so the regular option's activation Switch is NOT at index
  // 1. Locate it by walking the DOM in reverse: it's the last activation switch (one per
  // option card), and the regular option card has exactly one switch (it's not enabled).
  const allSwitches = screen.getAllByRole('switch');
  const regularSwitch = allSwitches[allSwitches.length - 1];
  expect(regularSwitch).not.toBeDisabled();
  expect(regularSwitch).not.toBeChecked();
  // Confirm the bed-linen Switch is still disabled by checking the FIRST switch is the
  // forced one.
  expect(allSwitches[0]).toBeDisabled();
  expect(allSwitches[0]).toBeChecked();
});

test('bed-linen explicitly in selectedOptions AND in bedLinenForcedOptionIds → still Switch-disabled (no double-toggle confusion)', () => {
  // After a save round-trip on a new reservation, the option lives in both signals:
  // (a) form.selectedOptions (the server persisted it via auto-merge), and (b) the forced
  // set (the property still declares it as a default). The Switch should stay disabled —
  // the property contract overrides any operator state.
  renderWith(buildContext({
    selectedOptions: [{ optionId: 1, quantity: 1 }],
    firstEnabledBedLinenOptionId: 1,
    bedLinenForcedOptionIds: new Set([1]),
  }));
  const sw = screen.getAllByRole('switch')[0];
  expect(sw).toBeChecked();
  expect(sw).toBeDisabled();
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
