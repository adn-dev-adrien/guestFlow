// specs/booking-extranet-intake.md rules 22–24 — the dashboard lines of the Booking stays still to fill.
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { PENDING } from './intakeFixtures';

const api = vi.hoisted(() => ({ getBookingIntakePending: vi.fn(), dismissBookingIntakePending: vi.fn() }));
vi.mock('../../sdk', () => ({ api, displayDate: (iso) => iso.split('-').reverse().join('/') }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));

import PendingAlert from '../PendingAlert';
import UrgentPendingAlert from '../UrgentPendingAlert';

const renderIn = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
afterEach(() => vi.clearAllMocks());

test('specs/booking-extranet-intake.md rule 22: one line per stay with the property and the dates, and the three actions', async () => {
  api.getBookingIntakePending.mockResolvedValue(PENDING);
  renderIn(<PendingAlert />);
  expect(await screen.findByText('La Granja · 01/12/2026 → 03/12/2026')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Ouvrir dans Booking' });
  expect(link).toHaveAttribute('href', PENDING[1].extranetUrl);
  expect(link).toHaveAttribute('target', '_blank');
  await userEvent.click(screen.getByRole('button', { name: 'Ouvrir la fiche' }));
  expect(navigate).toHaveBeenCalledWith('/reservations/22310');
});

test('specs/booking-extranet-intake.md rule 23: « Pas une réservation Booking » dismisses the line and reloads the list', async () => {
  api.getBookingIntakePending.mockResolvedValueOnce([PENDING[1]]).mockResolvedValue([]);
  api.dismissBookingIntakePending.mockResolvedValue({ ok: true });
  renderIn(<PendingAlert />);
  await userEvent.click(await screen.findByRole('button', { name: 'Pas une réservation Booking' }));
  expect(api.dismissBookingIntakePending).toHaveBeenCalledWith(22310);
  await waitFor(() => expect(screen.queryByText(/La Granja/)).not.toBeInTheDocument());
});

test('specs/booking-extranet-intake.md rule 24: the urgent instance shows the stays arriving within a week, the other one the rest', async () => {
  api.getBookingIntakePending.mockResolvedValue(PENDING);
  renderIn(<UrgentPendingAlert />);
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText(/La Granja · 19\/10\/2026 → 21\/10\/2026 · arrivée dans 3 jours/)).toBeInTheDocument();
  expect(within(alert).queryByText(/01\/12\/2026/)).not.toBeInTheDocument();
  expect(within(alert).getByText('Réservations Booking à compléter, arrivée proche')).toBeInTheDocument();
});

test('specs/booking-extranet-intake.md rule 22: nothing to fill, nothing rendered', async () => {
  api.getBookingIntakePending.mockResolvedValue([]);
  const { container } = renderIn(<PendingAlert />);
  await waitFor(() => expect(api.getBookingIntakePending).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
