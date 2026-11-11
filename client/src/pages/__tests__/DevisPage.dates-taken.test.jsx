// specs/payment-link-lifecycle.md rule 48 — the devis list marks a quote whose nights another stay took since.
import React from 'react';
import { render, screen } from '@testing-library/react';
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
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));

import api from '../../api';
import DevisPage from '../DevisPage';

const DEVIS = {
  id: 1, devisNumber: 'D-2099-001', devisStatus: 'sent', status: 'sent', clientName: 'Ana Test', firstName: 'Ana', lastName: 'Test',
  propertyName: 'Logement', startDate: '2099-07-10', endDate: '2099-07-13', finalPrice: 600,
};
const renderPage = () => render(<MemoryRouter><ThemeProvider theme={theme}><DevisPage /></ThemeProvider></MemoryRouter>);

test('a devis whose dates were taken carries « Dates prises »', async () => {
  api.getDevis.mockResolvedValue([{ ...DEVIS, datesTaken: { label: 'Dates prises', takenBy: { id: 4, label: 'T4', url: '/reservations/4' } } }]);
  renderPage();
  expect((await screen.findAllByText('Dates prises')).length).toBeGreaterThan(0);
});

test('without the marker, nothing', async () => {
  api.getDevis.mockResolvedValue([{ ...DEVIS, datesTaken: null }]);
  renderPage();
  await screen.findAllByText('D-2099-001');
  expect(screen.queryByText('Dates prises')).not.toBeInTheDocument();
});
