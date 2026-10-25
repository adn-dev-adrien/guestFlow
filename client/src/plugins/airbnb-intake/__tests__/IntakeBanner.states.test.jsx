// specs/airbnb-mail-intake.md rules 13–14 — applied, proposal, error, each with its Airbnb link.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { BASE } from './intakeFixtures';

const api = vi.hoisted(() => ({ getAirbnbIntakeForReservation: vi.fn(), applyAirbnbIntake: vi.fn(), dismissAirbnbIntake: vi.fn() }));
vi.mock('../../sdk', async () => ({ api, IntakeBanner: (await vi.importActual('../../../components/IntakeBanner')).default }));

import IntakeBanner from '../IntakeBanner';

afterEach(() => vi.clearAllMocks());

test('applied: names the mail, asks for the phone and e-mail, links to Airbnb, can be closed', async () => {
  api.getAirbnbIntakeForReservation.mockResolvedValueOnce({ intake: BASE }).mockResolvedValue({ intake: null });
  api.dismissAirbnbIntake.mockResolvedValue({ ok: true });
  render(<IntakeBanner reservationId={22326} />);
  expect(await screen.findByText(/Rempli depuis le mail Airbnb du 24\/10\. Téléphone et e-mail à reprendre sur Airbnb\./)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Voir sur Airbnb' })).toHaveAttribute('href', BASE.airbnbUrl);
  await userEvent.click(screen.getByRole('button', { name: /close/i }));
  expect(api.dismissAirbnbIntake).toHaveBeenCalledWith(3);
  await waitFor(() => expect(screen.queryByText(/Rempli depuis/)).not.toBeInTheDocument());
});

test('applied outside the platform tax mode: says the withheld box was left empty', async () => {
  api.getAirbnbIntakeForReservation.mockResolvedValue({ intake: { ...BASE, taxLeftEmpty: true } });
  render(<IntakeBanner reservationId={22326} />);
  expect(await screen.findByText('Taxe de séjour retenue laissée vide.')).toBeInTheDocument();
});

test('proposal on a fiche already edited: Appliquer writes and reloads the fiche', async () => {
  api.getAirbnbIntakeForReservation.mockResolvedValue({ intake: { ...BASE, status: 'proposed' } });
  api.applyAirbnbIntake.mockResolvedValue({ status: 'applied' });
  const onReservationChanged = vi.fn();
  render(<IntakeBanner reservationId={22326} onReservationChanged={onReservationChanged} />);
  expect(await screen.findByText(/\(HMTEST1234\) concerne cette fiche, déjà modifiée à la main/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
  expect(api.applyAirbnbIntake).toHaveBeenCalledWith(3);
  await waitFor(() => expect(onReservationChanged).toHaveBeenCalled());
});

test('error: shows the reason; a pending intake shows nothing', async () => {
  api.getAirbnbIntakeForReservation.mockResolvedValueOnce({ intake: { ...BASE, status: 'error', error: 'Séjour commencé ou passé' } });
  const { unmount } = render(<IntakeBanner reservationId={22326} />);
  expect(await screen.findByText(/n’a pas pu être appliqué : Séjour commencé ou passé/)).toBeInTheDocument();
  unmount();
  api.getAirbnbIntakeForReservation.mockResolvedValue({ intake: { ...BASE, status: 'pending' } });
  const { container } = render(<IntakeBanner reservationId={22326} />);
  await waitFor(() => expect(api.getAirbnbIntakeForReservation).toHaveBeenCalledTimes(2));
  expect(container).toBeEmptyDOMElement();
});
