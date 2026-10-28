// specs/plugin-operator-provisioning.md rule 36 — the session is re-read when the route changes or the
// tab comes back, at most every 30 s: a module the operator switched off leaves the menu, and a failed
// re-read neither signs out nor flashes.
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ __esModule: true, default: { getMe: vi.fn() } }));
import api from '../../api';
import { AuthProvider, useAuth } from '../useAuth';

let go;
function Probe() {
  const { user, loading } = useAuth();
  go = useNavigate();
  if (loading) return <p>loading</p>;
  return <p>{user ? `plugins:${user.enabledPlugins.join(',')}` : 'signed out'}</p>;
}

const mount = () => render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
const me = (...enabledPlugins) => ({ id: 1, roles: ['admin'], enabledPlugins });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  api.getMe.mockReset();
});
afterEach(() => vi.useRealTimers());

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

it('re-reads the session on a route change after 30 s, not before', async () => {
  api.getMe.mockResolvedValueOnce(me('linen', 'sas'));
  mount();
  await flush();
  expect(screen.getByText('plugins:linen,sas')).toBeInTheDocument();
  api.getMe.mockResolvedValue(me('sas'));
  act(() => go('/a'));
  await flush();
  expect(api.getMe).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 31000);
  act(() => go('/b'));
  await flush();
  expect(api.getMe).toHaveBeenCalledTimes(2);
  expect(screen.getByText('plugins:sas')).toBeInTheDocument();
});

it('re-reads it when the tab becomes visible again', async () => {
  api.getMe.mockResolvedValueOnce(me('linen'));
  mount();
  await flush();
  api.getMe.mockResolvedValue(me());
  vi.setSystemTime(Date.now() + 31000);
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await flush();
  expect(screen.getByText('plugins:')).toBeInTheDocument();
});

it('a failed re-read keeps the session', async () => {
  api.getMe.mockResolvedValueOnce(me('linen'));
  mount();
  await flush();
  api.getMe.mockRejectedValue(new Error('offline'));
  vi.setSystemTime(Date.now() + 31000);
  act(() => go('/c'));
  await flush();
  expect(screen.getByText('plugins:linen')).toBeInTheDocument();
});
