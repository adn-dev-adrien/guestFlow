import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import SasGateAccessStep from '../SasGateAccessStep';

// specs/gate-access-sowel-connector.md §3.5 rules 24-25 — the step shows, it activates nothing,
// and it falls back to the gate keypad's code when there is no key to install.

vi.mock('../../../api', () => ({
  default: { getReservationGateAccess: vi.fn() },
}));

import api from '../../../api';

const step = (over = {}) => ({
  status: 'ok',
  code: '4K7M-9QT2',
  url: 'https://acces.domainesolio.com/#i=4K7M9QT2',
  qrDataUri: 'data:image/png;base64,AAAA',
  windowLabel: 'Du vendredi 4 septembre à 18:00 au vendredi 11 septembre à 11:00',
  ...over,
});

beforeEach(() => {
  vi.mocked(api.getReservationGateAccess).mockReset();
});

test('shows the QR to flash, the dictable code and the window', async () => {
  api.getReservationGateAccess.mockResolvedValue({ sas: step() });
  render(<SasGateAccessStep reservationId={42} available portalCode="1234" />);

  expect(await screen.findByText(/Flashez pour installer/)).toBeTruthy();
  const qr = screen.getByAltText("QR de l'accès portail");
  expect(qr.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  expect(screen.getByText('4K7M-9QT2')).toBeTruthy();
  expect(screen.getByText(/Du vendredi 4 septembre/)).toBeTruthy();
});

test('with no access, the keypad code stays there to dictate', async () => {
  render(<SasGateAccessStep reservationId={42} available={false} portalCode="1234" />);
  expect(await screen.findByText('1234')).toBeTruthy();
  expect(api.getReservationGateAccess).not.toHaveBeenCalled();
});

test('says Sowel has not made the key yet, and offers to retry', async () => {
  api.getReservationGateAccess.mockResolvedValue({ sas: { status: 'not_received' } });
  render(<SasGateAccessStep reservationId={42} available portalCode="1234" />);

  expect(await screen.findByText(/pas encore créé la clé de ce séjour/)).toBeTruthy();
  // The keypad code stays, as a fallback.
  expect(screen.getByText('1234')).toBeTruthy();

  api.getReservationGateAccess.mockResolvedValue({ sas: step() });
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('4K7M-9QT2')).toBeTruthy();
});

test('a failed read does not leave the page silent', async () => {
  api.getReservationGateAccess.mockRejectedValue(new Error('boom'));
  render(<SasGateAccessStep reservationId={42} available portalCode="" />);
  expect(await screen.findByText(/Accès portail indisponible/)).toBeTruthy();
});

test('the QR may be missing without the code disappearing', async () => {
  api.getReservationGateAccess.mockResolvedValue({ sas: step({ qrDataUri: null }) });
  render(<SasGateAccessStep reservationId={42} available portalCode="" />);
  expect(await screen.findByText('4K7M-9QT2')).toBeTruthy();
  expect(screen.queryByAltText("QR de l'accès portail")).toBeNull();
});

test('the step offers no action on the access — they live in Sowel', async () => {
  api.getReservationGateAccess.mockResolvedValue({ sas: step() });
  render(<SasGateAccessStep reservationId={42} available portalCode="" />);
  await screen.findByText('4K7M-9QT2');
  // Handing the link on (rule 24b) is the only button: nothing activates, suspends or revokes.
  const names = screen.queryAllByRole('button').map((b) => b.textContent);
  expect(names.every((name) => /Partager|Copier le lien/.test(name))).toBe(true);
});

test('a key without a code (a profile without one) still shows its QR', async () => {
  api.getReservationGateAccess.mockResolvedValue({ sas: step({ code: null }) });
  render(<SasGateAccessStep reservationId={42} available portalCode="" />);
  expect(await screen.findByAltText("QR de l'accès portail")).toBeTruthy();
  expect(screen.queryByText('4K7M-9QT2')).toBeNull();
});

// specs/gate-access-sowel-connector.md §3.5 rule 24 — the QR sits on the page where the gate code is shown.
test('with a usable key, the QR and the keypad code share the page', async () => {
  api.getReservationGateAccess.mockResolvedValue({ sas: step() });
  render(<SasGateAccessStep reservationId={42} available portalCode="1234" />);
  expect(await screen.findByAltText("QR de l'accès portail")).toBeTruthy();
  expect(screen.getByText('1234')).toBeTruthy();
});
