// specs/payment-schedule-and-cancellation.md §6 (audit R44-C-L1) — the fiche hands the dialog a fresh `row` object on
// every render, and a failed cancel re-renders it: the dialog then cleared the reason and re-ticked « Prévenir le
// client », so a retry mailed a guest the operator had chosen not to notify. The form now starts over only when the
// dialog opens.
import React, { useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import ReservationCancelDialog from '../ReservationCancelDialog';
import api from '../../api';

vi.mock('../../api', () => ({ default: { getCancellationPreview: vi.fn() } }));

beforeEach(() => {
  api.getCancellationPreview.mockReset();
  api.getCancellationPreview.mockResolvedValue({ cancellationReason: 'unpaid_balance', retainedDepositAmount: 100, indemnityAmount: 100, writtenOffBalance: 300 });
});

// The fiche's own way: a row literal rebuilt on each render, `busy` toggled around a confirm that fails.
function Host({ onConfirm, open = true }) {
  const [busy, setBusy] = useState(false);
  return (
    <ReservationCancelDialog
      open={open}
      busy={busy}
      row={{ reservationId: 7, clientName: 'Client Test', clientEmail: 'client@example.invalid', startDate: '', endDate: '' }}
      onClose={() => {}}
      onConfirm={async (payload) => {
        setBusy(true);
        try { await onConfirm(payload); } catch { /* the fiche shows « Annulation impossible » */ } finally { setBusy(false); }
      }}
    />
  );
}

test('a failed confirm keeps the reason and the unticked « Prévenir le client »; the retry sends the same choice', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn().mockRejectedValueOnce(new Error('Service indisponible')).mockResolvedValueOnce({ ok: true });
  render(<Host onConfirm={onConfirm} />);
  await screen.findByText('100,00 €');

  await user.type(screen.getByLabelText('Motif'), 'Appel sans suite');
  const box = screen.getByRole('checkbox');
  expect(box).toBeChecked();
  await user.click(box);
  await user.click(screen.getByRole('button', { name: 'Annuler le séjour' }));
  await act(async () => {});

  expect(onConfirm).toHaveBeenNthCalledWith(1, { reason: 'Appel sans suite', notifyClient: false });
  expect(screen.getByLabelText('Motif')).toHaveValue('Appel sans suite');
  expect(screen.getByRole('checkbox')).not.toBeChecked();

  await user.click(screen.getByRole('button', { name: 'Annuler le séjour' }));
  expect(onConfirm).toHaveBeenNthCalledWith(2, { reason: 'Appel sans suite', notifyClient: false });
});

test('closing then opening again starts a fresh form', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<Host onConfirm={vi.fn()} />);
  await screen.findByText('100,00 €');
  await user.type(screen.getByLabelText('Motif'), 'Brouillon');
  await user.click(screen.getByRole('checkbox'));

  rerender(<Host onConfirm={vi.fn()} open={false} />);
  rerender(<Host onConfirm={vi.fn()} open />);
  await screen.findByText('100,00 €');
  expect(screen.getByLabelText('Motif')).toHaveValue('');
  expect(screen.getByRole('checkbox')).toBeChecked();
});
