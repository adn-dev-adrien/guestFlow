import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RefundDialog from '../RefundDialog';
import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';

// specs/reservation-refunds.md rule 35 — le trop-perçu réparti par poste par le serveur : la fiche dit
// d'où il vient (taxe recalculée comprise), et la fenêtre de remboursement ouvre une ligne par poste.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const TAX_ONLY = [{ bucket: 'touristTax', label: 'Taxe de séjour', amountTtc: 14.4, collectedTtc: 21.6, dueTtc: 7.2 }];

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

test('l’alerte montre la taxe encaissée et la taxe recalculée', async () => {
  const ctx = renderFinance({ refundOverpaymentTtc: 14.4, refundOverpaymentLines: TAX_ONLY });
  const alert = screen.getByRole('alert');
  expect(within(alert).getByText(/Trop-perçu : 14,40/)).toBeInTheDocument();
  expect(within(alert).getByText('Taxe de séjour : 21,60 € encaissés, 7,20 € dus')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Rembourser' }));
  expect(ctx.setRefundDialogOpen).toHaveBeenCalledWith({ overpaymentTtc: 14.4, overpaymentLines: TAX_ONLY });
});

test('un trop-perçu venu de la taxe s’ouvre sur une ligne « Taxe de séjour », pas « Hébergement »', async () => {
  const onSubmit = vi.fn().mockResolvedValue();
  render(<RefundDialog open onClose={vi.fn()} refundableLines={[]} collectedTtc={329.6} overpaymentTtc={14.4} overpaymentLines={TAX_ONLY} onSubmit={onSubmit} />);
  expect(screen.getByText('Taxe de séjour')).toBeInTheDocument();
  expect(screen.queryByText('Hébergement')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
  expect(onSubmit.mock.calls[0][0].lines).toEqual([{ label: 'Trop-perçu', bucket: 'touristTax', amountTtc: 14.4 }]);
});

test('plusieurs postes en excès : une ligne chacun', () => {
  render(
    <RefundDialog
      open
      onClose={vi.fn()}
      refundableLines={[]}
      collectedTtc={500}
      overpaymentTtc={50}
      overpaymentLines={[
        { bucket: 'options', label: 'Prestations complémentaires', amountTtc: 40, collectedTtc: 60, dueTtc: 20 },
        { bucket: 'touristTax', label: 'Taxe de séjour', amountTtc: 10, collectedTtc: 15, dueTtc: 5 },
      ]}
      onSubmit={vi.fn()}
    />,
  );
  expect(screen.getAllByDisplayValue('Trop-perçu')).toHaveLength(2);
  expect(screen.getByDisplayValue('40')).toBeInTheDocument();
  expect(screen.getByDisplayValue('10')).toBeInTheDocument();
});
