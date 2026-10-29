// specs/plugins-phase-4-registry.md rule 44 — the fiche draws plugin lines under each option; one that
// throws leaves the fiche, the option and the other plugin's line up.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const Throws = () => { throw new Error('boom'); };
const Healthy = () => <p>ligne saine</p>;
vi.mock('../../plugins/sdk/useSlot', () => ({
  useSlot: (name) => (name === 'reservation.optionLine'
    ? [
      { key: 'bad', pluginId: 'bad', appliesTo: () => true, Component: Throws },
      { key: 'good', pluginId: 'good', appliesTo: () => true, Component: Healthy },
    ]
    : []),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));

import ExtrasSection from '../reservation/ExtrasSection';
import { ReservationFormProvider } from '../reservation/ReservationFormContext';
import RouteErrorBoundary from '../ErrorBoundary';
import { MemoryRouter } from 'react-router';

const OPT = { id: 2, title: 'Départ tardif', description: '', priceType: 'per_stay', price: 20, autoEnabled: 0, countsAsBedLinen: 0 };

const ctx = {
  formSectionCardSx: {},
  lockedSectionSx: {},
  formSectionContentSx: {},
  form: { selectedOptions: [{ optionId: 2, quantity: 1 }], customOptions: [], selectedResources: [], autoOptionsInComplement: [], platform: 'direct', singleBeds: '', doubleBeds: '', babyBeds: '' },
  propertyOptions: [OPT],
  displayableResources: [],
  quantityPersons: 2,
  quantityNights: 2,
  toDisplayedQuantity: (q) => q,
  toBaseQuantity: (q) => q,
  getQuantityMultiplier: () => 1,
  setOptionEnabled: () => {},
  setOptionQuantity: () => {},
  setResourceEnabled: () => {},
  setResourceQuantity: () => {},
  addCustomOption: () => {},
  updateCustomOption: () => {},
  removeCustomOption: () => {},
  isReservationLocked: false,
  setOptionInComplement: () => {},
  setResourceInComplement: () => {},
  setAutoOptionInComplement: () => {},
  firstEnabledBedLinenOptionId: null,
  bedLinenForcedOptionIds: new Set(),
  updateForm: () => {},
  selectedProp: 1,
};

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

test('a throwing plugin option line leaves the fiche and the healthy line up', () => {
  render(
    <MemoryRouter>
      <RouteErrorBoundary>
        <ReservationFormProvider value={ctx}><ExtrasSection /></ReservationFormProvider>
      </RouteErrorBoundary>
    </MemoryRouter>,
  );
  expect(screen.getByText('Départ tardif')).toBeInTheDocument();
  expect(screen.getByText('ligne saine')).toBeInTheDocument();
  expect(screen.queryByText(/Une erreur est survenue/)).toBeNull();
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[plugin:bad]'), expect.any(Error));
});
