import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { ReservationFormProvider } from '../ReservationFormContext';
import ExtrasSection from '../ExtrasSection';
import { makeMockContext } from '../mockReservationForm';

// specs/neat-cancellation-insurance-subscription.md §3.3 rules 13-16 — the Neat chip + actions on
// the insurance card. The block is server-shaped: the card renders it and derives nothing.

const INSURANCE = {
  id: 42, title: 'Assurance annulation', price: 3, priceType: 'per_night', isCancellationInsurance: 1,
};
const CLEANING = { id: 1, title: 'Ménage', price: 80, priceType: 'per_night' };

function renderExtras({ neat = null, selectedOptions = [{ optionId: 42, quantity: 1, totalPrice: 23 }], overrides = {} } = {}) {
  const context = makeMockContext({
    propertyOptions: [INSURANCE, CLEANING],
    displayableResources: [],
    form: { selectedOptions, customOptions: [], selectedResources: [] },
    neat,
    ...overrides,
  });
  render(
    <ReservationFormProvider value={context}>
      <ExtrasSection />
    </ReservationFormProvider>,
  );
  return context;
}

test('no Neat block → no chip (feature off, or nothing to show yet)', () => {
  renderExtras({ neat: null });
  expect(screen.queryByText(/Neat/)).not.toBeInTheDocument();
});

test('active → « Neat : souscrite » + the premium derivation + « Résilier chez Neat »', () => {
  const context = renderExtras({
    neat: { status: 'active', neatId: 'sub-1', premiumAmount: 17.5, billedAmount: 23, marginPercent: 30, lastError: null },
  });
  expect(screen.getByText('Neat : souscrite')).toBeInTheDocument();
  expect(screen.getByText(/Prime Neat 17,50\s*€ • marge \+30 % • arrondi €↑/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Résilier chez Neat' }));
  expect(context.voidNeatSubscription).toHaveBeenCalledTimes(1);
});

test('pending → « Neat : en attente », no action button', () => {
  renderExtras({ neat: { status: 'pending', premiumAmount: null, lastError: null } });
  expect(screen.getByText('Neat : en attente')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Réessayer|Résilier/ })).not.toBeInTheDocument();
});

test('failed → « Neat : en échec » + « Réessayer maintenant » wired to the context action', () => {
  const context = renderExtras({
    neat: { status: 'failed', premiumAmount: null, lastError: 'Neat indisponible', errorKind: 'unavailable' },
  });
  expect(screen.getByText('Neat : en échec')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer maintenant' }));
  expect(context.retryNeatSubscription).toHaveBeenCalledTimes(1);
});

test('line removed while active → warning chip + guidance + « Résilier chez Neat » still offered', () => {
  renderExtras({
    neat: { status: 'line_removed_active', neatId: 'sub-1', premiumAmount: 17.5, marginPercent: 30 },
    selectedOptions: [], // the insurance line is gone; the card renders unticked
  });
  expect(screen.getByText('Ligne retirée — souscription active')).toBeInTheDocument();
  expect(screen.getByText(/toujours active/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Résilier chez Neat' })).toBeInTheDocument();
});

test('the chip never leaks onto an ordinary option card', () => {
  renderExtras({
    neat: { status: 'active', premiumAmount: 17.5, marginPercent: 30 },
    selectedOptions: [{ optionId: 1, quantity: 1, totalPrice: 320 }],
  });
  const cleaningCard = screen.getByText('Ménage').closest('.MuiCard-root');
  expect(cleaningCard).not.toBeNull();
  expect(cleaningCard.textContent).not.toMatch(/Neat/);
});
