/**
 * NewReservationsAlert — dashboard card listing every reservation created during the last 24 hours.
 * Renders nothing when empty; each row navigates to the reservation page on click; refetches every
 * 5 minutes. See specs/dashboard-ical-new-reservations.md (amended 2026-10-06).
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getNewReservations: vi.fn(),
  },
}));

const navigate = vi.fn();
vi.mock('react-router', () => ({
  __esModule: true,
  useNavigate: () => navigate,
}));

import api from '../../api';
import NewReservationsAlert from '../NewReservationsAlert';

beforeEach(() => {
  api.getNewReservations.mockReset();
  navigate.mockReset();
});

const row = (over = {}) => ({
  reservationId: 12087, clientName: 'Jean Dupont', propertyName: 'Gite',
  platformLabel: 'Airbnb', startDate: '2026-07-10', endDate: '2026-07-13',
  createdAt: '2026-06-08 09:14:22', ...over,
});

test('renders nothing while the API call is pending', () => {
  api.getNewReservations.mockReturnValue(new Promise(() => {}));
  const { container } = render(<NewReservationsAlert />);
  expect(container.firstChild).toBeNull();
});

test('renders nothing when no reservation arrived in the last 24 hours', async () => {
  api.getNewReservations.mockResolvedValue({ alerts: [] });
  const { container } = render(<NewReservationsAlert />);
  await waitFor(() => expect(api.getNewReservations).toHaveBeenCalled());
  expect(container.firstChild).toBeNull();
});

test('renders nothing on API error (never breaks the dashboard)', async () => {
  api.getNewReservations.mockRejectedValue(new Error('boom'));
  const { container } = render(<NewReservationsAlert />);
  await waitFor(() => expect(api.getNewReservations).toHaveBeenCalled());
  expect(container.firstChild).toBeNull();
});

test('renders the card with the count + a row per reservation', async () => {
  api.getNewReservations.mockResolvedValue({ alerts: [row(), row({ reservationId: 12088, clientName: 'Marie Durand', platformLabel: 'Booking' })] });
  render(<NewReservationsAlert />);
  expect(await screen.findByText(/Nouvelles réservations — 2 sur les dernières 24 h/)).toBeInTheDocument();
  expect(screen.getAllByText(/^Arrivée /)).toHaveLength(2);
  expect(screen.getByText(/Jean Dupont · Gite/)).toBeInTheDocument();
  expect(screen.getByText(/Marie Durand/)).toBeInTheDocument();
});

test('clicking a row navigates to the reservation page', async () => {
  const user = userEvent.setup();
  api.getNewReservations.mockResolvedValue({ alerts: [row()] });
  render(<NewReservationsAlert />);
  await screen.findByText(/Jean Dupont · Gite/);
  await user.click(screen.getByText(/Jean Dupont · Gite/));
  expect(navigate).toHaveBeenCalledWith('/reservations/12087');
});

test('refetches every 5 minutes so the list follows the 24-hour window', async () => {
  vi.useFakeTimers();
  try {
    api.getNewReservations.mockResolvedValueOnce({ alerts: [row()] }).mockResolvedValueOnce({ alerts: [] });
    const { container } = render(<NewReservationsAlert />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Jean Dupont · Gite/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    expect(api.getNewReservations).toHaveBeenCalledTimes(2);
    expect(container.firstChild).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
