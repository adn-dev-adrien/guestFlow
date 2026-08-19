import { vi } from 'vitest';
/**
 * « Indemnités d'annulation » card of the Comptabilité page (specs/cancellation-compensation.md
 * §6.3). Pins the two lists (banked this month / still pending), the read-only rendering for the
 * accountant role, and the encaissement flow.
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DialogProvider from '../DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getCancellationCompensations: vi.fn(),
    receiveCancellationCompensation: vi.fn(),
    updateCancellationCompensation: vi.fn(),
    createCancellationCompensation: vi.fn(),
    reopenCancellationCompensation: vi.fn(),
  },
}));

import api from '../../api';
import CancellationCompensationsSection from '../CancellationCompensationsSection';

const PAYLOAD = {
  pending: [{
    id: 1, status: 'pending', clientName: 'Claire Notin', propertyName: 'Le Lodge', platform: 'Airbnb',
    startDate: '2026-09-04', endDate: '2026-09-07', expectedAmount: 84, expectedDate: '2026-08-26',
    receivedAmount: null, receivedDate: null, overdue: true, notes: '',
  }],
  received: [{
    id: 2, status: 'received', clientName: 'Jean Dupont', propertyName: 'Le Lodge', platform: 'Booking',
    startDate: '2026-07-01', endDate: '2026-07-05', expectedAmount: 50, expectedDate: '2026-07-20',
    receivedAmount: 47.5, receivedDate: '2026-08-12', overdue: false, notes: '',
  }],
  totals: { pendingExpected: 84, receivedInMonth: 47.5 },
};

beforeEach(() => {
  api.getCancellationCompensations.mockReset();
  api.receiveCancellationCompensation.mockReset();
  api.getCancellationCompensations.mockResolvedValue(PAYLOAD);
  api.receiveCancellationCompensation.mockResolvedValue({ compensation: { id: 1, status: 'received' } });
});

const renderSection = (props = {}) => render(
  <DialogProvider><CancellationCompensationsSection month={8} year={2026} canEdit {...props} /></DialogProvider>,
);

test('lists what was banked this month and what is still expected, with both totals', async () => {
  renderSection();
  expect(await screen.findByText(/Jean Dupont/)).toBeInTheDocument();
  expect(screen.getByText(/Claire Notin/)).toBeInTheDocument();
  // Each amount shows twice with this fixture — once on its row, once in the section total.
  expect(screen.getAllByText('47,50 €')).toHaveLength(2);
  expect(screen.getAllByText('84,00 €')).toHaveLength(2);
  await waitFor(() => expect(api.getCancellationCompensations).toHaveBeenCalledWith(8, 2026));
});

test('a late payment is flagged « En retard »', async () => {
  renderSection();
  expect(await screen.findByText('En retard')).toBeInTheDocument();
});

test('the accountant sees the lists but no action button', async () => {
  renderSection({ canEdit: false });
  expect(await screen.findByText(/Jean Dupont/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /encaisser/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /rouvrir/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /ajouter/i })).not.toBeInTheDocument();
});

test('« Encaisser » posts the real amount and date, then reloads', async () => {
  const user = userEvent.setup();
  renderSection();
  await user.click(await screen.findByRole('button', { name: /encaisser/i }));

  const dialog = await screen.findByRole('dialog');
  // Pre-filled with the announced amount — the common case is « c'est bien ce montant ».
  expect(within(dialog).getByLabelText(/Montant versé/i)).toHaveValue('84');
  await user.click(within(dialog).getByRole('button', { name: 'Encaisser' }));

  await waitFor(() => expect(api.receiveCancellationCompensation).toHaveBeenCalled());
  const [id, payload] = api.receiveCancellationCompensation.mock.calls[0];
  expect(id).toBe(1);
  expect(payload.receivedAmount).toBe(84);
  expect(payload.receivedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await waitFor(() => expect(api.getCancellationCompensations).toHaveBeenCalledTimes(2));
});

test('an empty month says so instead of rendering empty tables', async () => {
  api.getCancellationCompensations.mockResolvedValue({ pending: [], received: [], totals: { pendingExpected: 0, receivedInMonth: 0 } });
  renderSection();
  expect(await screen.findByText(/Aucune indemnité encaissée ce mois-ci/i)).toBeInTheDocument();
  expect(screen.getByText(/Aucune indemnité en attente/i)).toBeInTheDocument();
});
