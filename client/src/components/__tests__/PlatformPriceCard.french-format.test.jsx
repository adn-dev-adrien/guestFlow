import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

import PlatformPriceCard from '../PlatformPriceCard';
import api from '../../api';

// specs/platform-price-from-commission.md rule 7 (2026-10-27 audit) — the grid printed « 1075 € » split on
// two lines, « 15.5 % », and the stored lowercase « direct »: French whole-euro grouping, a comma
// decimal, the display label, and money cells that never wrap.

vi.mock('../../api', () => ({ __esModule: true, default: { getPlatformPrices: vi.fn() } }));

const GRID = {
  platforms: [
    { id: 'direct', name: 'direct', commissionPercent: 5, isDirect: true, directVia: [] },
    { id: 2, name: 'Airbnb', commissionPercent: 15.5, isDirect: false },
  ],
  seasons: [{
    ruleId: 1, label: 'Très haute', netPerNight: 341, extraGuestPriceUnit: 'per_night',
    byPlatform: { direct: 1075, 2: 1270 }, extraGuestByPlatform: { direct: 27, 2: 30 },
  }],
};

test('French formats, display label, no wrapping money', async () => {
  api.getPlatformPrices.mockResolvedValue(GRID);
  render(<MemoryRouter><PlatformPriceCard propertyId={1} /></MemoryRouter>);
  const cell = await screen.findByText('1 075 €');
  expect(cell).toHaveStyle({ whiteSpace: 'nowrap' });
  expect(screen.getByLabelText('Commission Airbnb')).toHaveTextContent('15,5 %');
  expect(screen.getByText('Direct')).toBeInTheDocument();
  expect(screen.queryByText('direct')).toBeNull();
  expect(screen.getByText('net 341,00 €')).toHaveStyle({ whiteSpace: 'nowrap' });
});
