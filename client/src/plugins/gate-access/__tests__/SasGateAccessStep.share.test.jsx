import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import SasGateAccessStep from '../SasGateAccessStep';

// specs/gate-access-sowel-connector.md §3.5 rule 24b — « Partager » hands the gate link to the
// phone's native share sheet; « Copier le lien » stands in where there is none.

vi.mock('../../../api', () => ({
  default: { getReservationGateAccess: vi.fn() },
}));

import api from '../../../api';

const URL = 'https://acces.domainesolio.com/#i=4K7M9QT2';

const sas = (over = {}) => ({
  status: 'ok',
  code: '4K7M-9QT2',
  url: URL,
  qrDataUri: 'data:image/png;base64,AAAA',
  windowLabel: 'Du vendredi 4 septembre à 18:00 au vendredi 11 septembre à 11:00',
  ...over,
});

const originalShare = navigator.share;
const originalClipboard = navigator.clipboard;

const setNavigator = (key, value) =>
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true });

beforeEach(() => {
  vi.mocked(api.getReservationGateAccess).mockReset();
});

afterEach(() => {
  setNavigator('share', originalShare);
  setNavigator('clipboard', originalClipboard);
});

test('shares the link that carries the key through the native share sheet', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  setNavigator('share', share);
  api.getReservationGateAccess.mockResolvedValue({ sas: sas() });
  render(<SasGateAccessStep reservationId={42} available portalCode="" />);

  // The QR stays beside the button.
  expect(await screen.findByAltText("QR de l'accès portail")).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Partager' }));

  expect(share).toHaveBeenCalledTimes(1);
  expect(share.mock.calls[0][0]).toMatchObject({ title: 'Accès portail', url: URL });
  expect(screen.queryByRole('button', { name: 'Copier le lien' })).toBeNull();
});

test('a dismissed share sheet leaves the step as it was', async () => {
  setNavigator('share', vi.fn().mockRejectedValue(Object.assign(new Error('abort'), { name: 'AbortError' })));
  api.getReservationGateAccess.mockResolvedValue({ sas: sas() });
  render(<SasGateAccessStep reservationId={42} available portalCode="" />);

  await userEvent.click(await screen.findByRole('button', { name: 'Partager' }));
  expect(screen.getByText('4K7M-9QT2')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('without a share sheet, the link is copied instead', async () => {
  setNavigator('share', undefined);
  const writeText = vi.fn().mockResolvedValue(undefined);
  setNavigator('clipboard', { writeText });
  api.getReservationGateAccess.mockResolvedValue({ sas: sas() });
  render(<SasGateAccessStep reservationId={42} available portalCode="" />);

  await userEvent.click(await screen.findByRole('button', { name: 'Copier le lien' }));
  expect(writeText).toHaveBeenCalledWith(URL);
  expect(await screen.findByRole('button', { name: 'Lien copié' })).toBeTruthy();
});

test('no link, no share button: the code alone is dictated', async () => {
  setNavigator('share', vi.fn());
  api.getReservationGateAccess.mockResolvedValue({ sas: sas({ url: null, qrDataUri: null }) });
  render(<SasGateAccessStep reservationId={42} available portalCode="" />);

  expect(await screen.findByText('4K7M-9QT2')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Partager' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Copier le lien' })).toBeNull();
});
