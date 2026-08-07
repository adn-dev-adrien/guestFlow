import { vi } from 'vitest';
/**
 * TouristTaxPage — specs/tourist-tax-declared-checkbox.md §7 (client):
 *  - « Dates réservation » shows the reservation's stay dates (arrival → departure), NOT the last night
 *    (non-regression: a 1-night stay 20/06 → 21/06 must render « 20/06/2026 au 21/06/2026 »);
 *  - the « Déclarée » checkbox reflects touristTaxDeclaredAt and toggling PATCHes without navigating.
 * The page is pure render (all figures shaped server-side), so the fixture mirrors the financeModel payload.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

const navigateSpy = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getTouristTaxExtraction: vi.fn(),
    setTouristTaxDeclared: vi.fn(),
  },
}));

import api from '../../api';
import TouristTaxPage from '../TouristTaxPage';

const DATA = {
  month: '2026-06',
  from: '2026-06-01',
  toExclusive: '2026-07-01',
  byProperty: [{ propertyId: 1, propertyName: 'Gîte', reservationsCount: 2, nightsCount: 3, adultNights: 6, taxAmount: 12, accommodationAmount: 600 }],
  reservations: [
    {
      reservationId: 7, propertyId: 1, propertyName: 'Gîte', reservationName: 'Jean Dupont',
      startDate: '2026-06-20', endDate: '2026-06-21', lastNightDate: '2026-06-20',
      touristTaxDeclaredAt: null, adults: 2, children: 0, nightsCount: 1, taxRate: 1, taxAmount: 4, accommodationAmount: 200,
    },
    {
      reservationId: 8, propertyId: 1, propertyName: 'Gîte', reservationName: 'Marie Martin',
      startDate: '2026-06-10', endDate: '2026-06-12', lastNightDate: '2026-06-11',
      touristTaxDeclaredAt: '2026-06-30 09:00:00', adults: 2, children: 0, nightsCount: 2, taxRate: 1, taxAmount: 8, accommodationAmount: 400,
    },
  ],
  totals: { reservationsCount: 2, rentedNights: 3, adultNights: 6, taxAmount: 12, accommodationAmount: 600 },
};

beforeEach(() => {
  navigateSpy.mockReset();
  api.getTouristTaxExtraction.mockReset().mockResolvedValue(DATA);
  api.setTouristTaxDeclared.mockReset().mockResolvedValue({ declaredAt: '2026-07-01 10:00:00' });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}><DialogProvider>
        <TouristTaxPage />
      </DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
}

test('« Dates réservation » shows arrival → departure (a 1-night stay is not collapsed onto one day)', async () => {
  renderPage();
  expect(await screen.findByText('20/06/2026 au 21/06/2026')).toBeInTheDocument();
  // Regression guard: it must NOT show the old « au 20/06/2026 » (last-night minus one day).
  expect(screen.queryByText('20/06/2026 au 20/06/2026')).not.toBeInTheDocument();
});

test('« Déclarée » checkbox reflects touristTaxDeclaredAt and toggling PATCHes without navigating', async () => {
  renderPage();
  const undeclared = await screen.findByLabelText('Déclarée — Jean Dupont');
  const declared = screen.getByLabelText('Déclarée — Marie Martin');
  expect(undeclared).not.toBeChecked();
  expect(declared).toBeChecked();

  fireEvent.click(undeclared);
  await waitFor(() => expect(api.setTouristTaxDeclared).toHaveBeenCalledWith(7, true));
  expect(navigateSpy).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByLabelText('Déclarée — Jean Dupont')).toBeChecked());
});
