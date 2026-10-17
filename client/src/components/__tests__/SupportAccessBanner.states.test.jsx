// specs/hosting-h2-account-security.md rules 12-13, 17 — the support banner: the pending reason with
// « Autoriser 24 h » and « Refuser », the duration picked (1 h / 24 h / 7 jours) sent with the
// decision, and nothing without a request, for another role, on an unmanaged instance or inside the
// support's own session.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getSupportBanner: vi.fn(), decideSupportAccess: vi.fn() },
}));

let currentUser;
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: currentUser }) }));
const showSuccess = vi.fn();
vi.mock('../DialogProvider', () => ({ __esModule: true, useToast: () => ({ showSuccess, showError: vi.fn() }) }));

import api from '../../api';
import SupportAccessBanner from '../SupportAccessBanner';

const BANNER = {
  pending: { id: 7, reason: 'Vérifier la synchronisation Booking', requestedAt: '2026-10-08T09:00:00Z' },
  durations: [{ hours: 1, label: '1 h' }, { hours: 24, label: '24 h' }, { hours: 168, label: '7 jours' }],
  defaultHours: 24,
};

beforeEach(() => {
  currentUser = { id: 1, roles: ['admin'], supportAccessEnabled: true };
  api.getSupportBanner.mockReset().mockResolvedValue(BANNER);
  api.decideSupportAccess.mockReset().mockResolvedValue({ accesses: [] });
  showSuccess.mockReset();
});

test('rule 12 — the reason, « Autoriser 24 h » and « Refuser »', async () => {
  render(<SupportAccessBanner />);
  expect(await screen.findByText('Le support demande l’accès : Vérifier la synchronisation Booking')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Autoriser 24 h' }));
  await waitFor(() => expect(api.decideSupportAccess).toHaveBeenCalledWith(7, 'accept', 24));
  expect(screen.queryByText(/Le support demande/)).toBeNull();
});

test('rule 13 — another duration is sent with the decision', async () => {
  render(<SupportAccessBanner />);
  await screen.findByText(/Le support demande/);
  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(within(screen.getByRole('listbox')).getByText('7 jours'));
  fireEvent.click(screen.getByRole('button', { name: 'Autoriser 7 jours' }));
  await waitFor(() => expect(api.decideSupportAccess).toHaveBeenCalledWith(7, 'accept', 168));
});

test('rule 12 — « Refuser »', async () => {
  render(<SupportAccessBanner />);
  fireEvent.click(await screen.findByRole('button', { name: 'Refuser' }));
  await waitFor(() => expect(api.decideSupportAccess).toHaveBeenCalledWith(7, 'refuse', undefined));
});

test('rule 17 — nothing without a request, for another role, on an unmanaged instance, or for the support', async () => {
  api.getSupportBanner.mockResolvedValue({ pending: null });
  const { unmount } = render(<SupportAccessBanner />);
  await waitFor(() => expect(api.getSupportBanner).toHaveBeenCalled());
  expect(screen.queryByText(/Le support demande/)).toBeNull();
  unmount();

  api.getSupportBanner.mockReset().mockResolvedValue(BANNER);
  for (const user of [
    { id: 2, roles: ['accountant'], supportAccessEnabled: true },
    { id: 1, roles: ['admin'], supportAccessEnabled: false },
    { id: 9, roles: ['admin'], supportAccessEnabled: true, isSupport: true },
  ]) {
    currentUser = user;
    const r = render(<SupportAccessBanner />);
    expect(screen.queryByText(/Le support demande/)).toBeNull();
    r.unmount();
  }
  expect(api.getSupportBanner).not.toHaveBeenCalled();
});
