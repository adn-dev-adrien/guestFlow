// Audit R5 (2026-10-30), specs/ui-review-2026-10-19-operations.md rule 39 — a slow answer for a filter already left never replaces the list of the filter shown.
import React from 'react';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getDevis: vi.fn(), deleteDevis: vi.fn(), convertDevisToReservation: vi.fn(), getDevisPdfBlob: vi.fn() },
}));
vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({ confirm: vi.fn().mockResolvedValue(false), alert: vi.fn().mockResolvedValue(undefined) }),
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false }));

import api from '../../api';
import DevisPage from '../DevisPage';

const devis = (id, number) => ({
  id, devisNumber: number, status: 'draft', clientName: 'Ada L', lastName: 'L', firstName: 'Ada',
  propertyName: 'Granja', startDate: '2026-07-10', endDate: '2026-07-13', finalPrice: 600,
});

test('the late list of the status filter left is dropped', async () => {
  let finishSent;
  api.getDevis.mockImplementation((params) => (params.status === 'sent'
    ? new Promise((resolve) => { finishSent = resolve; })
    : Promise.resolve([devis(1, 'D-ALL')])));
  render(<MemoryRouter><ThemeProvider theme={theme}><DevisPage /></ThemeProvider></MemoryRouter>);
  await screen.findByText('D-ALL');
  await userEvent.click(screen.getAllByRole('combobox')[0]);
  await userEvent.click(within(screen.getByRole('listbox')).getByText('Envoyé'));
  await userEvent.click(screen.getAllByRole('combobox')[0]);
  await userEvent.click(within(screen.getByRole('listbox')).getByText('Tous'));
  await screen.findByText('D-ALL');
  await act(async () => { finishSent([devis(2, 'D-SENT')]); });
  expect(screen.queryByText('D-SENT')).not.toBeInTheDocument();
  expect(screen.getByText('D-ALL')).toBeInTheDocument();
});
