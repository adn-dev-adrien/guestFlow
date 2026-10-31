// server-test-isolation.md rule 11 — a « nothing shown » check first waits for the answer that could show it.
// specs/booking-extranet-intake.md rules 17–18 — the banner of the fiche: filled from the extranet, or a
// proposal on a fiche that was already filled.
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { APPLIED, PROPOSED } from './intakeFixtures';

const api = vi.hoisted(() => ({
  getBookingIntakeForReservation: vi.fn(), applyBookingIntake: vi.fn(), ignoreBookingIntake: vi.fn(), hideBookingIntake: vi.fn(),
}));
vi.mock('../../sdk', async () => ({ api, IntakeBanner: (await vi.importActual('../../../components/IntakeBanner')).default }));

import IntakeBanner from '../IntakeBanner';

afterEach(() => vi.clearAllMocks());

test('specs/booking-extranet-intake.md rule 18: applied — says when the fiche was filled, and Masquer hides the banner', async () => {
  api.getBookingIntakeForReservation.mockResolvedValueOnce({ intake: APPLIED }).mockResolvedValue({ intake: null });
  api.hideBookingIntake.mockResolvedValue({ ok: true });
  render(<IntakeBanner reservationId={22309} />);
  expect(await screen.findByText(/Rempli depuis l’extranet Booking le 15\/10 à 15:52\./)).toBeInTheDocument();
  expect(screen.queryByText(/sans réponse/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /close/i }));
  expect(api.hideBookingIntake).toHaveBeenCalledWith(4);
  await waitFor(() => expect(screen.queryByText(/Rempli depuis/)).not.toBeInTheDocument());
});

test('specs/booking-extranet-intake.md rule 18: a guest message still unanswered on Booking is mentioned', async () => {
  api.getBookingIntakeForReservation.mockResolvedValue({ intake: { ...APPLIED, guestMessagePending: true } });
  render(<IntakeBanner reservationId={22309} />);
  expect(await screen.findByText('Message client sans réponse sur Booking.')).toBeInTheDocument();
});

test('specs/booking-extranet-intake.md rule 17: a proposal lists old → new for each difference; Appliquer writes and reloads the fiche', async () => {
  api.getBookingIntakeForReservation.mockResolvedValue({ intake: PROPOSED });
  api.applyBookingIntake.mockResolvedValue({ status: 'applied' });
  const reload = vi.fn();
  render(<IntakeBanner reservationId={22309} onReservationChanged={reload} />);
  expect(await screen.findByText('La page Booking propose 3 valeurs différentes de la fiche.')).toBeInTheDocument();
  expect(screen.getByText('Adultes : 8 → 10')).toBeInTheDocument();
  expect(screen.getByText('Virement reçu : vide → 606.44')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
  expect(api.applyBookingIntake).toHaveBeenCalledWith(5);
  await waitFor(() => expect(reload).toHaveBeenCalled());
});

test('specs/booking-extranet-intake.md rule 17: Ignorer drops the proposal without touching the fiche', async () => {
  api.getBookingIntakeForReservation.mockResolvedValue({ intake: PROPOSED });
  api.ignoreBookingIntake.mockResolvedValue({ ok: true });
  const reload = vi.fn();
  render(<IntakeBanner reservationId={22309} onReservationChanged={reload} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Ignorer' }));
  expect(api.ignoreBookingIntake).toHaveBeenCalledWith(5);
  expect(reload).not.toHaveBeenCalled();
});

test('specs/booking-extranet-intake.md rule 17: a refused Appliquer shows the reason in the banner', async () => {
  api.getBookingIntakeForReservation.mockResolvedValue({ intake: PROPOSED });
  api.applyBookingIntake.mockRejectedValue(new Error('Capacité dépassée'));
  render(<IntakeBanner reservationId={22309} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Appliquer' }));
  expect(await screen.findByText('Capacité dépassée')).toBeInTheDocument();
});

test('specs/booking-extranet-intake.md rule 18: nothing to say, nothing rendered', async () => {
  api.getBookingIntakeForReservation.mockResolvedValue({ intake: null });
  const { container } = render(<IntakeBanner reservationId={22309} />);
  await act(() => api.getBookingIntakeForReservation.mock.results.at(-1).value);
  expect(container).toBeEmptyDOMElement();
});
