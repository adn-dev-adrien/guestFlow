import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';

// specs/platform-tourist-tax-out-of-the-commission.md rule 25 — when the server refuses to mark the
// solde paid, the fiche says so and keeps the solde unpaid, instead of a button that does nothing.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn(), computePlatformCommission: vi.fn() } }));
import api from '../../../api';

test('a refused « Marquer solde payé » shows an error and leaves the solde unpaid', async () => {
  api.markPayment.mockRejectedValueOnce(new Error('Capture des contributions impossible'));
  const ctx = makeMockContext({ editingReservationId: 22291, form: { platform: 'Airbnb', balanceAmount: 844.87 } });
  render(
    <DialogProvider>
      <ReservationFormProvider value={ctx}>
        <FinanceSection />
      </ReservationFormProvider>
    </DialogProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: /Marquer solde payé/i }));
  expect(await screen.findByText('Paiement non enregistré')).toBeInTheDocument();
  await waitFor(() => expect(api.markPayment).toHaveBeenCalledTimes(1));
  expect(ctx.updateForm).not.toHaveBeenCalledWith(expect.objectContaining({ balancePaid: true }));
});
