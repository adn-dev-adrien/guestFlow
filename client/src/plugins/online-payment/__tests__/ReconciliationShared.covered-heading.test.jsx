// specs/mollie-rolling-reserve-and-incoming-payments.md rule 1 (second half) — « couvre aussi », the shares dialog labels and
// the home alert print the server's `clientHeading`: an anonymous sale shows its label once, never doubled.
import React from 'react';
import { MemoryRouter } from 'react-router';
import { render, screen, waitFor } from '@testing-library/react';
import ReconciliationLine from '../ReconciliationLine';
import ReconciliationAlert from '../ReconciliationAlert';
import { shareLabels } from '../reconciliationShared';
import { vi } from 'vitest';
import { proposed, item } from './reconciliationFixtures';

vi.mock('../../../api', () => ({ __esModule: true, default: { getReconciliation: vi.fn() } }));
import api from '../../../api';

const SALE = { reservationId: null, ledgerKey: 'sale', label: 'Vente hors séjour (lien 42) · Versement immédiat', clientName: 'Vente hors séjour', clientHeading: '' };
const STAY = { reservationId: 8, ledgerKey: 'balance', label: 'Versement Booking', clientName: 'Anna Verdi', clientHeading: 'Anna Verdi' };

test('a grouped proposal names a stay with its client and a sale by its label alone', () => {
  const p = proposed();
  render(<ReconciliationLine showReservation item={{ ...p, proposal: { ...p.proposal, alsoCovers: [SALE, STAY] } }} />);
  const text = document.body.textContent;
  expect(text).toContain('couvre aussi Vente hors séjour (lien 42) · Versement immédiat, Anna Verdi (Versement Booking)');
  expect(text).not.toMatch(/Vente hors séjour \(Vente hors séjour/);
});

test('the shares dialog labels follow the same heading rule', () => {
  const p = proposed();
  const labels = shareLabels({ ...p, proposal: { ...p.proposal, alsoCovers: [SALE, STAY] } });
  expect(labels['null|sale']).toBe(SALE.label);
  expect(labels['8|balance']).toBe('Anna Verdi · Versement Booking');
});

test('the home alert prints an anonymous sale without a doubled label', async () => {
  const sale = item({ reservation: { id: null, clientName: 'Vente hors séjour' }, label: 'Vente hors séjour (lien 42) · Retenue Mollie', clientHeading: '', isGap: true, state: 'late', stateLabel: 'En retard' });
  api.getReconciliation.mockResolvedValue({ items: [sale] });
  render(<MemoryRouter><ReconciliationAlert attention={{ title: 'Écarts de règlement', count: 1, severity: 'warning' }} /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByText(/Vente hors séjour/).length).toBeGreaterThan(0));
  expect(screen.getByText('Vente hors séjour (lien 42) · Retenue Mollie')).toBeTruthy();
});
