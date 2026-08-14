import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReservationFormProvider } from '../ReservationFormContext';
import GuestsBedsSection from '../GuestsBedsSection';
import { makeMockContext } from '../mockReservationForm';

// specs/bed-config-in-linen-card.md §3 rule 1 (2026-06-05) — the bed counters + the
// "Suggérer les lits" button + the bedsCapacityMismatch warning moved out of this card
// and into the "Linge de lit" option card inside ExtrasSection. The pinning for those
// items now lives in:
//   - `components/__tests__/ExtrasSection.bed-linen-inputs.test.js` (placement + auto-zero).
//   - `components/__tests__/GuestsBedsSection.no-beds.test.js` (rename + absence here).
// What stays in THIS file: the still-current responsibilities of the section (guest
// counts + total-capacity warning).

function renderGuests(overrides) {
  const ctx = makeMockContext(overrides);
  render(
    <ReservationFormProvider value={ctx}>
      <GuestsBedsSection />
    </ReservationFormProvider>
  );
  return ctx;
}

test('renders the 4 guest count inputs', () => {
  renderGuests();
  expect(screen.getByLabelText(/Adultes/)).toBeInTheDocument();
  expect(screen.getByLabelText('Enfants (2 à 12 ans)')).toBeInTheDocument();
  expect(screen.getByLabelText('Ados (12 à 18 ans)')).toBeInTheDocument();
  expect(screen.getByLabelText('Bébés (0 à 2 ans)')).toBeInTheDocument();
});

test('editing the adults count calls updateForm', () => {
  const ctx = renderGuests();
  fireEvent.change(screen.getByLabelText(/Adultes/), { target: { value: '4' } });
  expect(ctx.updateForm).toHaveBeenCalledWith({ adults: 4 });
});

// specs/property-capacity-single-total.md §6 — ONE total for everyone over 2, babies apart.
test('shows the capacity of the property next to the title', () => {
  renderGuests({ maxGuestsAllowed: 5, maxBabiesAllowed: 1 });
  expect(screen.getByText('Capacité : 5 voyageurs · 1 bébé')).toBeInTheDocument();
});

test('hides the capacity caption when the property has no configured capacity', () => {
  renderGuests({ maxGuestsAllowed: 0 });
  expect(screen.queryByText(/Capacité :/)).not.toBeInTheDocument();
});

test('shows the over-capacity warning when the context flags it', () => {
  renderGuests({ exceedsGuestsCapacity: true, guestsCount: 10, maxGuestsAllowed: 8 });
  expect(screen.getByText(/10\/8 voyageurs/)).toBeInTheDocument();
});

test('the babies breach has its own line, independent of the guest total', () => {
  renderGuests({ exceedsBabiesCapacity: true, maxBabiesAllowed: 1, form: { adults: 2, children: 0, teens: 0, babies: 2 } });
  expect(screen.getByText(/2\/1 bébés/)).toBeInTheDocument();
  expect(screen.queryByText(/voyageurs\./)).not.toBeInTheDocument();
});
