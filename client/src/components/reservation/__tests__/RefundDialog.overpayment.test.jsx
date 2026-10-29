import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RefundDialog from '../RefundDialog';
import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from './mockReservationForm';

// specs/reservation-refunds.md rule 34 — le trop-perçu calculé par le serveur : alerte sur la fiche
// avec « Rembourser », et la fenêtre de remboursement pré-remplie sur ce montant.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

function renderFinance(overrides = {}) {
  const ctx = makeMockContext({
    editingReservationId: 7,
    reservationId: 7,
    form: { startDate: '2026-08-10', endDate: '2026-08-17' },
    ...overrides,
  });
  render(
    <DialogProvider>
      <ReservationFormProvider value={ctx}>
        <FinanceSection />
      </ReservationFormProvider>
    </DialogProvider>,
  );
  return ctx;
}

test('sans trop-perçu, aucune alerte', () => {
  renderFinance({ refundOverpaymentTtc: 0 });
  expect(screen.queryByText(/Trop-perçu/)).not.toBeInTheDocument();
});

test('un trop-perçu s’affiche avec son montant et « Rembourser » ouvre la fenêtre sur ce montant', async () => {
  // specs/reservation-payment-ledger.md rule 2 — the trop-perçu is a ledger row, shaped by the server.
  const ctx = renderFinance({ refundOverpaymentTtc: 133.2, ledger: { rows: [{ key: 'overpayment', label: 'Trop-perçu', amount: 133.2, state: 'due', tone: 'warning', stateLabel: 'À rembourser',
    action: { kind: 'refund', label: 'Rembourser' }, amountEdit: { editable: false, mode: 'none', min: null, max: null, reason: null },
    detail: { lines: [] } }], closing: null } });
  expect(screen.getByText('Trop-perçu')).toBeInTheDocument();
  expect(screen.getByText(/133,20/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Rembourser/ }));
  expect(ctx.setRefundDialogOpen).toHaveBeenCalledWith({ overpaymentTtc: 133.2, overpaymentLines: [] });
});

test('la fenêtre ouverte sur un trop-perçu porte une ligne libre « Trop-perçu » à ce montant', async () => {
  const onSubmit = vi.fn();
  render(<RefundDialog open onClose={vi.fn()} refundableLines={[]} collectedTtc={798.2} overpaymentTtc={133.2} onSubmit={onSubmit} />);
  expect(screen.getByDisplayValue('Trop-perçu')).toBeInTheDocument();
  expect(screen.getByDisplayValue('133,20')).toBeInTheDocument();
});

test('ouverte sans trop-perçu, la fenêtre n’a aucune ligne libre', () => {
  render(<RefundDialog open onClose={vi.fn()} refundableLines={[]} collectedTtc={100} onSubmit={vi.fn()} />);
  expect(screen.queryByDisplayValue('Trop-perçu')).not.toBeInTheDocument();
});

test('le moyen par défaut est le virement ; un trop-perçu pris « caisse interne » ouvre sur ce moyen, modifiable (2026-10-29)', async () => {
  const props = { open: true, onClose: vi.fn(), refundableLines: [], collectedTtc: 100, overpaymentTtc: 21, onSubmit: vi.fn() };
  const { unmount } = render(<RefundDialog {...props} />);
  expect(screen.getByRole('radio', { name: /Virement/ })).toBeChecked();
  unmount();
  render(<RefundDialog {...props} defaultMethod="internal" />);
  expect(screen.getByRole('radio', { name: /Caisse interne/ })).toBeChecked();
  await userEvent.click(screen.getByRole('radio', { name: /Virement/ }));
  expect(screen.getByRole('radio', { name: /Virement/ })).toBeChecked();
});
