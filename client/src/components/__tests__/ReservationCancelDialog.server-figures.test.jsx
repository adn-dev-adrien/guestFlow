// specs/payment-schedule-and-cancellation.md rule 60 (audit R43-C-M1) — the cancel dialog renders the figures the server
// answers for the cancellation, never a sum worked out from the quote: a plan with one paid échéance read 0,00 € kept
// and 0,00 € written off, while the cancel kept 125 € and wrote 249,79 € off. While the figures load, the confirm
// waits; when the server refuses, the refusal is shown and the confirm stays off.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import ReservationCancelDialog from '../ReservationCancelDialog';
import api from '../../api';

vi.mock('../../api', () => ({ default: { getCancellationPreview: vi.fn() } }));

const ROW = {
  reservationId: 22327,
  clientName: 'Camille Test',
  clientEmail: '',
  propertyName: 'Gîte Test',
  startDate: '2026-09-18', // date-literal-ok: displayed only, never compared with today
  endDate: '2026-09-25', // date-literal-ok: displayed only, never compared with today
};

const renderDialog = () => render(<ReservationCancelDialog open row={ROW} onClose={vi.fn()} onConfirm={vi.fn()} />);
const confirmButton = () => screen.getByRole('button', { name: 'Annuler le séjour' });

beforeEach(() => api.getCancellationPreview.mockReset());

test('rule 60 — a plan with a paid échéance: the dialog shows the server\'s 125,00 € kept and 249,79 € written off', async () => {
  api.getCancellationPreview.mockResolvedValue({ cancellationReason: 'unpaid_balance', retainedDepositAmount: 125, indemnityAmount: 125, writtenOffBalance: 249.79 });
  renderDialog();
  expect(api.getCancellationPreview).toHaveBeenCalledWith(22327);
  expect(await screen.findByText('125,00 €')).toBeInTheDocument();
  expect(screen.getByText('249,79 €')).toBeInTheDocument();
  expect(screen.getByText(/requalifié en indemnité \(hors TVA\)/)).toBeInTheDocument();
  expect(confirmButton()).toBeEnabled();
});

test('rule 60 — while the figures load, no amount is shown and the confirm waits', async () => {
  let answer;
  api.getCancellationPreview.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  renderDialog();
  expect(confirmButton()).toBeDisabled();
  expect(screen.queryByText(/0,00 €/)).not.toBeInTheDocument();
  answer({ cancellationReason: 'manual', retainedDepositAmount: 0, indemnityAmount: 0, writtenOffBalance: 0 });
  await waitFor(() => expect(confirmButton()).toBeEnabled());
  expect(screen.getAllByText('0,00 €')).toHaveLength(2);
});

test('rule 60 — a refusal of the cancellation is shown and the confirm stays off', async () => {
  api.getCancellationPreview.mockRejectedValueOnce(new Error('Cette réservation est déjà annulée.'));
  renderDialog();
  expect(await screen.findByText('Cette réservation est déjà annulée.')).toBeInTheDocument();
  expect(confirmButton()).toBeDisabled();
  expect(screen.queryByText(/Conservé en indemnité/)).not.toBeInTheDocument();
});
