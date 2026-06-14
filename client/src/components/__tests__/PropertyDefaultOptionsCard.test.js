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
