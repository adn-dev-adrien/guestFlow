import React from 'react';
import { render, screen } from '@testing-library/react';

import { ReservationFormProvider } from '../ReservationFormContext';
import ExtrasSection from '../ExtrasSection';
import { makeMockContext } from '../mockReservationForm';

// specs/welcome-pack-auto-options.md §6 — an option that ticked itself must say why. The chip is the
// only visible difference between a pack line and the same option added by hand.

const JUS = { id: 21, title: 'Jus de pomme 1L', price: 5, priceType: 'per_stay' };
const PLANCHE = { id: 20, title: 'Planche S', price: 17, priceType: 'per_stay' };

function renderExtras(selectedOptions) {
  const ctx = makeMockContext({
    propertyOptions: [JUS, PLANCHE],
    propertyOptionGroups: null,
    displayableResources: [],
    form: { selectedOptions, customOptions: [], selectedResources: [] },
  });
  ctx.setOptionInComplement = () => {};
  ctx.setResourceInComplement = () => {};
  ctx.setAutoOptionInComplement = () => {};
  render(
    <ReservationFormProvider value={ctx}>
      <ExtrasSection />
    </ReservationFormProvider>
  );
}

test('a pack line carries the « Pack de bienvenue » chip', () => {
  renderExtras([{ optionId: 21, quantity: 1, welcomePack: true }]);
  expect(screen.getByText('Pack de bienvenue')).toBeInTheDocument();
});

test('the same option added by hand carries no chip', () => {
  renderExtras([{ optionId: 21, quantity: 1 }, { optionId: 20, quantity: 1 }]);
  expect(screen.queryByText('Pack de bienvenue')).not.toBeInTheDocument();
});
