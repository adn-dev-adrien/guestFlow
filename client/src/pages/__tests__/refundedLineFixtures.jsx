// Shared fixtures of the fiche's refunded offered line (specs/pricing-components.md rule 108): a direct stay whose « Bière » line was
// offered after a note paid it. The live quote carries the server's own key of the custom line (`key`), which is what the fiche matches.
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import ReservationPage from '../ReservationPage';

// The label the server keyed differs from the title on purpose: the fiche reads the key, it never rebuilds it from a label.
export const SERVER_KEY = 'custom:bière pression';

export const FICHE = {
  id: 22303, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2099-11-13', endDate: '2099-11-17',
  platform: 'direct', adults: 2, reservationNumber: '202622303', singleBeds: 0, doubleBeds: 0, babyBeds: 0,
  updatedAt: '2099-01-01 10:00:00', options: [], resources: [], ledger: { rows: [], closing: null, remaining: 0 },
  refundableLines: [], refunds: [], refundTotals: { book: 0, withCash: 0 }, collectedTtc: 230,
};

export const QUOTE = {
  finalPrice: 200, totalStayPrice: 200, nights: 4, touristTaxTotal: 0, touristTaxOriginalTotal: 0, resourceLines: [],
  optionLines: [{
    isCustom: true, customKey: 'custom_1', key: SERVER_KEY, title: 'Bière', offered: true, quantity: 1, unitPrice: 30,
    billedUnits: 1, priceType: 'per_stay', totalPrice: 0, originalTotalPrice: 30,
  }],
};

export function mockFiche(api) {
  api.calculatePrice.mockResolvedValue(QUOTE);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2 }]);
  api.getClients.mockResolvedValue([{ id: 1, firstName: 'Jean', lastName: 'Dupont' }]);
  api.getReservations.mockResolvedValue([]);
}

export function openFiche() {
  return render(
    <MemoryRouter initialEntries={['/reservations/22303']}>
      <ThemeProvider theme={theme}>
        <Routes><Route path="/reservations/:reservationId" element={<ReservationPage />} /></Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}
