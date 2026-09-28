// specs/plugins-phase-0-foundation.md rules 7 and 20 — without the hourly-resources plugin a per-hour
// resource can no longer be added to a stay, but one already sold stays listed with its price, without
// the sessions picker.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import ExtrasSection from '../ExtrasSection';
import { ReservationFormProvider } from '../ReservationFormContext';
import { makeMockContext } from '../mockReservationForm';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: (id) => id !== 'hourly-resources' }));

const BAIN = {
  id: 2, name: 'Bain nordique', price: 30, priceType: 'per_hour', available: 1,
  showsPlanningCard: 1, isComplex: true, freeMinutes: 0,
  slotDuration: 60, minimumUsageMinutes: 60, openTime: '11:00', closeTime: '22:00',
};
const LIT_BEBE = { id: 3, name: 'Lit bébé', price: 10, priceType: 'per_stay', available: 2 };

function renderWith(selectedResources) {
  const context = makeMockContext({
    displayableResources: [BAIN, LIT_BEBE],
    form: { selectedResources },
  });
  render(
    <ReservationFormProvider value={context}>
      <ExtrasSection />
    </ReservationFormProvider>
  );
}

test('a per-hour resource not on the stay is not offered; a per-stay one is', () => {
  renderWith([]);
  expect(screen.queryByText('Bain nordique')).not.toBeInTheDocument();
  expect(screen.getByText('Lit bébé')).toBeInTheDocument();
});

test('a per-hour resource already sold stays listed, without the sessions picker', () => {
  renderWith([{ resourceId: 2, quantity: 3, totalPrice: 90, sessions: [] }]);
  expect(screen.getByText('Bain nordique')).toBeInTheDocument();
  expect(screen.queryByText('Séances')).not.toBeInTheDocument();
  expect(screen.queryByText('Aucune séance — ajoutez-en une.')).not.toBeInTheDocument();
});
