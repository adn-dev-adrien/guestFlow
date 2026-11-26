// specs/pricing/pricing-components.md rule 88 (loop t2 UI2-9) — on a phone the finance page carries « Vente hors séjour » at its top: the day's card, given no `onNewSale`,
// draws no button of its own, so the page shows one entry and nothing moves when the dashboard arrives.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ __esModule: true, default: { getStandaloneSales: vi.fn() } }));
import api from '../../api';
import StandaloneSalesTodayCard from '../StandaloneSalesTodayCard';

test('without `onNewSale` the card lists the day and offers no button', async () => {
  api.getStandaloneSales.mockResolvedValue({ day: '2099-02-13', sales: [] });
  render(<StandaloneSalesTodayCard />);
  await screen.findByRole('region', { name: /Ventes hors séjour/ });
  expect(screen.queryByRole('button', { name: 'Vente hors séjour' })).toBeNull();
});
