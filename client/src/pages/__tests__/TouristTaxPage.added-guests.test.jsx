// The added guests' row — specs/platform-added-guests-tourist-tax.md rule 12: same stay as its main
// row, its own « Déclarée » tick, which leaves the main row alone.
import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxExtraction: vi.fn(), setTouristTaxDeclared: vi.fn() },
}));

import api from '../../api';
import TouristTaxPage from '../TouristTaxPage';

const STAY = {
  reservationId: 7, propertyId: 1, propertyName: 'Gîte', reservationName: 'Jean Dupont',
  startDate: '2026-06-20', endDate: '2026-06-22', lastNightDate: '2026-06-21', children: 0, nightsCount: 2, taxRate: 1.2,
};
const DATA = {
  month: '2026-06', from: '2026-06-01', toExclusive: '2026-07-01',
  byProperty: [{ propertyId: 1, propertyName: 'Gîte', reservationsCount: 1, nightsCount: 2, adultNights: 6, taxAmount: 7.2, accommodationAmount: 500 }],
  reservations: [
    { ...STAY, touristTaxDeclaredAt: '2026-06-22 09:00:00', adults: 2, taxAmount: 4.8, accommodationAmount: 500 },
    { ...STAY, addedGuestsRow: true, touristTaxDeclaredAt: null, adults: 1, taxAmount: 2.4, accommodationAmount: 0 },
  ],
  totals: { reservationsCount: 1, rentedNights: 2, adultNights: 6, taxAmount: 7.2, accommodationAmount: 500 },
};

beforeEach(() => {
  api.getTouristTaxExtraction.mockReset().mockResolvedValue(DATA);
  api.setTouristTaxDeclared.mockReset().mockResolvedValue({ declaredAt: '2026-07-01 10:00:00' });
});

const renderPage = () => render(
  <ThemeProvider theme={theme}><DialogProvider><MemoryRouter><TouristTaxPage /></MemoryRouter></DialogProvider></ThemeProvider>,
);

test('the added row ticks alone, and the main row stays as it was', async () => {
  renderPage();
  const added = await screen.findByRole('checkbox', { name: /Jean Dupont · voyageurs ajoutés/ });
  const main = screen.getByRole('checkbox', { name: 'Déclarée — Jean Dupont' });
  expect(main).toBeChecked();
  expect(added).not.toBeChecked();
  fireEvent.click(added);
  await waitFor(() => expect(api.setTouristTaxDeclared).toHaveBeenCalledWith(7, true, { addedGuests: true }));
  await waitFor(() => expect(added).toBeChecked());
  expect(main).toBeChecked();
});
