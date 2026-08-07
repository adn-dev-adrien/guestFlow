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

test('shows the total-capacity warning when the context flags it', () => {
  renderGuests({ exceedsTotalCapacity: true, totalGuestsCount: 10, totalGuestsMax: 8 });
  expect(screen.getByText(/Capacité totale dépassée: 10\/8/)).toBeInTheDocument();
});
