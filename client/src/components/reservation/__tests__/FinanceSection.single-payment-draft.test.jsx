// specs/single-payment-from-the-fiche.md (amended 2026-11-12, manual trial of 4.0.0) — « Encaisser en une fois » adds up the
// STORED buckets. While the fiche holds an unsaved change (a guest added, whose nights change the complement the rows above
// show live), it would announce a total the ledger no longer says: it is withdrawn until the fiche is saved or cancelled.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from './mockReservationForm';

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn(), settleArrivalPayment: vi.fn() } }));

const COLLECTIBLE = {
  collectible: {
    total: 847.8,
    buckets: [{ bucket: 'balance', label: 'solde', amount: 584 }, { bucket: 'complement', label: 'complément', amount: 263.8 }],
    bookedAt: '2026-11-12',
  },
};

function renderFinance(overrides) {
  const ctx = makeMockContext(overrides);
  render(<DialogProvider><ReservationFormProvider value={ctx}><FinanceSection /></ReservationFormProvider></DialogProvider>);
}

test('a clean fiche announces the stored total', () => {
  renderFinance({ editingReservationId: 7, reservationId: 7, fichePristine: true, form: { arrivalPayment: COLLECTIBLE } });
  expect(screen.getByText(/Encaisser en une fois : 847,80 €/)).toBeInTheDocument();
});

test('a fiche with an unsaved change does not announce a stale total', () => {
  renderFinance({ editingReservationId: 7, reservationId: 7, fichePristine: false, form: { arrivalPayment: COLLECTIBLE } });
  expect(screen.queryByText(/Encaisser en une fois/)).toBeNull();
});
