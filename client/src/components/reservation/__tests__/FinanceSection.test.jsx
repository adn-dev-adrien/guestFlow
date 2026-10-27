import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from './mockReservationForm';
import { vi } from 'vitest';
import { dueRow, ledgerOf } from './ledgerFixtures';

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

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

test('renders the brut price and the adjusted-price field', () => {
  renderFinance();
  expect(screen.getByText('Prix hébergement brut')).toBeInTheDocument();
  expect(screen.getByLabelText('Prix ajusté')).toBeInTheDocument();
});

test('the adjusted price commits an arithmetic expression on blur (specs/reservation-price-arithmetic.md)', () => {
  const ctx = renderFinance();
  const input = screen.getByLabelText('Prix ajusté');
  // No commit while typing…
  fireEvent.change(input, { target: { value: '100+150' } });
  expect(ctx.updateForm).not.toHaveBeenCalledWith(expect.objectContaining({ customPrice: expect.anything() }));
  // …evaluated + committed on blur.
  fireEvent.blur(input);
  expect(ctx.updateForm).toHaveBeenCalledWith({ customPrice: 250 });
});

test('"Actualiser tarifs" (edit mode) calls refreshToCurrentPricing', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({ reservationId: 7, editingReservationId: 7 });
  await user.click(screen.getByRole('button', { name: 'Actualiser tarifs' }));
  expect(ctx.refreshToCurrentPricing).toHaveBeenCalled();
});

// specs/reservation-payment-ledger.md rule 8 — « Marquer perçu » opens the inline form (today's date)
// and « Valider » hands the mark to the page's save-first pipeline.
test('the acompte row marks through the inline form, with today\'s date', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({ editingReservationId: 7, ledger: ledgerOf([dueRow('deposit', 'Acompte', 90)]) });
  await user.click(screen.getByRole('button', { name: /^Marquer perçu/ }));
  expect(screen.getByLabelText('Perçu le')).toHaveValue(new Date().toLocaleDateString('sv-SE'));
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.markFromLedger).toHaveBeenCalledWith(
    expect.objectContaining({ depositPaid: true, depositPaidDate: expect.any(String), expectedAmountCents: 9000 }),
  );
});

test('the caution row « Recevoir » records a reception date', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({
    editingReservationId: 7,
    ledger: ledgerOf([dueRow('cautionReceived', 'Caution reçue', 400, { action: { kind: 'mark', label: 'Recevoir', dateLabel: 'Reçue le' } })]),
  });
  await user.click(screen.getByRole('button', { name: /^Recevoir/ }));
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.markFromLedger).toHaveBeenCalledWith(expect.objectContaining({ cautionReceived: true, cautionReceivedDate: expect.any(String) }));
});
