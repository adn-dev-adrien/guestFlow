import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import GateAccessCard from '../GateAccessCard';

// specs/gate-access-sowel-connector.md §3.5 rule 26 — the fiche card reads the stored key and does
// nothing else: every action lives in Sowel. It never shows an empty frame, and a key Sowel could
// not make says so, with the reason.

vi.mock('../../../api', () => ({
  default: { getReservationGateAccess: vi.fn() },
}));

import api from '../../../api';

const card = (over = {}) => ({
  configured: true,
  ok: true,
  action: 'create',
  state: 'not_yet',
  stateLabel: 'À venir',
  reason: null,
  code: '4K7M-9QT2',
  url: 'https://acces.domainesolio.com/#i=4K7M9QT2',
  windowLabel: 'Du jeudi 1 octobre à 15:00 au dimanche 4 octobre à 11:00',
  ...over,
});

beforeEach(() => {
  vi.mocked(api.getReservationGateAccess).mockReset();
});

test('shows nothing while Sowel has reported nothing for this stay', async () => {
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

test('shows the state, the code, the validity and the link', async () => {
  api.getReservationGateAccess.mockResolvedValue({ card: card() });
  render(<GateAccessCard reservationId={42} />);

  expect(await screen.findByText('Accès portail')).toBeTruthy();
  expect(screen.getByText('À venir')).toBeTruthy();
  expect(screen.getByText('4K7M-9QT2')).toBeTruthy();
  expect(screen.getByText(/Du jeudi 1 octobre/)).toBeTruthy();
  expect(screen.getByRole('link').getAttribute('href')).toBe('https://acces.domainesolio.com/#i=4K7M9QT2');
});

test('says where the actions are, because they are not here', async () => {
  api.getReservationGateAccess.mockResolvedValue({ card: card() });
  render(<GateAccessCard reservationId={42} />);
  expect(await screen.findByText(/vivent dans Sowel/)).toBeTruthy();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

test('a key Sowel could not make says « Échec » and why', async () => {
  api.getReservationGateAccess.mockResolvedValue({
    card: card({ ok: false, state: 'failed', stateLabel: 'Échec', code: null, url: null, reason: 'le profil par défaut ne liste aucun portail' }),
  });
  render(<GateAccessCard reservationId={42} />);

  expect(await screen.findByText('Échec')).toBeTruthy();
  expect(screen.getByText(/n'a pas pu créer la clé : le profil par défaut ne liste aucun portail/)).toBeTruthy();
  expect(screen.queryByText('4K7M-9QT2')).toBeNull();
});
