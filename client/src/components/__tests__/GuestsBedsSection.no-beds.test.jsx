import React from 'react';
import { render, screen } from '@testing-library/react';

import GuestsBedsSection from '../reservation/GuestsBedsSection';
import { ReservationFormProvider } from '../reservation/ReservationFormContext';

// specs/bed-config-in-linen-card.md §3 rule 1 + §7.2.
// "Voyageurs et couchages" → "Voyageurs": the bed counters left the card. Pin the rename
// and the absence of any bed `TextField` so a future regression that moves them back here
// breaks the build before review.

function renderWithContext(value) {
  return render(
    <ReservationFormProvider value={value}>
      <GuestsBedsSection />
    </ReservationFormProvider>
  );
}

const baseCtx = {
  formSectionCardSx: {},
  lockedSectionSx: {},
  formSectionContentSx: {},
  form: { adults: 2, children: 0, teens: 0, babies: 0 },
  updateForm: () => {},
  maxGuestsAllowed: 4,
  maxBabiesAllowed: 2,
  exceedsGuestsCapacity: false,
  exceedsBabiesCapacity: false,
  guestsCount: 2,
};

test('card title is "Voyageurs" (not "Voyageurs et couchages")', () => {
  renderWithContext(baseCtx);
  expect(screen.getByText('Voyageurs')).toBeInTheDocument();
  expect(screen.queryByText(/Voyageurs et couchages/i)).not.toBeInTheDocument();
});

test('no bed inputs are rendered (Lits doubles / simples / bébé all gone)', () => {
  renderWithContext(baseCtx);
  expect(screen.queryByLabelText(/Lits doubles/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Lits simples/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Lits bébé/i)).not.toBeInTheDocument();
  // "Suggérer les lits" button also moved out.
  expect(screen.queryByRole('button', { name: /Suggérer les lits/i })).not.toBeInTheDocument();
});
