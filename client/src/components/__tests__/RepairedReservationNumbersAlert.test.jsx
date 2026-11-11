// server-test-isolation.md rule 11 — a « nothing shown » check first waits for the answer that could show it.
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RepairedReservationNumbersAlert from '../RepairedReservationNumbersAlert';
import api from '../../api';

// The home's subject this card draws (specs/shell-and-home-day-first.md rule 6 — server-made).
const ATTENTION = { key: 'repaired-reservation-numbers', severity: 'todo', count: 1, title: 'Réservations restées sans numéro', detail: 'Un séjour fantôme bloque ses dates : vérifier qu’il s’agit d’un vrai séjour.' };

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
  const { container } = render(<RepairedReservationNumbersAlert attention={ATTENTION} />);
  await act(() => api.getRepairedReservationNumbers.mock.results.at(-1).value);
  expect(container).toBeEmptyDOMElement();
});

test('une réservation renumérotée s’affiche, s’ouvre, et « Vu » la retire', async () => {
  api.getRepairedReservationNumbers.mockResolvedValue({ alerts: [ROW] });
  api.acknowledgeRepairedReservationNumber.mockResolvedValue({ ok: true });
  render(<RepairedReservationNumbersAlert attention={ATTENTION} />);
  expect(await screen.findByText('Réservations restées sans numéro')).toBeInTheDocument();
  await userEvent.click(screen.getByText(/N° 202610007 · Jean Dupont · Gîte/));
  expect(mockNavigate).toHaveBeenCalledWith('/reservations/42');
  await userEvent.click(screen.getByRole('button', { name: 'Vu' }));
  expect(api.acknowledgeRepairedReservationNumber).toHaveBeenCalledWith(42);
  await waitFor(() => expect(screen.queryByText(/N° 202610007/)).not.toBeInTheDocument());
});

test('une erreur de chargement n’affiche rien', async () => {
  api.getRepairedReservationNumbers.mockRejectedValue(new Error('boom'));
  const { container } = render(<RepairedReservationNumbersAlert attention={ATTENTION} />);
  await act(() => api.getRepairedReservationNumbers.mock.results.at(-1).value.catch(() => {}));
  expect(container).toBeEmptyDOMElement();
});
