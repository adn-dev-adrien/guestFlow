import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import ExtrasSection from '../ExtrasSection';
import { ReservationFormProvider } from '../ReservationFormContext';
import { makeMockContext } from '../mockReservationForm';

// specs/hourly-resource-quantity-and-sas-scheduling.md §3.1 rule 4 — an hourly-SCHEDULED resource
// (« Bain nordique ») is sold by the hour on the fiche and placed on real slots later, during the
// arrival SAS. Its « Heures » field used to be replaced by an empty spacer, leaving the Switch as the
// only control — and since the engine then dropped a session-less line, enabling the resource added
// nothing at all to the quote. The field is back; the session editor stays available underneath.

const BAIN = {
  id: 2, name: 'Bain nordique', price: 30, priceType: 'per_hour', available: 1,
  showsPlanningCard: 1, isComplex: true, freeMinutes: 0,
  slotDuration: 60, minimumUsageMinutes: 60, openTime: '11:00', closeTime: '22:00',
};

function renderWith(overrides = {}, ctxOverrides = {}) {
  const context = makeMockContext({
    displayableResources: [BAIN],
    form: { selectedResources: [{ resourceId: 2, quantity: 3, totalPrice: 90, sessions: [] }], ...overrides },
    ...ctxOverrides,
  });
  render(
    <ReservationFormProvider value={context}>
      <ExtrasSection />
    </ReservationFormProvider>
  );
  return context;
}

test('an enabled hourly-scheduled resource shows its « Heures » field', () => {
  renderWith();
  const hours = screen.getByLabelText(/Heures/i);
  expect(hours).toBeInTheDocument();
  expect(hours).toHaveValue('3');
});

test('the helper text says the hours are scheduled at check-in', () => {
  renderWith();
  expect(screen.getByText('Heures vendues — planifiées au check-in.')).toBeInTheDocument();
});

test('changing the hours commits the new quantity on blur', () => {
  const setResourceQuantity = vi.fn();
  renderWith({}, { setResourceQuantity });
  const hours = screen.getByLabelText(/Heures/i);
  fireEvent.focus(hours);
  fireEvent.change(hours, { target: { value: '2' } });
  fireEvent.blur(hours);
  expect(setResourceQuantity).toHaveBeenCalledWith(2, 2);
});

test('the session editor is still offered below the hours', () => {
  renderWith();
  expect(screen.getByText('Séances')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Ajouter une séance/i })).toBeInTheDocument();
});

test('a disabled resource shows neither the hours field nor the session editor', () => {
  renderWith({ selectedResources: [] });
  expect(screen.queryByLabelText(/Heures/i)).not.toBeInTheDocument();
  expect(screen.queryByText('Séances')).not.toBeInTheDocument();
});
