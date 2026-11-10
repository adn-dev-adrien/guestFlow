// specs/payment-schedule-and-cancellation.md rule 60, reading of 2026-11-10 (audits R45-C-L1 = R45-RES-L2) — on an
// acompte collected in the caisse interne the dialog read « Conservé en indemnité : 0,00 € » while the notice it sends
// tells the guest 180 € are kept. The dialog now shows the sum the notice states (`keptFromGuest`, from the server's
// preview) whenever it differs from the indemnity.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import ReservationCancelDialog from '../ReservationCancelDialog';
import api from '../../api';

vi.mock('../../api', () => ({ default: { getCancellationPreview: vi.fn() } }));

const ROW = {
  reservationId: 22328,
  clientName: 'Camille Test',
  clientEmail: 'camille@example.invalid',
  propertyName: 'Gîte Test',
  startDate: '2026-09-18', // date-literal-ok: displayed only, never compared with today
  endDate: '2026-09-25', // date-literal-ok: displayed only, never compared with today
};

const renderDialog = () => render(<ReservationCancelDialog open row={ROW} onClose={vi.fn()} onConfirm={vi.fn()} />);
const keptLine = () => screen.queryByText(/Somme conservée \(indiquée au client\)/);

beforeEach(() => api.getCancellationPreview.mockReset());

test('rule 60 reading — a caisse acompte: 0,00 € in indemnity, and the 180,00 € the notice states', async () => {
  api.getCancellationPreview.mockResolvedValue({
    cancellationReason: 'unpaid_balance', retainedDepositAmount: 0, indemnityAmount: 0, keptFromGuest: 180, writtenOffBalance: 543.12,
  });
  renderDialog();
  expect(await screen.findByText('180,00 €')).toBeInTheDocument();
  expect(keptLine()).toBeInTheDocument();
  expect(screen.getByText('0,00 €')).toBeInTheDocument();
});

test('rule 60 reading — a caisse refund before: the net sum the notice states', async () => {
  api.getCancellationPreview.mockResolvedValue({
    cancellationReason: 'unpaid_balance', retainedDepositAmount: 0, indemnityAmount: 0, keptFromGuest: 130, writtenOffBalance: 543.12,
  });
  renderDialog();
  expect(await screen.findByText('130,00 €')).toBeInTheDocument();
});

test('rule 60 reading — the sum the notice states is the indemnity: one line, never twice', async () => {
  api.getCancellationPreview.mockResolvedValue({
    cancellationReason: 'unpaid_balance', retainedDepositAmount: 125, indemnityAmount: 125, keptFromGuest: 125, writtenOffBalance: 249.79,
  });
  renderDialog();
  expect(await screen.findByText('125,00 €')).toBeInTheDocument();
  expect(keptLine()).not.toBeInTheDocument();
});
