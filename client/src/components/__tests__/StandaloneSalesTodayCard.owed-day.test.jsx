/**
 * StandaloneSalesTodayCard — the « À rembourser » block's place and words (specs/sas/outside-booking-sas.md rules 41 (amended V-4), 48; round-1 finding UI-18): the owing
 * sales of any day sit ABOVE the day's list, under the server's `owedTitle`, and each row names its sale's day with the server's `soldDayLabel`.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ __esModule: true, default: { getStandaloneSales: vi.fn(), closeStandaloneSaleObligation: vi.fn() } }));
import api from '../../api';
import StandaloneSalesTodayCard from '../StandaloneSalesTodayCard';

const row = (over) => ({
  ref: `standalone:${over.id}`, clientLabel: 'Passage', lines: ['Bière locale × 1'], totalCents: 650, remainingCents: 0, statusLabel: 'Payée', tone: 'paid', refundObligations: [], ...over,
});
const OWING = row({ id: 12, soldDayLabel: 'Vente du 14/11', refundObligations: [{ id: 3, amountCents: 650, label: '6,50 € à rembourser', detail: null }] });
const TODAY = row({ id: 40, soldDayLabel: 'Vente du 16/11' });

beforeEach(() => { vi.clearAllMocks(); });

test('the owed block comes before the day\'s list, titled by the server, each row naming its sale\'s day', async () => {
  // date-literal-ok: a payload input the component prints as served, never compared with a clock
  api.getStandaloneSales.mockResolvedValue({ day: '2026-11-16', sales: [TODAY], owed: [OWING], owedTitle: 'À rembourser' });
  render(<StandaloneSalesTodayCard onNewSale={() => {}} />);
  const owed = await screen.findByRole('region', { name: 'À rembourser' });
  expect(within(owed).getByRole('heading', { name: 'À rembourser' })).toBeInTheDocument();
  expect(within(owed).getByText('Vente du 14/11 · 6,50 € à rembourser')).toBeInTheDocument();
  const list = screen.getByRole('list');
  expect(owed.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(list).getByText('Vente n° 40 · Passage')).toBeInTheDocument();
  expect(within(list).queryByText(/Vente du/)).toBeNull();
});

test('nothing owed: no title, no block', async () => {
  // date-literal-ok: a payload input the component prints as served, never compared with a clock
  api.getStandaloneSales.mockResolvedValue({ day: '2026-11-16', sales: [TODAY], owed: [], owedTitle: 'À rembourser' });
  render(<StandaloneSalesTodayCard onNewSale={() => {}} />);
  await screen.findByText('Vente n° 40 · Passage');
  expect(screen.queryByText('À rembourser')).toBeNull();
});
