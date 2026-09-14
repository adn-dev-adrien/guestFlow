// specs/gate-access-portier.md §3.3 — the SAS step « Accès portail »: the QR and the code read from
// Portier, the window in force, and the keypad code kept when Portier does not answer.
import { vi, beforeEach, test, expect } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getSasGateAccess: vi.fn() },
}));

import api from '../../../api';
import SasGateAccessStep from '../SasGateAccessStep';

const STEP = {
  status: 'ok', state: 'before', stateLabel: 'pas encore actif', notice: '',
  code: '4K7M-9QT2', qrDataUri: 'data:image/svg+xml;base64,PHN2Zy8+', windowLabel: 'Actif du 21/09 à 16:00 au 28/09 à 11:00', fallbackCode: '1234',
};

beforeEach(() => vi.clearAllMocks());

test('the QR, the code under it and the window in force', async () => {
  api.getSasGateAccess.mockResolvedValue(STEP);
  render(<SasGateAccessStep reservationId={42} configured portalCode="1234" />);
  const qr = await screen.findByAltText("QR de l'accès portail");
  expect(qr).toHaveAttribute('src', STEP.qrDataUri);
  expect(api.getSasGateAccess).toHaveBeenCalledWith(42);
  expect(screen.getByText("Flashez pour installer l'accès au portail")).toBeInTheDocument();
  expect(screen.getByText('4K7M-9QT2')).toBeInTheDocument();
  expect(screen.getByText('Actif du 21/09 à 16:00 au 28/09 à 11:00')).toBeInTheDocument();
  expect(screen.queryByText('1234')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Ouvrir l.accès maintenant/ })).not.toBeInTheDocument();
});

test('Portier unreachable: « Accès portail indisponible », « Réessayer », and the keypad code', async () => {
  const user = userEvent.setup();
  api.getSasGateAccess.mockResolvedValueOnce({ status: 'unavailable', fallbackCode: '1234' }).mockResolvedValueOnce(STEP);
  render(<SasGateAccessStep reservationId={42} configured portalCode="1234" />);
  expect(await screen.findByText('Accès portail indisponible : Portier ne répond pas.')).toBeInTheDocument();
  expect(screen.getByText('Secours — code du clavier du portail :')).toBeInTheDocument();
  expect(screen.getByText('1234')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByAltText("QR de l'accès portail")).toBeInTheDocument();
  expect(api.getSasGateAccess).toHaveBeenCalledTimes(2);
});

test('a revoked access shows what happened, and neither a QR nor a code', async () => {
  api.getSasGateAccess.mockResolvedValue({ ...STEP, state: 'revoked', code: '', qrDataUri: '', notice: "Cet accès est révoqué : la réservation n'est plus active." });
  render(<SasGateAccessStep reservationId={42} configured portalCode="" />);
  expect(await screen.findByText("Cet accès est révoqué : la réservation n'est plus active.")).toBeInTheDocument();
  expect(screen.queryByAltText("QR de l'accès portail")).not.toBeInTheDocument();
});

test('no Portier configured: nothing is read, the keypad code is dictated as before', async () => {
  render(<SasGateAccessStep reservationId={42} configured={false} portalCode="1234" />);
  expect(screen.getByText('Code du portail à communiquer au client :')).toBeInTheDocument();
  expect(screen.getByText('1234')).toBeInTheDocument();
  await waitFor(() => expect(api.getSasGateAccess).not.toHaveBeenCalled());
});
