// specs/ds-sweep-planning.md rule 29 — « today » is read again when the page comes back to the
// foreground, so a page left open past midnight moves to the new day.
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getToday: vi.fn() },
}));

import api from '../../api';
import useServerToday from '../useServerToday';

function Probe() {
  const today = useServerToday();
  return <span data-testid="today">{today || ''}</span>;
}

beforeEach(() => {
  api.getToday.mockReset();
});

test('rule 29 — a focus after midnight moves « today » to the new server date', async () => {
  api.getToday.mockResolvedValueOnce({ today: '2026-10-18' }).mockResolvedValueOnce({ today: '2026-10-19' });
  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId('today').textContent).toBe('2026-10-18'));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(screen.getByTestId('today').textContent).toBe('2026-10-19'));
  expect(api.getToday).toHaveBeenCalledTimes(2);
});

test('rule 29 — the page becoming visible again reads the date; hiding it does not', async () => {
  api.getToday.mockResolvedValue({ today: '2026-10-18' });
  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId('today').textContent).toBe('2026-10-18'));
  const state = vi.spyOn(document, 'visibilityState', 'get');
  state.mockReturnValue('hidden');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(api.getToday).toHaveBeenCalledTimes(1);
  api.getToday.mockResolvedValue({ today: '2026-10-19' });
  state.mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => expect(screen.getByTestId('today').textContent).toBe('2026-10-19'));
  state.mockRestore();
});

test('rule 29 — no read after unmount', async () => {
  api.getToday.mockResolvedValue({ today: '2026-10-18' });
  const { unmount } = render(<Probe />);
  await waitFor(() => expect(api.getToday).toHaveBeenCalledTimes(1));
  unmount();
  window.dispatchEvent(new Event('focus'));
  expect(api.getToday).toHaveBeenCalledTimes(1);
});
