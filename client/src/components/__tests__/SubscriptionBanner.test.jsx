// specs/control-plane-plans-and-access.md §6 — the admin banner: due, grace and read-only, with the
// Qonto renewal link; nothing for other roles, an active subscription or an unmanaged instance; a
// write refused for the subscription always ends in the error toast.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getSubscription: vi.fn() },
}));

let currentUser = { id: 1, roles: ['admin'] };
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: currentUser }),
}));

const showError = vi.fn();
vi.mock('../DialogProvider', () => ({
  __esModule: true,
  useToast: () => ({ showError, showSuccess: vi.fn() }),
}));

import { act } from '@testing-library/react';
import api from '../../api';
import SubscriptionBanner from '../SubscriptionBanner';

const status = (over = {}) => ({ state: 'due', severity: 'info', text: 'Abonnement Pro jusqu’au 12/11/2026.', payUrl: null, ...over });

beforeEach(() => {
  currentUser = { id: 1, roles: ['admin'] };
  api.getSubscription.mockReset();
  showError.mockReset();
});

test('the server’s text, with the renewal link when there is one', async () => {
  api.getSubscription.mockResolvedValue(status({ payUrl: 'https://pay.qonto.com/abc' }));
  render(<SubscriptionBanner />);
  expect(await screen.findByText('Abonnement Pro jusqu’au 12/11/2026.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Renouveler' }).getAttribute('href')).toBe('https://pay.qonto.com/abc');
});

test('no link without one', async () => {
  api.getSubscription.mockResolvedValue(status({ state: 'grace', severity: 'warning', text: 'Abonnement échu.' }));
  render(<SubscriptionBanner />);
  expect(await screen.findByText('Abonnement échu.')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Renouveler' })).toBeNull();
});

test('active or unmanaged: nothing shows', async () => {
  for (const s of [status({ state: 'active', severity: null, text: null }), { state: null, text: null }]) {
    api.getSubscription.mockResolvedValue(s);
    const { container, unmount } = render(<SubscriptionBanner />);
    await waitFor(() => expect(api.getSubscription).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    unmount();
  }
});

test('non-admin: no call and no banner', () => {
  currentUser = { id: 2, roles: ['reception'] };
  const { container } = render(<SubscriptionBanner />);
  expect(api.getSubscription).not.toHaveBeenCalled();
  expect(container.textContent).toBe('');
});

test('rule 14: a write refused for the subscription is toasted for every role, even on a silent page', () => {
  currentUser = { id: 2, roles: ['reception'] };
  render(<SubscriptionBanner />);
  act(() => {
    window.dispatchEvent(new CustomEvent('guestflow:read-only', { detail: { message: 'Modification impossible : abonnement à renouveler.' } }));
  });
  expect(showError).toHaveBeenCalledWith('Modification impossible : abonnement à renouveler.');
});
