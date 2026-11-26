// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rule 1 (second half) — a sale outside a stay has no fiche to wait on
// and, without a client, no name besides its label: the line prints the server's wording and heading, never a doubled label.
import React from 'react';
import { render, screen } from '@testing-library/react';
import ReconciliationLine from '../ReconciliationLine';
import { item } from './reconciliationFixtures';

const SALE = { id: null, saleKey: 'resource-booking:41', saleLabel: 'Vente hors séjour', hasClient: false, clientName: 'Vente hors séjour', platform: 'direct' };

test('a standalone sale reads « Attendu » and prints its label once', () => {
  render(<ReconciliationLine showReservation item={item({ reservation: SALE, label: 'Vente hors séjour (lien 42) · Versement immédiat', expectedWording: 'Attendu', clientHeading: '' })} />);
  expect(screen.queryByText(/La fiche attend/)).toBeNull();
  expect(screen.getByText(/^Attendu\s/)).toBeTruthy();
  expect(screen.getAllByText(/Vente hors séjour/)).toHaveLength(1);
});

test('a stay keeps « La fiche attend » and its client heading', () => {
  render(<ReconciliationLine showReservation item={item()} />);
  expect(screen.getByText(/La fiche attend/)).toBeTruthy();
  expect(screen.getByText(/Luca Rossi · Versement Booking/)).toBeTruthy();
});
