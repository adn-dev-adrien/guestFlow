import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';
import { vi } from 'vitest';

import api from '../../../api';

// specs/defer-arrival-complement-to-checkout.md §3.2 — « En fin de séjour » chosen at check-in: the
// fiche shows ONE « Complément de fin de séjour » (arrival lines + end-of-stay lines, one total, one
// paid action) instead of two cards that read like a double count.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const CHECKOUT_COMPLEMENT = {
  deferred: true,
  amount: 78,
  arrivalAmount: 38,
  endOfStayAmount: 40,
  paid: false,
  paidCash: false,
  paidDate: null,
  lines: [
    { label: 'Linge de toilette', qty: 4, unitPrice: 8, amount: 32, origin: 'arrival' },
    { label: 'Taxe de séjour', qty: 1, unitPrice: 6, amount: 6, origin: 'arrival' },
    { label: 'Ménage de fin de séjour', qty: 1, unitPrice: 40, amount: 40, origin: 'endOfStay' },
  ],
};

function renderFinance(overrides) {
  const ctx = makeMockContext(overrides);
  render(
    <DialogProvider>
        <ReservationFormProvider value={ctx}>
          <FinanceSection />
        </ReservationFormProvider>
      </DialogProvider>
  );
  return ctx;
}

beforeEach(() => { vi.clearAllMocks(); });

test('deferred: a single « Complément de fin de séjour » card with every line and the combined total', () => {
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 38 },
    form: {
      checkoutComplement: CHECKOUT_COMPLEMENT,
      complementDeferredToCheckout: true,
      endOfStayComplementAmount: 40,
    },
  });
  expect(screen.getByText('Complément de fin de séjour')).toBeInTheDocument();
  expect(screen.getByText(/78,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Linge de toilette : 32,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Taxe de séjour : 6,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Ménage de fin de séjour : 40,00 €/)).toBeInTheDocument();
  // The separate arrival card is gone — one collection, one card.
  expect(screen.queryByText('Complément à percevoir')).not.toBeInTheDocument();
});

test('deferred: « Marquer complément payé » settles both buckets in the form (the server mirrors the DB)', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 38 },
    form: { checkoutComplement: CHECKOUT_COMPLEMENT, endOfStayComplementAmount: 40 },
  });
  await user.click(screen.getByRole('button', { name: 'Marquer complément payé' }));
  expect(api.markPayment).toHaveBeenCalledWith(7, expect.objectContaining({ complementPaid: true }));
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({
    complementPaid: true, endOfStayComplementPaid: true,
  }));
});

test('deferred: « Caisse interne » flags both buckets', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 38 },
    form: { checkoutComplement: CHECKOUT_COMPLEMENT, endOfStayComplementAmount: 40 },
  });
  await user.click(screen.getByRole('button', { name: 'Caisse interne' }));
  expect(api.markPayment).toHaveBeenCalledWith(7, { complementPaidCash: true });
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({
    complementPaidCash: true, endOfStayComplementPaidCash: true, endOfStayComplementPaid: true,
  }));
});

test('not deferred: the two separate cards are unchanged', () => {
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 38 },
    form: {
      checkoutComplement: { ...CHECKOUT_COMPLEMENT, deferred: false },
      endOfStayComplementAmount: 40,
      endOfStayComplementDetail: JSON.stringify([{ label: 'Ménage de fin de séjour', amount: 40 }]),
    },
  });
  expect(screen.getByText('Complément à percevoir')).toBeInTheDocument();
  expect(screen.getByText('Complément de fin de séjour')).toBeInTheDocument();
});
