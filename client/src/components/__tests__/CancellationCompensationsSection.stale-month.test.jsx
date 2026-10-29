/**
 * specs/cancellation-compensation.md rule 31 — a slow answer for a month already left never replaces
 * the month on screen (audit R4: August's 53,10 € read 0,00 € once September's late answer landed).
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getCancellationCompensations: vi.fn() },
}));

import api from '../../api';
import CancellationCompensationsSection from '../CancellationCompensationsSection';

const payload = (receivedInMonth) => ({ pending: [], received: [], totals: { pendingExpected: 0, receivedInMonth } });
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

const tree = (month) => (
  <MemoryRouter><DialogProvider><CancellationCompensationsSection month={month} year={2026} canEdit /></DialogProvider></MemoryRouter>
);

beforeEach(() => api.getCancellationCompensations.mockReset());

test('rule 31 — a late answer for September does not replace August', async () => {
  const september = deferred();
  api.getCancellationCompensations.mockImplementation((month) => (month === 9 ? september.promise : Promise.resolve(payload(53.1))));
  const { rerender } = render(tree(10));
  await screen.findByText(/Total/);
  rerender(tree(9));
  rerender(tree(8));
  await waitFor(() => expect(screen.getByText(/53,10/)).toBeInTheDocument());
  await act(async () => { september.resolve(payload(7.77)); });
  expect(screen.getByText(/53,10/)).toBeInTheDocument();
  expect(screen.queryByText(/7,77/)).toBeNull();
});

test('rule 31 — a late failure for a month already left does not raise the error', async () => {
  const september = deferred();
  api.getCancellationCompensations.mockImplementation((month) => (month === 9 ? september.promise : Promise.resolve(payload(53.1))));
  const { rerender } = render(tree(10));
  await screen.findByText(/Total/);
  rerender(tree(9));
  rerender(tree(8));
  await waitFor(() => expect(screen.getByText(/53,10/)).toBeInTheDocument());
  await act(async () => { september.reject(new Error('boom')); });
  expect(screen.queryByText('Impossible de charger les indemnités.')).toBeNull();
  expect(screen.getByText(/53,10/)).toBeInTheDocument();
});
