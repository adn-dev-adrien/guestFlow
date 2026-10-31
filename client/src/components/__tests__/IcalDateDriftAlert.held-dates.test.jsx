// server-test-isolation.md rule 11 — a « nothing shown » check first waits for the answer that could show it.
// specs/payment-link-lifecycle.md rule 39 — approving an iCal date drift onto nights another stay holds says so
// first, with the stays to open: « Approuver quand même » applies it, « Annuler » sends nothing. A free drift is
// approved at once, as before.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getIcalDateDriftAlert: vi.fn(), approveIcalDateDrift: vi.fn(), rejectIcalDateDrift: vi.fn() },
}));

import api from '../../api';
import IcalDateDriftAlert from '../IcalDateDriftAlert';

const ATTENTION = { key: 'ical-date-drift', severity: 'todo', count: 1, title: 'Dates iCal à approuver', detail: '1 changement' };
const BASE = {
  id: 5, reservationId: 90, clientName: 'Lina Exemple', propertyName: 'Logement', reservationExists: true,
  previousStartDate: '2099-03-01', previousEndDate: '2099-03-04', newStartDate: '2099-03-02', newEndDate: '2099-03-05', detectedAt: '2099-01-01 10:00:00',
};
const HELD = {
  title: 'Surbooking : Booking sur des dates réservées',
  message: 'Ces dates sont réservées par un autre séjour. Approuver crée un surbooking : annuler ensuite l’une des deux réservations.',
  stays: [{ id: 41, label: 'T41 · Ana Test · 02/03 → 04/03', url: '/reservations/41' }],
};

const renderCard = () => render(<MemoryRouter><DialogProvider><IcalDateDriftAlert attention={ATTENTION} /></DialogProvider></MemoryRouter>);

beforeEach(() => { api.approveIcalDateDrift.mockReset().mockResolvedValue({ ok: true }); });

test('onto held nights: the card says so, the dialog names the stays, « Annuler » approves nothing', async () => {
  api.getIcalDateDriftAlert.mockResolvedValue({ alerts: [{ ...BASE, heldDates: HELD }] });
  renderCard();
  expect(await screen.findByText('Sur des dates réservées par un autre séjour')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Approuver' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(HELD.title)).toBeInTheDocument();
  expect(within(dialog).getByRole('link', { name: `Ouvrir : ${HELD.stays[0].label}` })).toHaveAttribute('href', '/reservations/41');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));
  expect(api.approveIcalDateDrift).not.toHaveBeenCalled();
});

test('« Approuver quand même » applies the drift', async () => {
  api.getIcalDateDriftAlert.mockResolvedValue({ alerts: [{ ...BASE, heldDates: HELD }] });
  renderCard();
  await userEvent.click(await screen.findByRole('button', { name: 'Approuver' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Approuver quand même' }));
  await waitFor(() => expect(api.approveIcalDateDrift).toHaveBeenCalledWith(5));
});

test('a drift onto free nights is approved at once', async () => {
  let answer;
  api.approveIcalDateDrift.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
  api.getIcalDateDriftAlert.mockResolvedValue({ alerts: [{ ...BASE, heldDates: null }] });
  renderCard();
  await userEvent.click(await screen.findByRole('button', { name: 'Approuver' }));
  await waitFor(() => expect(api.approveIcalDateDrift).toHaveBeenCalledWith(5));
  await act(async () => { answer({ ok: true }); });
  expect(screen.queryByRole('dialog')).toBeNull();
});
