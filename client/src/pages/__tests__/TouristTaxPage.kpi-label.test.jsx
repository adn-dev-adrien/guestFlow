// specs/ui-review-2026-10-19-operations.md rule 45 — the tile counts every row of the month, whatever its channel.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({ __esModule: true, default: { getTouristTaxExtraction: vi.fn(), setTouristTaxDeclared: vi.fn(), getProperties: vi.fn(async () => []) } }));

import api from '../../api';
import TouristTaxPage from '../TouristTaxPage';

test('rule 45: the tile reads « Réservations (mois) »', async () => {
  api.getTouristTaxExtraction.mockResolvedValue({
    month: '2026-06',
    byProperty: [],
    reservations: [],
    totals: { reservationsCount: 2, rentedNights: 3, adultNights: 6, taxAmount: 12, accommodationAmount: 600 },
  });
  render(<ThemeProvider theme={theme}><DialogProvider><MemoryRouter><TouristTaxPage /></MemoryRouter></DialogProvider></ThemeProvider>);
  expect(await screen.findByText('Réservations (mois)')).toBeInTheDocument();
  expect(screen.queryByText(/Réservations directes/)).toBeNull();
});
