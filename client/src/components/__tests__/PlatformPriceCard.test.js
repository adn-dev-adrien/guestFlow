import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';

import PlatformPriceCard from '../PlatformPriceCard';
import api from '../../api';

// specs/platform-price-from-commission.md — the « Prix plateformes » grid + commission % editor.

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPlatformPrices: vi.fn(),
    setPlatformCommission: vi.fn().mockResolvedValue({}),
  },
}));

const GRID = {
  platforms: [
    { id: 2, name: 'Airbnb', commissionPercent: 20 },
    { id: 3, name: 'Booking', commissionPercent: 0 },
  ],
  seasons: [
    { ruleId: 1, label: 'Basse', netPerNight: 100, byPlatform: { 2: 125, 3: 100 } },
    { ruleId: 2, label: 'Haute', netPerNight: 200, byPlatform: { 2: 250, 3: 200 } },
  ],
};

beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

test('renders the grid: gross prices per season per platform (net when 0%)', async () => {
  api.getPlatformPrices.mockResolvedValue(GRID);
  render(<PlatformPriceCard propertyId={1} />);
  await waitFor(() => expect(api.getPlatformPrices).toHaveBeenCalledWith(1));
  expect(screen.getByText('Airbnb')).toBeInTheDocument();
  expect(screen.getByText('Booking')).toBeInTheDocument();
  // Basse: Airbnb 20% → 125 ; Booking 0% → 100 (= net).
  expect(screen.getByText('125,00 €')).toBeInTheDocument();
  expect(screen.getByText('250,00 €')).toBeInTheDocument();
  // net column + Booking 0% both show 100/200 €.
  expect(screen.getAllByText('100,00 €').length).toBeGreaterThanOrEqual(2);
});

test('empty platforms → empty-state hint (no table)', async () => {
  api.getPlatformPrices.mockResolvedValue({ platforms: [], seasons: [] });
  render(<PlatformPriceCard propertyId={1} />);
  await waitFor(() => expect(api.getPlatformPrices).toHaveBeenCalled());
  expect(screen.getByText(/Aucune plateforme/i)).toBeInTheDocument();
});

test('platforms but no seasons → seasons hint', async () => {
  api.getPlatformPrices.mockResolvedValue({ platforms: GRID.platforms, seasons: [] });
  render(<PlatformPriceCard propertyId={1} />);
  await waitFor(() => expect(api.getPlatformPrices).toHaveBeenCalled());
  expect(screen.getByText(/Aucune saison tarifaire/i)).toBeInTheDocument();
});

test('editing a commission % PUTs (debounced) then refetches the grid', async () => {
  vi.useFakeTimers();
  api.getPlatformPrices.mockResolvedValue(GRID);
  render(<PlatformPriceCard propertyId={1} />);
  await act(async () => { await vi.runOnlyPendingTimersAsync(); }); // resolve initial load
  const airbnbPct = screen.getByLabelText('Commission Airbnb');
  fireEvent.change(airbnbPct, { target: { value: '18' } });
  // debounce window
  await act(async () => { await vi.advanceTimersByTimeAsync(650); });
  expect(api.setPlatformCommission).toHaveBeenCalledWith(2, 18);
  // re-fetch after persist (initial + reload)
  expect(api.getPlatformPrices).toHaveBeenCalledTimes(2);
});
