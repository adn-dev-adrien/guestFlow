// specs/plugins-phase-2-hosts.md rule 15 — « Linge » reads and saves the stock and the laundry day
// through the plugin's settings, no longer through the core settings form.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../../components/DialogProvider', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));
vi.mock('../../../api', () => ({
  default: {
    getPluginSettings: vi.fn(),
    savePluginSettings: vi.fn().mockResolvedValue({}),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  },
}));

import api from '../../../api';
import LinenStockPage from '../LinenStockPage';

test('specs/plugins-phase-2-hosts.md rule 15: the stock page loads and saves /api/plugins/linen/settings', async () => {
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
    laundryWeekday: 4,
    bedLinenStockSingle: 6,
    bedLinenStockDouble: 16,
    bedLinenStockBaby: 0,
    towelStockLarge: 20,
    towelStockMedium: 10,
    towelStockSmall: 12,
    towelStockBathMat: 3,
  }));
  expect(api.getSettings).not.toHaveBeenCalled();
  expect(api.updateSettings).not.toHaveBeenCalled();
});
