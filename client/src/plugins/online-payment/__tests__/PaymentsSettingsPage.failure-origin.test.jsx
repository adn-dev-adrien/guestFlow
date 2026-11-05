/**
 * specs/qonto-settings-in-app.md rule 21 (audit R24 E24-3) — the last Qonto failure names where it came from with the
 * server's French label, never a raw origin code.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../../components/DialogProvider';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getPaymentSettings: vi.fn(), getQontoBankAccounts: vi.fn() },
}));
vi.mock('../ReconciliationSettingsCard', () => ({ __esModule: true, default: () => null }));

import api from '../../../api';
import PaymentsSettingsPage from '../PaymentsSettingsPage';

const withFailure = (lastError) => ({
  qonto: { connected: true, configured: true, health: { state: 'error', lastError } },
  credentials: { environment: 'production' },
});

beforeEach(() => {
  api.getPaymentSettings.mockReset();
  api.getQontoBankAccounts?.mockResolvedValue?.([]);
});

const renderPage = () => render(<MemoryRouter><DialogProvider><PaymentsSettingsPage /></DialogProvider></MemoryRouter>);

test('rule 21 — the failure carries the label the server sent', async () => {
  api.getPaymentSettings.mockResolvedValue(withFailure({
    at: new Date().toISOString(), code: 'insufficient_scope', message: '', origin: 'reconciliation', originLabel: 'rapprochement bancaire',
  }));
  renderPage();
  const alert = await screen.findByText(/Dernier échec Qonto/);
  expect(alert).toHaveTextContent('(rapprochement bancaire, le ');
  expect(alert).not.toHaveTextContent('reconciliation');
});

test('rule 21 — an origin without a label shows only the date', async () => {
  api.getPaymentSettings.mockResolvedValue(withFailure({
    at: new Date().toISOString(), code: 'boom', message: '', origin: 'something-new', originLabel: '',
  }));
  renderPage();
  const alert = await screen.findByText(/Dernier échec Qonto/);
  expect(alert).toHaveTextContent('(le ');
  expect(alert).not.toHaveTextContent('something-new');
});
