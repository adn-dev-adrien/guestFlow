// specs/tariff-recipe-platform-cleaning-fee.md rule 10 — the « Ménage / séjour » column appears only
// when a channel bills a cleaning fee; a channel without one reads « — ».
import React from 'react';
import { render as rtlRender, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

import PlatformPriceCard from '../PlatformPriceCard';
import api from '../../api';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getPlatformPrices: vi.fn() },
}));

const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const gridWith = (airbnbFee) => ({
  platforms: [
    { id: 1, name: 'Direct', commissionPercent: 5, isDirect: true, cleaningFee: null, cleaningFeeDetail: null },
    { id: 2, name: 'Airbnb', commissionPercent: 15.5, isDirect: false, ...airbnbFee },
    { id: 3, name: 'Booking', commissionPercent: 16.44, isDirect: false, cleaningFee: null, cleaningFeeDetail: null },
  ],
  seasons: [{
    ruleId: 1, label: 'Très basse', netPerNight: 288, extraGuestNet: 25, extraGuestPriceUnit: 'per_night',
    byPlatform: { 1: 320, 2: 341, 3: 345 }, extraGuestByPlatform: { 1: 27, 2: 30, 3: 30 },
  }],
});

beforeEach(() => { vi.clearAllMocks(); });

test('Airbnb bills a cleaning fee: the column shows 122 € and its net, the others « — »', async () => {
  api.getPlatformPrices.mockResolvedValue(gridWith({
    cleaningFee: 122, cleaningFeeDetail: { cleaningNet: 80, choresNet: 22.92, net: 102.92 },
  }));
  render(<PlatformPriceCard propertyId={1} />);
  await screen.findByText('Ménage / séjour');
  const rows = screen.getAllByRole('row');
  const airbnb = rows.find((r) => r.textContent.includes('Airbnb'));
  expect(airbnb).toHaveTextContent('122 €');
  expect(airbnb).toHaveTextContent(/net 102,92/);
  expect(rows.find((r) => r.textContent.includes('Booking')).lastChild).toHaveTextContent('—');
  expect(screen.getByLabelText(/Ménage 80,00 € \+ corvées 22,92 € = 102,92 € net/)).toBeInTheDocument();
});

test('no channel bills a cleaning fee: no column', async () => {
  api.getPlatformPrices.mockResolvedValue(gridWith({ cleaningFee: null, cleaningFeeDetail: null }));
  render(<PlatformPriceCard propertyId={1} />);
  await screen.findByText('Très basse');
  expect(screen.queryByText('Ménage / séjour')).toBeNull();
});
