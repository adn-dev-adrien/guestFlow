import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

// specs/tariff-recipes/spec.md §3.2 rule 12 + specs/tariff-events-and-extra-guest-tiers §3.3 rule 17
// — the Dashboard card that surfaces the horizon-task journal AND the event years whose dates are
// still unknown. The second half is the rule this test exists for: it shipped spec-first and the
// review caught the code never reaching the Dashboard.

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTariffRecipeRuns: vi.fn(), dismissTariffRecipeRun: vi.fn().mockResolvedValue({ ok: true }) },
}));

import api from '../../api';
import TariffRecipeRunsAlert from '../TariffRecipeRunsAlert';

beforeEach(() => { vi.clearAllMocks(); });

test('renders nothing when there is neither a run nor a missing event year', async () => {
  api.getTariffRecipeRuns.mockResolvedValue({ runs: [], missingEvents: [] });
  const { container } = render(<TariffRecipeRunsAlert />);
  await waitFor(() => expect(api.getTariffRecipeRuns).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test('a missing event year renders a warning row that opens the tariff page — not dismissible', async () => {
  api.getTariffRecipeRuns.mockResolvedValue({
    runs: [],
    missingEvents: [{
      propertyId: 2, propertyName: 'Aventura Lodge',
      key: 'ardechoise', label: "L'Ardéchoise", year: 2028, sourceUrl: 'https://www.ardechoise.com/',
    }],
  });
  render(<TariffRecipeRunsAlert />);
  expect(await screen.findByText("Aventura Lodge — L'Ardéchoise 2028")).toBeInTheDocument();
  expect(screen.getByText(/Dates pas encore connues/)).toBeInTheDocument();
  // No dismiss button: the row only leaves when the recipe gains the dates.
  expect(screen.queryByLabelText(/Marquer comme lu/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByText("Aventura Lodge — L'Ardéchoise 2028"));
  expect(navigate).toHaveBeenCalledWith('/properties/2/pricing-seasons');
});

test('runs and missing years live in the same card, runs keeping their dismiss', async () => {
  api.getTariffRecipeRuns.mockResolvedValue({
    runs: [{ id: 7, propertyId: 2, propertyName: 'Aventura Lodge', generatedYear: 2028, blocking: 0, note: 'Saisons générées jusqu\'à fin 2028 — à relire.' }],
    missingEvents: [{ propertyId: 2, propertyName: 'Aventura Lodge', key: 'ardechoise', label: "L'Ardéchoise", year: 2028, sourceUrl: null }],
  });
  render(<TariffRecipeRunsAlert />);
  expect(await screen.findByText('Aventura Lodge — 2028 généré')).toBeInTheDocument();
  expect(screen.getByText("Aventura Lodge — L'Ardéchoise 2028")).toBeInTheDocument();
  expect(screen.getByLabelText('Marquer comme lu (Aventura Lodge)')).toBeInTheDocument();
});
