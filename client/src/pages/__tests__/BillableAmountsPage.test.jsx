import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';

import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';
import BillableAmountsPage from '../BillableAmountsPage';
import api from '../../api';

// specs/ds-sweep-settings.md §3.1 rule 1 — the page owns ONE bar-level save for both lists (the two
// content « Enregistrer » rows are gone), load failures render a retryable ErrorAlert, and the keyed
// extinguisher repair row stays protected (specs/extinguisher-seal-and-repair-amounts.md).

vi.mock('../../api', () => ({
  default: {
    getLinenItems: vi.fn(),
    getRepairAmounts: vi.fn(),
    updateLinenItems: vi.fn().mockResolvedValue([]),
    updateRepairAmounts: vi.fn().mockResolvedValue([]),
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DialogProvider><BillableAmountsPage /></DialogProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

test('renders the linen + repair sub-lists; the content save buttons are gone (bar owns the save)', async () => {
  api.getLinenItems.mockResolvedValue([{ id: 1, label: 'Taie', price: 5, category: 'bed' }]);
  api.getRepairAmounts.mockResolvedValue([{ id: 1, repairKey: 'extinguisher_seal', label: 'Plomb extincteur', price: 30 }]);
  renderPage();
  expect(await screen.findByDisplayValue('Taie')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Plomb extincteur')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enregistrer le prix du linge' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Enregistrer les montants de réparation' })).toBeNull();
});

test('the keyed extinguisher repair row is protected (label disabled), custom rows are editable', async () => {
  api.getLinenItems.mockResolvedValue([]);
  api.getRepairAmounts.mockResolvedValue([
    { id: 1, repairKey: 'extinguisher_seal', label: 'Plomb extincteur', price: 30 },
    { id: 2, repairKey: null, label: 'Vitre cassée', price: 50 },
  ]);
  renderPage();
  expect(await screen.findByDisplayValue('Plomb extincteur')).toBeDisabled();
  expect(screen.getByDisplayValue('Vitre cassée')).not.toBeDisabled();
});

test('the bar save persists BOTH lists in one action and toasts the outcome', async () => {
  api.getLinenItems.mockResolvedValue([{ id: 1, label: 'Taie', price: 5, category: 'bed' }]);
  api.getRepairAmounts.mockResolvedValue([{ id: 1, repairKey: 'extinguisher_seal', label: 'Plomb extincteur', price: 0 }]);
  api.updateLinenItems.mockResolvedValue([{ id: 1, label: 'Taie', price: 6, category: 'bed' }]);
  api.updateRepairAmounts.mockResolvedValue([{ id: 1, repairKey: 'extinguisher_seal', label: 'Plomb extincteur', price: 0 }]);
  renderPage();
  const price = await screen.findByDisplayValue('5');
  fireEvent.change(price, { target: { value: '6' } }); // dirty → save enabled
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateLinenItems).toHaveBeenCalledTimes(1));
  expect(api.updateLinenItems).toHaveBeenCalledWith([{ label: 'Taie', price: 6, category: 'bed' }]);
  expect(api.updateRepairAmounts).toHaveBeenCalledWith([
    { repairKey: 'extinguisher_seal', label: 'Plomb extincteur', price: 0 },
  ]);
  expect(await screen.findByText('Tarifs facturables enregistrés.')).toBeInTheDocument(); // toast
});

test('a failed load renders the retryable ErrorAlert (no silent catch)', async () => {
  api.getLinenItems.mockRejectedValue(new Error('boom'));
  api.getRepairAmounts.mockResolvedValue([]);
  renderPage();
  expect(await screen.findByText('Impossible de charger les tarifs facturables.')).toBeInTheDocument();
  api.getLinenItems.mockResolvedValue([]);
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(api.getLinenItems).toHaveBeenCalledTimes(2));
});
