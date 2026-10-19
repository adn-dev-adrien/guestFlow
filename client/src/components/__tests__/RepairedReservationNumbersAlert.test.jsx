import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RepairedReservationNumbersAlert from '../RepairedReservationNumbersAlert';
import api from '../../api';

// specs/reservation-number-and-search.md rule 15 — les séjours restés sans numéro, numérotés au
// démarrage, restent sur le tableau de bord jusqu'à « Vu ».

const mockNavigate = vi.fn();
vi.mock('react-router', async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => mockNavigate }));
vi.mock('../../api', () => ({
  __esModule: true,
  default: { getRepairedReservationNumbers: vi.fn(), acknowledgeRepairedReservationNumber: vi.fn() },
}));

const ROW = {
  reservationId: 42, reservationNumber: '202610007', clientName: 'Jean Dupont', propertyName: 'Gîte',
  startDate: '2027-06-20', endDate: '2027-06-22', repairedAt: '2026-10-18 15:00:00',
};

beforeEach(() => { vi.clearAllMocks(); });

test('rien à vérifier : la carte ne s’affiche pas', async () => {
  api.getRepairedReservationNumbers.mockResolvedValue({ alerts: [] });
  const { container } = render(<RepairedReservationNumbersAlert />);
  await waitFor(() => expect(api.getRepairedReservationNumbers).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test('une réservation renumérotée s’affiche, s’ouvre, et « Vu » la retire', async () => {
  api.getRepairedReservationNumbers.mockResolvedValue({ alerts: [ROW] });
  api.acknowledgeRepairedReservationNumber.mockResolvedValue({ ok: true });
  render(<RepairedReservationNumbersAlert />);
  expect(await screen.findByText(/1 réservation restée sans numéro/)).toBeInTheDocument();
  await userEvent.click(screen.getByText(/N° 202610007 · Jean Dupont · Gîte/));
  expect(mockNavigate).toHaveBeenCalledWith('/reservations/42');
  await userEvent.click(screen.getByRole('button', { name: 'Vu' }));
  expect(api.acknowledgeRepairedReservationNumber).toHaveBeenCalledWith(42);
  await waitFor(() => expect(screen.queryByText(/restée sans numéro/)).not.toBeInTheDocument());
});

test('une erreur de chargement n’affiche rien', async () => {
  api.getRepairedReservationNumbers.mockRejectedValue(new Error('boom'));
  const { container } = render(<RepairedReservationNumbersAlert />);
  await waitFor(() => expect(api.getRepairedReservationNumbers).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
