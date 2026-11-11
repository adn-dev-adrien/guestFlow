// specs/plugins-phase-2-hosts.md rule 15 — « Linge » reads and saves the stock through the plugin's
// settings, no longer through the core settings form. The laundry day left them for the laundry schedule
// (specs/linen-laundry-days.md rule 21): saving the stock alone does not touch the schedule.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../../components/DialogProvider', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));
vi.mock('../../../api', () => ({
  default: {
    getPluginSettings: vi.fn(),
    getLaundrySchedule: vi.fn(),
    saveLaundrySchedule: vi.fn(),
    previewLaundrySchedule: vi.fn().mockResolvedValue({ cycle: [], longestWaitDays: 7, firstTripOn: '2026-10-29' }),
    savePluginSettings: vi.fn().mockResolvedValue({}),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  },
}));

import api from '../../../api';
import LinenStockPage from '../LinenStockPage';

test('specs/plugins-phase-2-hosts.md rule 15: the stock page loads and saves /api/plugins/linen/settings', async () => {
  api.getLaundrySchedule.mockResolvedValue({
    current: { effectiveFrom: '0001-01-01', weekdays: [4], turnaroundDays: 1, cycle: [{ dropWeekday: 4, pickUpWeekday: 4, waitDays: 7 }], longestWaitDays: 7 },
    pending: null,
    tomorrow: '2026-10-29',
  });
  api.getPluginSettings.mockResolvedValue({
    laundryWeekday: '4', bedLinenStockSingle: '6', bedLinenStockDouble: '14', bedLinenStockBaby: '0',
    towelStockLarge: '20', towelStockMedium: '10', towelStockSmall: '12', towelStockBathMat: '3',
  });
  render(<MemoryRouter><LinenStockPage /></MemoryRouter>);

  const doubles = await screen.findByLabelText('Doubles');
  await waitFor(() => expect(doubles).toHaveValue(14));
  expect(api.getPluginSettings).toHaveBeenCalledWith('linen');
  fireEvent.change(doubles, { target: { value: '16' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

  await waitFor(() => expect(api.savePluginSettings).toHaveBeenCalledWith('linen', {
    bedLinenStockSingle: 6,
    bedLinenStockDouble: 16,
    bedLinenStockBaby: 0,
    towelStockLarge: 20,
    towelStockMedium: 10,
    towelStockSmall: 12,
    towelStockBathMat: 3,
  }));
  expect(api.saveLaundrySchedule).not.toHaveBeenCalled();
  expect(api.getSettings).not.toHaveBeenCalled();
  expect(api.updateSettings).not.toHaveBeenCalled();
});
