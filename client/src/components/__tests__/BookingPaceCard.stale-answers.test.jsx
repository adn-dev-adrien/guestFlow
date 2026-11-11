// Audit R5 (2026-10-30), specs/booking-pace.md rule 16 — the card never formats a payload in another measure's
// unit, and an answer for a measure already left is dropped.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getFinancePace: vi.fn(), getFinancePaceMonth: vi.fn() },
}));

import api from '../../api';
import BookingPaceCard from '../BookingPaceCard';

const payload = (metric, current) => ({
  asOf: '2026-09-30', metric, paceStart: '2024-09-02', comparableFrom: '2025-09-02',
  summary: { text: `Phrase ${metric}.`, change: null, notice: null },
  pickup: { last7: { current, lastYear: null }, last30: { current, lastYear: null } },
  months: [], hasComparison: false,
});

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('switching the measure shows the loading state, never the old figures in the new unit', async () => {
  const revenue = deferred();
  api.getFinancePace.mockImplementation(({ metric }) => (metric === 'revenue' ? revenue.promise : Promise.resolve(payload(metric, 1))));
  render(<BookingPaceCard propertyId="" refreshKey={0} />);
  expect(await screen.findAllByText('+1 réservation')).toHaveLength(2);
  await userEvent.click(screen.getByRole('button', { name: 'CA des nuits' }));
  expect(screen.queryByText(/\+1 €/)).not.toBeInTheDocument();
  expect(screen.queryByText('Phrase reservations.')).not.toBeInTheDocument();
  await act(async () => { revenue.resolve(payload('revenue', 900)); });
  expect(await screen.findAllByText(/\+900\s€/)).toHaveLength(2);
});

test('a late answer for a measure already left is dropped', async () => {
  const revenue = deferred();
  api.getFinancePace.mockImplementation(({ metric }) => (metric === 'revenue' ? revenue.promise : Promise.resolve(payload(metric, metric === 'nights' ? 2 : 1))));
  render(<BookingPaceCard propertyId="" refreshKey={0} />);
  await screen.findAllByText('+1 réservation');
  await userEvent.click(screen.getByRole('button', { name: 'CA des nuits' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nuits' }));
  expect(await screen.findAllByText('+2 nuits')).toHaveLength(2);
  await act(async () => { revenue.resolve(payload('revenue', 3090)); });
  expect(screen.getAllByText('+2 nuits')).toHaveLength(2);
  expect(screen.queryByText(/3\s?090/)).not.toBeInTheDocument();
});
