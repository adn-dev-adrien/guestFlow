import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import GuestsBedsSection from '../reservation/GuestsBedsSection';
import { ReservationFormProvider } from '../reservation/ReservationFormContext';

// specs/bed-config-in-linen-card.md §10 follow-up #6 (2026-06-08).
// The "Lits bébé" counter lives in the Voyageurs card and must appear whenever babies > 0,
// independent of the bed-linen option — and it must reflect baby-bed AVAILABILITY: when other
// reservations have taken every baby bed for the dates, the input is capped at 0 ("Dispo restante: 0").
// This test pins both so the baby-bed display can never be silently lost again.

function renderWithContext(value) {
  return render(
    <ReservationFormProvider value={value}>
      <GuestsBedsSection />
    </ReservationFormProvider>
  );
}

function ctx(overrides = {}) {
  return {
    formSectionCardSx: {}, lockedSectionSx: {}, formSectionContentSx: {},
    form: { adults: 2, children: 0, teens: 0, babies: 0, babyBeds: '' },
    updateForm: () => {},
    maxAdultsAllowed: 4, maxBabiesAllowed: 2,
    exceedsAdultsCapacity: false, exceedsChildrenCapacity: false,
    exceedsBabiesCapacity: false, exceedsTotalCapacity: false,
    totalGuestsCount: 2, totalGuestsMax: 6,
    maxBabyBedsByRule: 0, remainingBabyBeds: null,
    ...overrides,
  };
}

test('babies > 0 → the Lits bébé field is shown with the remaining availability', () => {
  renderWithContext(ctx({
    form: { adults: 2, children: 0, teens: 0, babies: 1, babyBeds: 0 },
    maxBabyBedsByRule: 2, remainingBabyBeds: 2,
  }));
  expect(screen.getByLabelText(/Lits bébé/i)).toBeInTheDocument();
  expect(screen.getByText(/Dispo restante: 2/)).toBeInTheDocument();
});

test('babies = 0 → no Lits bébé field', () => {
  renderWithContext(ctx());
  expect(screen.queryByLabelText(/Lits bébé/i)).not.toBeInTheDocument();
});

test('all baby beds taken by other reservations → field shown but capped at 0 (Dispo restante: 0)', () => {
  renderWithContext(ctx({
    form: { adults: 2, children: 0, teens: 0, babies: 1, babyBeds: 0 },
    maxBabyBedsByRule: 0, remainingBabyBeds: 0,
  }));
  const input = screen.getByLabelText(/Lits bébé/i);
  expect(input).toBeInTheDocument();
  // QuantityField clamps in JS (no native `max` attr): the ＋ stepper is disabled at the cap.
  expect(screen.getByRole('button', { name: /Augmenter/i })).toBeDisabled();
  expect(screen.getByText(/Dispo restante: 0/)).toBeInTheDocument();
});

test('typing above the available count clamps the value to maxBabyBedsByRule on blur', () => {
  const updateForm = vi.fn();
  renderWithContext(ctx({
    form: { adults: 2, children: 0, teens: 0, babies: 2, babyBeds: 0 },
    maxBabyBedsByRule: 1, remainingBabyBeds: 1, updateForm,
  }));
  const input = screen.getByLabelText(/Lits bébé/i);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '5' } });
  fireEvent.blur(input);
  expect(updateForm).toHaveBeenCalledWith({ babyBeds: 1 }); // clamped to the 1 available
});
