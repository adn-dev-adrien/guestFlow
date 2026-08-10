import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';
import { vi } from 'vitest';

// specs/reservation-refunds.md §6 — le bloc « Remboursements » de la carte Finance : total cumulé,
// entrée « Nouveau remboursement », historique dépliable et suppression confirmée.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const REFUNDS = [
  {
    id: 3,
    refundDate: '2026-08-14',
    method: 'transfer',
    totalTtc: 24,
    reason: 'Départ anticipé — petits-déjeuners non pris',
    lines: [{ id: 11, label: 'Petit-déjeuner', bucket: 'options', amountTtc: 24 }],
  },
  {
    id: 2,
    refundDate: '2026-08-02',
    method: 'internal',
    totalTtc: 10,
    reason: '',
    lines: [{ id: 9, label: 'Geste commercial', bucket: 'options', amountTtc: 10 }],
  },
];

function renderFinance(overrides = {}) {
  const { form: formOverrides, ...rest } = overrides;
  const ctx = makeMockContext({
    editingReservationId: 7,
    reservationId: 7,
    form: { startDate: '2026-08-10', endDate: '2026-08-17', ...formOverrides },
    ...rest,
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

beforeEach(() => { vi.clearAllMocks(); });

test('le bloc est présent sur une réservation, avec le bouton d’entrée', () => {
  renderFinance();
  expect(screen.getByText('Remboursements')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '+ Nouveau remboursement' })).toBeInTheDocument();
});

test('un devis n’a pas de bloc remboursement', () => {
  renderFinance({ isDevisMode: true, editingReservationId: null });
  expect(screen.queryByText('Remboursements')).not.toBeInTheDocument();
});

test('le total cumulé est affiché, caisse interne comprise', () => {
  renderFinance({ refunds: REFUNDS, refundTotals: { book: 24, withCash: 34 } });
  expect(screen.getByText('(− 34,00 €)')).toBeInTheDocument();
});

test('l’historique se déplie avec date, moyen, lignes et motif', async () => {
  const user = userEvent.setup();
  renderFinance({ refunds: REFUNDS, refundTotals: { book: 24, withCash: 34 } });

  await user.click(screen.getByRole('button', { name: /Voir l'historique \(2 remboursements\)/ }));

  expect(screen.getByText(/14\/08\/2026 — 24,00 € — Virement/)).toBeInTheDocument();
  expect(screen.getByText(/02\/08\/2026 — 10,00 € — Caisse interne/)).toBeInTheDocument();
  expect(screen.getByText('Petit-déjeuner : − 24,00 €')).toBeInTheDocument();
  expect(screen.getByText('« Départ anticipé — petits-déjeuners non pris »')).toBeInTheDocument();
});

test('supprimer un remboursement demande confirmation puis appelle deleteRefund', async () => {
  const user = userEvent.setup();
  const deleteRefund = vi.fn();
  renderFinance({ refunds: [REFUNDS[0]], refundTotals: { book: 24, withCash: 24 }, deleteRefund });

  await user.click(screen.getByRole('button', { name: /Voir l'historique/ }));
  await user.click(screen.getByRole('button', { name: 'Supprimer ce remboursement' }));

  expect(await screen.findByText('Supprimer ce remboursement ?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Confirmer|Supprimer|OK/i }));
  await waitFor(() => expect(deleteRefund).toHaveBeenCalledWith(3));
});

test('« Nouveau remboursement » ouvre la fenêtre', async () => {
  const user = userEvent.setup();
  const setRefundDialogOpen = vi.fn();
  renderFinance({ setRefundDialogOpen });
  await user.click(screen.getByRole('button', { name: '+ Nouveau remboursement' }));
  expect(setRefundDialogOpen).toHaveBeenCalledWith(true);
});
