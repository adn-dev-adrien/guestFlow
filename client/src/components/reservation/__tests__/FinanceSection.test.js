import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';

jest.mock('../../../api', () => ({ __esModule: true, default: { markPayment: jest.fn() } }));

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

test('typing an adjusted price calls updateForm with the parsed customPrice', () => {
  const ctx = renderFinance();
  fireEvent.change(screen.getByLabelText('Prix ajusté'), { target: { value: '250' } });
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
  expect(ctx.updateForm).toHaveBeenCalledWith({ depositPaid: true });
});

test('the caution-received toggle calls updateForm with a reception date', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance();
  await user.click(screen.getByRole('button', { name: 'Marquer caution reçue' }));
  expect(ctx.updateForm).toHaveBeenCalledWith(
    expect.objectContaining({ cautionReceived: true })
  );
});
