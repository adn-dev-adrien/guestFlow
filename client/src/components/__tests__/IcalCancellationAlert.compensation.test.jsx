import { vi } from 'vitest';
/**
 * Approving an iCal cancellation now asks whether the platform owes an indemnity for the cancelled
 * stay (specs/cancellation-compensation.md §3.2). Two things must stay true:
 *   - the default answer is « Aucune indemnité », and it approves exactly like before (no payload);
 *   - declaring one sends the block, and the card only disappears once the server confirmed — the
 *     compensation is created in the same transaction as the deletion.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DialogProvider from '../DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getIcalCancellationAlert: vi.fn(),
    approveIcalCancellation: vi.fn(),
    rejectIcalCancellation: vi.fn(),
  },
}));

const navigate = vi.fn();
vi.mock('react-router', () => ({
  __esModule: true,
  useNavigate: () => navigate,
}));

import api from '../../api';
import IcalCancellationAlert from '../IcalCancellationAlert';

const ALERT = {
  id: 8,
  reservationId: 12345,
  clientName: 'Claire Notin',
  propertyName: 'Le Lodge',
  sourceName: 'Airbnb',
  startDate: '2026-09-04',
  endDate: '2026-09-07',
  detectedAt: '2026-08-19 09:00:00',
  reservationExists: true,
};

beforeEach(() => {
  api.getIcalCancellationAlert.mockReset();
  api.approveIcalCancellation.mockReset();
  api.getIcalCancellationAlert.mockResolvedValue({ alerts: [ALERT] });
  api.approveIcalCancellation.mockResolvedValue({ ok: true, outcome: 'approved', compensationId: null });
});

const renderAlert = () => render(<DialogProvider><IcalCancellationAlert /></DialogProvider>);

test('« Supprimer » no longer deletes straight away — it asks about the indemnity first', async () => {
  const user = userEvent.setup();
  renderAlert();
  await user.click(await screen.findByRole('button', { name: 'Supprimer' }));
  expect(await screen.findByText(/indemnité attendue \?/i)).toBeInTheDocument();
  expect(api.approveIcalCancellation).not.toHaveBeenCalled();
});

test('the default answer approves with no compensation payload (legacy behaviour)', async () => {
  const user = userEvent.setup();
  renderAlert();
  await user.click(await screen.findByRole('button', { name: 'Supprimer' }));
  await user.click(await screen.findByRole('button', { name: 'Valider' }));
  await waitFor(() => expect(api.approveIcalCancellation).toHaveBeenCalledWith(8, null));
  await waitFor(() => expect(screen.queryByText(/Claire Notin/)).not.toBeInTheDocument());
});

test('declaring an indemnity sends the amount and the expected date', async () => {
  const user = userEvent.setup();
  renderAlert();
  await user.click(await screen.findByRole('button', { name: 'Supprimer' }));
  await user.click(await screen.findByRole('radio', { name: /indemnité attendue/i }));

  const amount = screen.getByLabelText(/Montant attendu/i);
  await user.type(amount, '84');
  await user.tab(); // ArithmeticTextField commits on blur
  await user.click(screen.getByRole('button', { name: 'Valider' }));

  await waitFor(() => expect(api.approveIcalCancellation).toHaveBeenCalled());
  const [id, compensation] = api.approveIcalCancellation.mock.calls[0];
  expect(id).toBe(8);
  expect(compensation.expectedAmount).toBe(84);
});

test('a failing approval keeps the card — nothing was deleted server-side', async () => {
  const user = userEvent.setup();
  api.approveIcalCancellation.mockRejectedValue(new Error('Suppression impossible.'));
  renderAlert();
  await user.click(await screen.findByRole('button', { name: 'Supprimer' }));
  await user.click(await screen.findByRole('button', { name: 'Valider' }));
  await waitFor(() => expect(api.approveIcalCancellation).toHaveBeenCalled());
  // The card survives (its « Voir la fiche » action is still there) and the dialog stays open so
  // the operator can retry — the name now appears twice, hence the getAllByText.
  // Queried by text, not by role: the open dialog marks the background aria-hidden.
  expect(screen.getByText('Voir la fiche')).toBeInTheDocument();
  // Regex matcher: the card's line reads « Claire Notin · Le Lodge » in a single element.
  expect(screen.getAllByText(/Claire Notin/).length).toBeGreaterThan(0);
});
