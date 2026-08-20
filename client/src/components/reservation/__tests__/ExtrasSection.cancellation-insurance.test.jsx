import React from 'react';
import { render, screen } from '@testing-library/react';

import { ReservationFormProvider } from '../ReservationFormContext';
import ExtrasSection from '../ExtrasSection';
import { makeMockContext } from '../mockReservationForm';

// specs/cancellation-insurance.md §3.1 rule 5bis + §6.2 — the insurance is a yes/no product whatever
// its price type: the server bills it for the whole stay, so the fiche shows no « Qté » to type. The
// per-night rate and its « ×N j. » hint say exactly what will be billed.

const INSURANCE = {
  id: 42, title: 'Assurance annulation', price: 3, priceType: 'per_night', isCancellationInsurance: 1,
};
const CLEANING = { id: 1, title: 'Ménage', price: 80, priceType: 'per_night' };

function renderExtras({ options, selectedOptions = [] }) {
  render(
    <ReservationFormProvider value={makeMockContext({
      propertyOptions: options,
      displayableResources: [],
      form: { selectedOptions, customOptions: [], selectedResources: [] },
    })}>
      <ExtrasSection />
    </ReservationFormProvider>,
  );
}

test('an enabled per-night insurance shows its nightly rate and no quantity field', () => {
  renderExtras({ options: [INSURANCE], selectedOptions: [{ optionId: 42, quantity: 1, totalPrice: 12 }] });

  expect(screen.getByText(/3,00\s*€ par jour • ×4 j\./)).toBeInTheDocument();
  expect(screen.queryByLabelText('Qté')).not.toBeInTheDocument();
});

test('an ordinary per-night option keeps its quantity field', () => {
  renderExtras({ options: [CLEANING], selectedOptions: [{ optionId: 1, quantity: 1, totalPrice: 320 }] });

  expect(screen.getByLabelText('Qté')).toBeInTheDocument();
});

test('the insurance keeps its Compl. toggle and its total — only the quantity goes', () => {
  renderExtras({ options: [INSURANCE], selectedOptions: [{ optionId: 42, quantity: 1, totalPrice: 12 }] });

  expect(screen.getByLabelText('Forcer en complément')).toBeInTheDocument();
  expect(screen.getByText(/Total:\s*12,00\s*€/)).toBeInTheDocument();
});
