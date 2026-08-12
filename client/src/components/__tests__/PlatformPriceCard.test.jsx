import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';

import PlatformPriceCard from '../PlatformPriceCard';
import api from '../../api';

// specs/platform-price-from-commission.md + specs/tariff-recipes/spec.md §3.6 rules 31-34 —
// the « Prix plateformes » grid: one row per channel (Direct first), whole-euro prices per season,
// extra-guest column, editable commission %.

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPlatformPrices: vi.fn(),
    setPlatformCommission: vi.fn().mockResolvedValue({}),
  },
}));

const GRID = {
  platforms: [
    { id: 1, name: 'Direct', commissionPercent: 5, isDirect: true },
    { id: 2, name: 'Airbnb', commissionPercent: 15.5, isDirect: false },
    { id: 3, name: 'Booking', commissionPercent: 15, isDirect: false },
  ],
  seasons: [
    {
      ruleId: 1, label: 'Basse', netPerNight: 160, extraGuestNet: 25, extraGuestPriceUnit: 'per_night',
      byPlatform: { 1: 179, 2: 190, 3: 189 },
      extraGuestByPlatform: { 1: 27, 2: 30, 3: 30 },
    },
    {
      ruleId: 2, label: 'Haute', netPerNight: 225, extraGuestNet: 25, extraGuestPriceUnit: 'per_night',
      byPlatform: { 1: 247, 2: 267, 3: 265 },
      extraGuestByPlatform: { 1: 27, 2: 30, 3: 30 },
    },
  ],
};

beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

test('renders one row per channel, Direct first with its caption, whole-euro prices', async () => {
  api.getPlatformPrices.mockResolvedValue(GRID);
  render(<PlatformPriceCard propertyId={1} />);
  // Await the RENDERED grid, not merely the fetch call: the state update lands a tick later and
  // asserting on the call alone makes the test flaky under a loaded full-suite run.
  await screen.findByText('moteur Lodgify');
  expect(api.getPlatformPrices).toHaveBeenCalledWith(1);
  const rows = screen.getAllByRole('row');
  // header + 3 channel rows; Direct is the first body row
  expect(rows[1]).toHaveTextContent('Direct');
  expect(rows[1]).toHaveTextContent('moteur Lodgify');
  expect(rows[1]).toHaveTextContent('179 €');
  expect(rows[1]).toHaveTextContent('247 €');
  expect(rows[1]).toHaveTextContent('27 €');
  const airbnbRow = rows.find((r) => r.textContent.includes('Airbnb'));
  expect(airbnbRow).toHaveTextContent('190 €');
  expect(airbnbRow).toHaveTextContent('267 €');
  expect(airbnbRow).toHaveTextContent('30 €');
});

test('header shows the seasons with their net target and the per-night extra column label', async () => {
  api.getPlatformPrices.mockResolvedValue(GRID);
  render(<PlatformPriceCard propertyId={1} />);
  await screen.findByText('Basse');
  expect(screen.getByText(/net 160,00 €/)).toBeInTheDocument();
  expect(screen.getByText('Personne supp. / nuit')).toBeInTheDocument();
});

test('only the Direct row present → still the platforms empty-state hint', async () => {
  api.getPlatformPrices.mockResolvedValue({ platforms: [GRID.platforms[0]], seasons: GRID.seasons });
  render(<PlatformPriceCard propertyId={1} />);
  expect(await screen.findByText(/Aucune plateforme/i)).toBeInTheDocument();
});

test('platforms but no seasons → seasons hint', async () => {
  api.getPlatformPrices.mockResolvedValue({ platforms: GRID.platforms, seasons: [] });
  render(<PlatformPriceCard propertyId={1} />);
  expect(await screen.findByText(/Aucune saison tarifaire/i)).toBeInTheDocument();
});

test('editing a commission % PUTs (debounced) then refetches the grid — Direct editable too', async () => {
  vi.useFakeTimers();
  api.getPlatformPrices.mockResolvedValue(GRID);
  render(<PlatformPriceCard propertyId={1} />);
  await act(async () => { await vi.runOnlyPendingTimersAsync(); }); // resolve initial load
  const directPct = screen.getByLabelText('Commission Direct');
  expect(directPct).not.toBeDisabled();
  const airbnbPct = screen.getByLabelText('Commission Airbnb');
  fireEvent.change(airbnbPct, { target: { value: '18' } });
  // debounce window
  await act(async () => { await vi.advanceTimersByTimeAsync(650); });
  expect(api.setPlatformCommission).toHaveBeenCalledWith(2, 18);
  // re-fetch after persist (initial + reload)
  expect(api.getPlatformPrices).toHaveBeenCalledTimes(2);
});

test('a synthetic Direct row (no platforms row yet) renders with its % input disabled', async () => {
  api.getPlatformPrices.mockResolvedValue({
    platforms: [{ id: 'direct', name: 'Direct', commissionPercent: 0, isDirect: true }, GRID.platforms[1]],
    seasons: GRID.seasons,
  });
  render(<PlatformPriceCard propertyId={1} />);
  expect(await screen.findByLabelText('Commission Direct')).toBeDisabled();
});
