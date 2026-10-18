import { vi } from 'vitest';
/**
 * TouristTaxPage — specs/ds-sweep-finance.md rule 23: the « Taxe de séjour totale » tile is the
 * amount declared to the commune, printed to the cent (mega review #5, M5: 5,95 € showed « 6 € »,
 * 52,44 € showed « 52 € »).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
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

const DATA = {
  month: '2026-09', from: '2026-09-01', toExclusive: '2026-10-01',
  byProperty: [{ propertyId: 1, propertyName: 'Gîte', reservationsCount: 1, nightsCount: 1, adultNights: 2, taxAmount: 5.95, accommodationAmount: 120 }],
  reservations: [{
    reservationId: 7, propertyId: 1, propertyName: 'Gîte', reservationName: 'Jean Dupont',
    startDate: '2026-09-20', endDate: '2026-09-21', lastNightDate: '2026-09-20', touristTaxDeclaredAt: null,
    adults: 2, children: 0, nightsCount: 1, taxRate: 2.975, taxAmount: 5.95, accommodationAmount: 120,
  }],
  totals: { reservationsCount: 1, rentedNights: 1, adultNights: 2, taxAmount: 5.95, accommodationAmount: 120 },
};

test('rule 23 — the declared total keeps its cents', async () => {
  api.getTouristTaxExtraction.mockResolvedValue(DATA);
  render(
    <MemoryRouter>
      <ThemeProvider theme={theme}><DialogProvider><TouristTaxPage /></DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
  const label = await screen.findByText('Taxe de séjour totale');
  const card = label.closest('.MuiCard-root') || label.parentElement.parentElement;
  expect(card.textContent.replace(/\s/g, ' ')).toMatch(/5,95 €/);
  expect(card.textContent.replace(/\s/g, ' ')).not.toMatch(/(^|[^,\d])6 €/);
});
