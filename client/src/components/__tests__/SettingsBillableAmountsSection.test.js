import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import SettingsBillableAmountsSection from '../SettingsBillableAmountsSection';
import api from '../../api';

// specs/extinguisher-seal-and-repair-amounts.md — the « Tarifs facturables » section groups the
// priced-linen items + the repair amounts; keyed repair rows (extinguisher seal) are protected.

vi.mock('../../api', () => ({
  default: {
    getLinenItems: vi.fn(),
    getRepairAmounts: vi.fn(),
    updateLinenItems: vi.fn().mockResolvedValue([]),
    updateRepairAmounts: vi.fn().mockResolvedValue([]),
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

test('renders the linen + repair sub-lists from the API', async () => {
  api.getLinenItems.mockResolvedValue([{ id: 1, label: 'Taie', price: 5, category: 'bed' }]);
  api.getRepairAmounts.mockResolvedValue([{ id: 1, repairKey: 'extinguisher_seal', label: 'Plomb extincteur', price: 30 }]);
  render(<SettingsBillableAmountsSection />);
  expect(await screen.findByText('Tarifs facturables')).toBeInTheDocument();
  expect(await screen.findByDisplayValue('Taie')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Plomb extincteur')).toBeInTheDocument();
});

test('the keyed extinguisher repair row is protected (label disabled), custom rows are editable', async () => {
  api.getLinenItems.mockResolvedValue([]);
  api.getRepairAmounts.mockResolvedValue([
    { id: 1, repairKey: 'extinguisher_seal', label: 'Plomb extincteur', price: 30 },
    { id: 2, repairKey: null, label: 'Vitre cassée', price: 50 },
  ]);
  render(<SettingsBillableAmountsSection />);
  expect(await screen.findByDisplayValue('Plomb extincteur')).toBeDisabled();
  expect(screen.getByDisplayValue('Vitre cassée')).not.toBeDisabled();
});

test('saving repairs sends the full list to updateRepairAmounts', async () => {
  api.getLinenItems.mockResolvedValue([]);
  api.getRepairAmounts.mockResolvedValue([{ id: 1, repairKey: 'extinguisher_seal', label: 'Plomb extincteur', price: 0 }]);
  render(<SettingsBillableAmountsSection />);
  await screen.findByDisplayValue('Plomb extincteur');
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les montants de réparation' }));
  await waitFor(() => expect(api.updateRepairAmounts).toHaveBeenCalledTimes(1));
  expect(api.updateRepairAmounts).toHaveBeenCalledWith([
    { repairKey: 'extinguisher_seal', label: 'Plomb extincteur', price: 0 },
  ]);
});
