import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import GateAccessCard from '../GateAccessCard';

// specs/gate-access-sowel-connector.md §3.4 rules 20-21 — the card reads the local copy and does
// nothing else: every action lives in Sowel. What is pinned here is that it never shows an empty
// frame, and that an access deleted from the list is visible.

vi.mock('../../api', () => ({
  default: { getReservationGateAccess: vi.fn() },
}));

import api from '../../api';

const card = (over = {}) => ({
  configured: true,
  state: 'active',
  stateLabel: 'Actif',
  code: '4K7M-9QT2',
  url: 'https://sowel.example.com/p/guest-access/#i=4K7M9QT2',
  windowLabel: 'Du vendredi 4 septembre à 18:00 au vendredi 11 septembre à 11:00',
  devices: 2,
  lastUsedAt: '2026-09-06T18:12:00.000Z',
  deleted: false,
  ...over,
});

beforeEach(() => {
  vi.mocked(api.getReservationGateAccess).mockReset();
});

test('shows nothing while no house has configured this stay', async () => {
  api.getReservationGateAccess.mockResolvedValue({ card: { configured: false } });
  const { container } = render(<GateAccessCard reservationId={42} />);
  await waitFor(() => expect(api.getReservationGateAccess).toHaveBeenCalledWith(42));
  expect(container.textContent).toBe('');
});

test('shows nothing either when the read fails — a fiche does not break for that', async () => {
  api.getReservationGateAccess.mockRejectedValue(new Error('403'));
  const { container } = render(<GateAccessCard reservationId={42} />);
  await waitFor(() => expect(api.getReservationGateAccess).toHaveBeenCalled());
  expect(container.textContent).toBe('');
});

test('shows the state, the code, the validity and the phones', async () => {
  api.getReservationGateAccess.mockResolvedValue({ card: card() });
  render(<GateAccessCard reservationId={42} />);

  expect(await screen.findByText('Accès portail')).toBeTruthy();
  expect(screen.getByText('Actif')).toBeTruthy();
  expect(screen.getByText('4K7M-9QT2')).toBeTruthy();
  expect(screen.getByText(/Du vendredi 4 septembre/)).toBeTruthy();
  expect(screen.getByText('2')).toBeTruthy();
});

test('says where the actions are, because they are not here', async () => {
  api.getReservationGateAccess.mockResolvedValue({ card: card() });
  render(<GateAccessCard reservationId={42} />);
  expect(await screen.findByText(/Accès invités/)).toBeTruthy();
});

test('an access deleted from the list is visible, and says what to do', async () => {
  api.getReservationGateAccess.mockResolvedValue({
    card: card({ state: 'deleted', stateLabel: 'Supprimé dans la liste', deleted: true }),
  });
  render(<GateAccessCard reservationId={42} />);

  expect(await screen.findByText('Supprimé dans la liste')).toBeTruthy();
  expect(screen.getByText(/le client n'a plus de code/i)).toBeTruthy();
  // No code shown any more: there is none.
  expect(screen.queryByText('4K7M-9QT2')).toBeNull();
});

test('« jamais » rather than a blank when nobody has opened yet', async () => {
  api.getReservationGateAccess.mockResolvedValue({ card: card({ lastUsedAt: null }) });
  render(<GateAccessCard reservationId={42} />);
  expect(await screen.findByText('jamais')).toBeTruthy();
});
