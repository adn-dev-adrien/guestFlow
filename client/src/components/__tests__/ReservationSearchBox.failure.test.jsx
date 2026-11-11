// specs/reservation-number-and-search.md rule 17 — a failed search says « Recherche indisponible. », never
// « Aucune réservation » (which reads as « this reservation does not exist »).
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { searchReservations: vi.fn() },
}));

import api from '../../api';
import ReservationSearchBox from '../ReservationSearchBox';

beforeEach(() => api.searchReservations.mockReset());

const typeTerm = (term) => fireEvent.change(screen.getByRole('combobox'), { target: { value: term } });

test('rule 17 — a failed search reads « Recherche indisponible. », not « Aucune réservation »', async () => {
  api.searchReservations.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);
  render(<ReservationSearchBox onSelect={vi.fn()} />);
  typeTerm('22303');
  expect(await screen.findByText('Recherche indisponible.', {}, { timeout: 2000 })).toBeInTheDocument();
  expect(screen.queryByText('Aucune réservation')).toBeNull();
});

test('rule 17 — a search without match still reads « Aucune réservation », and the outage message clears on the next success', async () => {
  api.searchReservations.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);
  render(<ReservationSearchBox onSelect={vi.fn()} />);
  typeTerm('2');
  await screen.findByText('Recherche indisponible.', {}, { timeout: 2000 });
  typeTerm('22');
  expect(await screen.findByText('Aucune réservation', {}, { timeout: 2000 })).toBeInTheDocument();
  expect(screen.queryByText('Recherche indisponible.')).toBeNull();
});
