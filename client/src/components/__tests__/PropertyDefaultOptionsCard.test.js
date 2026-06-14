import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import PropertyDefaultOptionsCard from '../PropertyDefaultOptionsCard';
import api from '../../api';

// specs/property-default-option-applicability.md + the « Inclus » rename (PR #196). The "default
// options" feature is labelled « Options incluses » / « Inclure » and the description states changes
// only apply to new reservations.

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPropertyOptionDefaults: vi.fn().mockResolvedValue([]),
    setPropertyOptionDefault: vi.fn().mockResolvedValue({}),
    unsetPropertyOptionDefault: vi.fn().mockResolvedValue({}),
  },
}));

const LINEN_OPTION = { id: 8, title: 'Linge de lit', countsAsBedLinen: 1, countsAsBathroomLinen: 0 };

beforeEach(() => { vi.clearAllMocks(); });

test('renders the « Options incluses » section + « Inclure » switch (renamed from « par défaut »)', async () => {
  render(<PropertyDefaultOptionsCard propertyId={1} options={[LINEN_OPTION]} />);
  await waitFor(() => expect(api.getPropertyOptionDefaults).toHaveBeenCalledWith(1));
  expect(screen.getByText('Options incluses')).toBeInTheDocument();
  expect(screen.getByText('Inclure')).toBeInTheDocument();
  // The old wording must be gone.
  expect(screen.queryByText('Options ajoutées par défaut')).not.toBeInTheDocument();
  expect(screen.queryByText('Ajouter par défaut')).not.toBeInTheDocument();
});

test('the description states the change only applies to new reservations (future-only guarantee)', async () => {
  render(<PropertyDefaultOptionsCard propertyId={1} options={[LINEN_OPTION]} />);
  await waitFor(() => expect(api.getPropertyOptionDefaults).toHaveBeenCalled());
  expect(screen.getByText(/ne s'appliquent qu'aux nouvelles réservations/i)).toBeInTheDocument();
});

test('toggling « Inclure » ON persists the default (offered = false initially)', async () => {
  render(<PropertyDefaultOptionsCard propertyId={1} options={[LINEN_OPTION]} />);
  await waitFor(() => expect(api.getPropertyOptionDefaults).toHaveBeenCalled());
  // First switch in the row is the « Inclure » toggle.
  fireEvent.click(screen.getAllByRole('switch')[0]);
  await waitFor(() => expect(api.setPropertyOptionDefault).toHaveBeenCalledWith(1, 8, false));
});

// specs/per-property-default-options.md — every applicable option (not just linen) can be a default.

test('lists a NON-linen option applicable to the property (linen-only filter dropped)', async () => {
  const PARKING = { id: 20, title: 'Parking', countsAsBedLinen: 0, countsAsBathroomLinen: 0, propertyIds: [1] };
  render(<PropertyDefaultOptionsCard propertyId={1} options={[PARKING]} />);
  await waitFor(() => expect(api.getPropertyOptionDefaults).toHaveBeenCalledWith(1));
  expect(screen.getByText('Parking')).toBeInTheDocument();
});

test('excludes auto-timed options and options not applicable to the property', async () => {
  const AUTO = { id: 30, title: 'Arrivée anticipée', autoEnabled: 1, propertyIds: [] };
  const OTHER_PROP = { id: 31, title: 'Option logement B', countsAsBedLinen: 0, propertyIds: [2] };
  const GLOBAL = { id: 32, title: 'Option globale', countsAsBedLinen: 0, propertyIds: [] };
  render(<PropertyDefaultOptionsCard propertyId={1} options={[AUTO, OTHER_PROP, GLOBAL]} />);
  await waitFor(() => expect(api.getPropertyOptionDefaults).toHaveBeenCalled());
  expect(screen.queryByText('Arrivée anticipée')).not.toBeInTheDocument(); // auto-timed excluded
  expect(screen.queryByText('Option logement B')).not.toBeInTheDocument(); // applies to prop 2 only
  expect(screen.getByText('Option globale')).toBeInTheDocument();          // global → applicable
});
