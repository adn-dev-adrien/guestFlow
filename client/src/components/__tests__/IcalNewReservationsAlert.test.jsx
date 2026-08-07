/**
 * IcalNewReservationsAlert — dashboard card listing reservations imported via iCal today.
 * Renders nothing when empty; each row navigates to the reservation page on click.
 * See specs/dashboard-ical-new-reservations.md.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getIcalNewReservationsToday: vi.fn(),
  },
}));

const navigate = vi.fn();
vi.mock('react-router', () => ({
  __esModule: true,
  useNavigate: () => navigate,
}));

import api from '../../api';
import IcalNewReservationsAlert from '../IcalNewReservationsAlert';

beforeEach(() => {
  api.getIcalNewReservationsToday.mockReset();
  navigate.mockReset();
});

const row = (over = {}) => ({
  reservationId: 12087, clientName: 'Jean Dupont', propertyName: 'Gite',
  platformLabel: 'Airbnb', startDate: '2026-07-10', endDate: '2026-07-13',
  createdAt: '2026-06-08 09:14:22', ...over,
});

test('renders nothing while the API call is pending', () => {
  api.getIcalNewReservationsToday.mockReturnValue(new Promise(() => {}));
  const { container } = render(<IcalNewReservationsAlert />);
  expect(container.firstChild).toBeNull();
});

test('renders nothing when nothing was imported today', async () => {
  api.getIcalNewReservationsToday.mockResolvedValue({ alerts: [] });
  const { container } = render(<IcalNewReservationsAlert />);
  await waitFor(() => expect(api.getIcalNewReservationsToday).toHaveBeenCalled());
  expect(container.firstChild).toBeNull();
});

test('renders nothing on API error (never breaks the dashboard)', async () => {
  api.getIcalNewReservationsToday.mockRejectedValue(new Error('boom'));
  const { container } = render(<IcalNewReservationsAlert />);
  await waitFor(() => expect(api.getIcalNewReservationsToday).toHaveBeenCalled());
  expect(container.firstChild).toBeNull();
});

test('renders the card with the count + a row per reservation', async () => {
  api.getIcalNewReservationsToday.mockResolvedValue({ alerts: [row(), row({ reservationId: 12088, clientName: 'Marie Durand', platformLabel: 'Booking' })] });
  render(<IcalNewReservationsAlert />);
  expect(await screen.findByText(/2 importées aujourd'hui/i)).toBeInTheDocument();
  expect(screen.getByText(/Jean Dupont · Gite/)).toBeInTheDocument();
  expect(screen.getByText(/Marie Durand/)).toBeInTheDocument();
});

test('clicking a row navigates to the reservation page', async () => {
  const user = userEvent.setup();
  api.getIcalNewReservationsToday.mockResolvedValue({ alerts: [row()] });
  render(<IcalNewReservationsAlert />);
  await screen.findByText(/Jean Dupont · Gite/);
  await user.click(screen.getByText(/Jean Dupont · Gite/));
  expect(navigate).toHaveBeenCalledWith('/reservations/12087');
});
