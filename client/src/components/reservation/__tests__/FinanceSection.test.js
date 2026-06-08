import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';
import { vi } from 'vitest';

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

function renderFinance(overrides) {
  const ctx = makeMockContext(overrides);
  render(
    <ReservationFormProvider value={ctx}>
      <FinanceSection />
    </ReservationFormProvider>
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

test('the deposit-paid toggle calls updateForm when the reservation is not locked', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance();
  await user.click(screen.getByRole('button', { name: 'Marquer acompte payé' }));
  // The toggle records today's date as `depositPaidDate` alongside the flip, so the accounting
  // export has an encaissement date to pin against (see FinanceSection.js).
  expect(ctx.updateForm).toHaveBeenCalledWith(
    expect.objectContaining({ depositPaid: true, depositPaidDate: expect.any(String) }),
  );
});

test('the caution-received toggle calls updateForm with a reception date', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance();
  await user.click(screen.getByRole('button', { name: 'Marquer caution reçue' }));
  expect(ctx.updateForm).toHaveBeenCalledWith(
    expect.objectContaining({ cautionReceived: true })
  );
});
