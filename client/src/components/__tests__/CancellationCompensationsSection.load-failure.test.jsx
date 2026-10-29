/**
 * specs/cancellation-compensation.md rule 30 — a failed load is an error with « Réessayer », never a
 * « Total : 0,00 € » that reads as a true zero.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getCancellationCompensations: vi.fn() },
}));

import api from '../../api';
import CancellationCompensationsSection from '../CancellationCompensationsSection';

const PAYLOAD = { pending: [], received: [], totals: { pendingExpected: 0, receivedInMonth: 0 } };

beforeEach(() => api.getCancellationCompensations.mockReset());

const renderSection = () => render(
  <MemoryRouter><DialogProvider><CancellationCompensationsSection month={8} year={2026} canEdit /></DialogProvider></MemoryRouter>,
);

test('rule 30 — a failed load shows an error and no zero total or empty message', async () => {
  api.getCancellationCompensations.mockRejectedValueOnce(new Error('boom'));
  renderSection();
  expect(await screen.findByText('Impossible de charger les indemnités.')).toBeInTheDocument();
  expect(screen.queryByText(/Total/)).toBeNull();
  expect(screen.queryByText('Aucune indemnité encaissée ce mois-ci.')).toBeNull();
  expect(screen.queryByText('Aucune indemnité en attente.')).toBeNull();
});

test('rule 30 — « Réessayer » reloads and replaces the error with the lists', async () => {
  api.getCancellationCompensations.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(PAYLOAD);
  renderSection();
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Aucune indemnité en attente.')).toBeInTheDocument();
  expect(screen.queryByText('Impossible de charger les indemnités.')).toBeNull();
  expect(api.getCancellationCompensations).toHaveBeenCalledTimes(2);
});
