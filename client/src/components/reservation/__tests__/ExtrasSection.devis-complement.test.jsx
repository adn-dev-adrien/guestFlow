import React from 'react';
import { render, screen } from '@testing-library/react';

import { ReservationFormProvider } from '../ReservationFormContext';
import ExtrasSection from '../ExtrasSection';
import { makeMockContext } from '../mockReservationForm';

// specs/devis-extras-parity-and-price-lock.md §3 rule 17.
// A quote shows the guest ONE total, not a payment plan: on a devis every extra starts inside the
// acompte/solde split, even on a non-direct platform where a reservation would default the line into
// the Complément (specs/force-extras-complement-on-platform.md §3 rule 1). The toggle stays available
// — an explicit ON is the operator's call and is carried into the reservation at conversion (rule 18).

function renderExtras({ platform, isDevisMode, lineOverrides = {} }) {
  const ctx = makeMockContext({
    isDevisMode,
    propertyOptions: [{ id: 10, title: 'Petit-déjeuner', price: 10, priceType: 'per_person' }],
    displayableResources: [{ id: 20, name: 'Vélo', price: 5, priceType: 'per_stay', available: 3 }],
    form: {
      platform,
      selectedOptions: [{ optionId: 10, quantity: 2, totalPrice: 20, ...lineOverrides }],
      customOptions: [{ customKey: 'custom_1', description: 'Frais ménage', amount: 30, offered: false }],
      selectedResources: [{ resourceId: 20, quantity: 1, totalPrice: 5 }],
    },
  });
  ctx.setOptionInComplement = () => {};
  ctx.setResourceInComplement = () => {};
  ctx.setAutoOptionInComplement = () => {};
  render(
    <ReservationFormProvider value={ctx}>
      <ExtrasSection />
    </ReservationFormProvider>
  );
  return ctx;
}

const complementSwitches = () => screen.getAllByLabelText('Forcer en complément');

test('devis on a platform: no extra is pre-routed to the Complément', () => {
  renderExtras({ platform: 'Airbnb', isDevisMode: true });

  const switches = complementSwitches();
  // One per line kind: catalogue option, custom option, resource.
  expect(switches).toHaveLength(3);
  switches.forEach((input) => expect(input).not.toBeChecked());
});

test('reservation on the same platform: the historic default still applies', () => {
  renderExtras({ platform: 'Airbnb', isDevisMode: false });

  complementSwitches().forEach((input) => expect(input).toBeChecked());
});

test('devis: an explicit « Compl. » on a line still reads ON', () => {
  renderExtras({ platform: 'Airbnb', isDevisMode: true, lineOverrides: { inComplement: true } });

  // The catalogue option is the first Switch rendered.
  expect(complementSwitches()[0]).toBeChecked();
});

test('devis: the platform caption is not shown — it describes a reservation-only default', () => {
  renderExtras({ platform: 'Airbnb', isDevisMode: true });

  expect(screen.queryByText(/paiement complémentaire par défaut/i)).toBeNull();
});
