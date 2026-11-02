import { vi } from 'vitest';
/**
 * specs/reservation-refunds.md rule 48, reading of 2026-11-02 (review of #925): a kept acompte's card records what
 * the cancellation kept; refunds reduce the indemnity in the journal only. Reopening a card whose stay already gave
 * part of it back warns that it is re-received at the same amount — a lower one would count the reduction twice.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getCancellationCompensations: vi.fn(),
    reopenCancellationCompensation: vi.fn(),
  },
}));

import api from '../../api';
import CancellationCompensationsSection from '../CancellationCompensationsSection';

const card = (extra) => ({
  id: 2, status: 'received', origin: 'retained_deposit', reservationId: 10, clientName: 'Jean Dupont',
  propertyName: 'Le Lodge', platform: 'Direct', startDate: '2026-07-01', endDate: '2026-07-05',
  expectedAmount: 2060, expectedDate: '2026-08-12', receivedAmount: 2060, receivedDate: '2026-08-12', overdue: false, notes: '',
  ...extra,
});
const payload = (received) => ({ pending: [], received: [received], totals: { pendingExpected: 0, receivedInMonth: 2060 } });

const renderSection = () => render(
  <MemoryRouter>
    <DialogProvider><CancellationCompensationsSection month={8} year={2026} canEdit /></DialogProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  api.getCancellationCompensations.mockReset();
  api.reopenCancellationCompensation.mockReset();
});

test('reopening a card whose indemnity refunds already reduced says to re-receive it at the same amount', async () => {
  api.getCancellationCompensations.mockResolvedValue(payload(card({ indemnityRefundedTtc: 500 })));
  const user = userEvent.setup();
  renderSection();
  await user.click((await screen.findAllByRole('button', { name: /rouvrir/i }))[0]);
  expect(await screen.findByText(/Déjà réduite de 500,00\s€ par des remboursements : la ré-encaisser au même montant\./)).toBeInTheDocument();
});

test('a card no refund touched keeps the plain reopen message', async () => {
  api.getCancellationCompensations.mockResolvedValue(payload(card({ indemnityRefundedTtc: 0 })));
  const user = userEvent.setup();
  renderSection();
  await user.click((await screen.findAllByRole('button', { name: /rouvrir/i }))[0]);
  expect(await screen.findByText(/Elle repasse en attente\./)).toBeInTheDocument();
  expect(screen.queryByText(/Déjà réduite/)).not.toBeInTheDocument();
});
