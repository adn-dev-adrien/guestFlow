// specs/mobile-dashboard-exercise-cash.md rule 7 — « Ouvrir » (page Indemnités) only for the roles that can open it.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import DialogProvider from '../DialogProvider';

let currentUser = { id: 1, roles: ['admin'] };
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: currentUser }) }));
vi.mock('../../api', () => ({
  __esModule: true,
  default: { getCancellationCompensations: vi.fn(), receiveCancellationCompensation: vi.fn(), updateCancellationCompensation: vi.fn(), deleteCancellationCompensation: vi.fn() },
}));

import api from '../../api';
import Alert from '../CancellationCompensationsPendingAlert';

const ATTENTION = { key: 'cancellation-compensations', severity: 'todo', count: 1, title: 'Indemnités à encaisser', detail: '1 indemnité' };
// date-literal-ok: a server payload the component renders as given; nothing compares it with today
const ROW = { id: 5, reservationId: 9, clientName: 'Claire Notin', propertyName: 'Le Lodge', expectedAmount: 100, status: 'pending', startDate: '2026-09-01', endDate: '2026-09-03' };

const renderAlert = () => render(<MemoryRouter><DialogProvider><Alert attention={ATTENTION} /></DialogProvider></MemoryRouter>);

beforeEach(() => {
  api.getCancellationCompensations.mockResolvedValue({ pending: [ROW] });
});

test.each([['admin', true], ['accountant', true], ['reception', false]])('%s: « Ouvrir » shown = %s', async (role, shown) => {
  currentUser = { id: 1, roles: [role] };
  renderAlert();
  await screen.findByText(/Claire Notin/);
  expect(Boolean(screen.queryByRole('button', { name: 'Ouvrir' }))).toBe(shown);
});
