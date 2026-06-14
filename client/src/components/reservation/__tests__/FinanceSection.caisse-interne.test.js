import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';
import { vi } from 'vitest';

import api from '../../../api';

// specs/cash-complement-and-endofstay-finance.md §3 — end-of-stay complement block + « Caisse interne »
// toggles. Regression guard so the fiche keeps wiring the right markPayment payloads.

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

beforeEach(() => { vi.clearAllMocks(); });

// ── End-of-stay complement block ────────────────────────────────────────────

test('end-of-stay complement block renders (amount + breakdown) when amount > 0', () => {
  renderFinance({
    editingReservationId: 7, reservationId: 7,
    form: {
      endOfStayComplementAmount: 88,
      endOfStayComplementDetail: JSON.stringify([{ label: 'Ménage', amount: 40 }, { label: 'Serviette', amount: 8 }]),
    },
  });
  expect(screen.getByText('Complément de fin de séjour')).toBeInTheDocument();
  expect(screen.getByText(/Ménage : 40,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Serviette : 8,00 €/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marquer complément payé' })).toBeInTheDocument();
});

test('end-of-stay complement block is hidden when amount = 0', () => {
  renderFinance({ editingReservationId: 7, form: { endOfStayComplementAmount: 0 } });
  expect(screen.queryByText('Complément de fin de séjour')).not.toBeInTheDocument();
});

test('end-of-stay « Marquer payé » persists endOfStayComplementPaid + date via markPayment', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({ editingReservationId: 7, reservationId: 7, form: { endOfStayComplementAmount: 88 } });
  await user.click(screen.getByRole('button', { name: 'Marquer complément payé' }));
  expect(api.markPayment).toHaveBeenCalledWith(7, expect.objectContaining({ endOfStayComplementPaid: true, endOfStayComplementPaidDate: expect.any(String) }));
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({ endOfStayComplementPaid: true }));
});

test('end-of-stay « Caisse interne » persists the flag (implies paid) via markPayment', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({ editingReservationId: 7, reservationId: 7, form: { endOfStayComplementAmount: 88 } });
  await user.click(screen.getByRole('button', { name: 'Caisse interne' }));
  expect(api.markPayment).toHaveBeenCalledWith(7, { endOfStayComplementPaidCash: true });
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({ endOfStayComplementPaidCash: true, endOfStayComplementPaid: true }));
});

// ── Arrival complement « Caisse interne » ───────────────────────────────────

test('arrival « Caisse interne » persists complementPaidCash (implies paid) via markPayment', async () => {
  const user = userEvent.setup();
  const ctx = renderFinance({
    editingReservationId: 7, reservationId: 7,
    pricingQuote: { complementAmount: 50 },
    form: { complementAmount: 50, complementPaid: false },
  });
  // Only the arrival complement block is present here (no end-of-stay amount) → single « Caisse interne ».
  await user.click(screen.getByRole('button', { name: 'Caisse interne' }));
  expect(api.markPayment).toHaveBeenCalledWith(7, { complementPaidCash: true });
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({ complementPaidCash: true, complementPaid: true }));
});

test('a caisse-interne complement shows the « hors compta » hint', () => {
  renderFinance({
    editingReservationId: 7,
    pricingQuote: { complementAmount: 50 },
    form: { complementAmount: 50, complementPaid: true, complementPaidCash: true },
  });
  expect(screen.getByText(/hors compta/i)).toBeInTheDocument();
});
