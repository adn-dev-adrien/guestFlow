// specs/plugins-phase-3c-hourly-resources.md rule 18 (decision P14) — without the hourly-resources
// plugin nothing is sold by the hour: the server lists no per-hour resource, and one the stay already
// carries comes back under `frozenResources`, which the fiche adds read-only — its price frozen, its
// controls gone.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

import ExtrasSection from '../ExtrasSection';
import { ReservationFormProvider } from '../ReservationFormContext';
import { makeMockContext } from '../mockReservationForm';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: (id) => id !== 'hourly-resources' }));

const FROZEN_BAIN = {
  id: 2, name: 'Bain nordique', price: 30, priceType: 'per_hour', available: 1,
  showsPlanningCard: 1, isComplex: true, freeMinutes: 0,
  slotDuration: 60, minimumUsageMinutes: 60, openTime: '11:00', closeTime: '22:00',
  readOnly: true, readOnlyReason: 'Lecture seule : plugin Ressources à l’heure inactif',
};
const LIT_BEBE = { id: 3, name: 'Lit bébé', price: 10, priceType: 'per_stay', available: 2 };

function renderWith(displayableResources, selectedResources) {
  const context = makeMockContext({ displayableResources, form: { selectedResources } });
  render(
    <ReservationFormProvider value={context}>
      <ExtrasSection />
    </ReservationFormProvider>
  );
}

test('a sold bath shows its frozen price and the reason, its controls disabled', () => {
  renderWith([FROZEN_BAIN, LIT_BEBE], [{ resourceId: 2, quantity: 3, totalPrice: 90, sessions: [] }]);
  expect(screen.getByText('Prix figé : 90,00 €')).toBeInTheDocument();
  expect(screen.getByText('Lecture seule : plugin Ressources à l’heure inactif')).toBeInTheDocument();
  const card = screen.getByText('Bain nordique').closest('.MuiCard-root');
  expect(within(card).getByRole('switch')).toBeDisabled();
  expect(screen.queryByLabelText(/Heures/i)).not.toBeInTheDocument();
  expect(screen.queryByText('Séances')).not.toBeInTheDocument();
});

test('a per-stay resource is offered as usual', () => {
  renderWith([LIT_BEBE], []);
  expect(screen.getByText('Lit bébé')).toBeInTheDocument();
});
