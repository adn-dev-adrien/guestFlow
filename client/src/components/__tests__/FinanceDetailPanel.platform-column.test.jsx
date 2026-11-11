// specs/platform-settings-relay-and-review.md rule 13 — `reservation.platform` reads « Plateforme »
// everywhere; « Canal » stays the finance tile's own concept (« Canaux de réservation ») (audit 2026-10-27).
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import FinanceDetailPanel from '../FinanceDetailPanel';

const row = { reservationId: 1, kind: 'deposit', date: '2026-07-01', amount: 120, clientName: 'Camille', propertyName: 'Le Gîte', platform: 'Airbnb', label: 'Acompte' };

function draw(tile, data) {
  render(<ThemeProvider theme={theme}><FinanceDetailPanel id="p" tile={tile} data={data} windowLabel="Exercice 2026" onClose={() => {}} onOpenReservation={() => {}} /></ThemeProvider>);
}

test('collected: the column of the stay’s platform is « Plateforme »', () => {
  draw('collected', { rows: [row], totals: { count: 1, amount: 120 } });
  expect(screen.getByRole('columnheader', { name: 'Plateforme' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Canal' })).toBeNull();
});

test('stays: the same column, the same word', () => {
  draw('stays', {
    scope: 'window',
    rows: [{ id: 1, clientName: 'Camille', propertyName: 'Le Gîte', startDate: '2026-07-01', endDate: '2026-07-04', platform: 'Airbnb', nights: 3, totalSejour: 300 }],
    totals: { count: 1, nights: 3, totalSejour: 300 },
  });
  expect(screen.getByRole('columnheader', { name: 'Plateforme' })).toBeInTheDocument();
});
