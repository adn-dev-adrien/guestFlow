/**
 * specs/qonto-settings-in-app.md rule 17 — when the settings fail to load, the page says so with a
 * « Réessayer » instead of spinning forever.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../../components/DialogProvider';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getPaymentSettings: vi.fn(), getQontoBankAccounts: vi.fn() },
}));

import api from '../../../api';
import PaymentsSettingsPage from '../PaymentsSettingsPage';

const SETTINGS = {
  qonto: { connected: false, configured: false, health: { state: 'not_configured' } },
  credentials: { environment: 'sandbox' },
};

beforeEach(() => {
  api.getPaymentSettings.mockReset();
  api.getQontoBankAccounts?.mockResolvedValue?.([]);
});

const renderPage = () => render(<MemoryRouter><DialogProvider><PaymentsSettingsPage /></DialogProvider></MemoryRouter>);

test('rule 17 — a failed settings load shows the error, not an endless spinner', async () => {
  api.getPaymentSettings.mockRejectedValue(new Error('boom'));
  renderPage();
  expect(await screen.findByText('Impossible de charger les paramètres de paiement.')).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).toBeNull();
});

test('rule 17 — « Réessayer » loads again and the page appears', async () => {
  api.getPaymentSettings.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(SETTINGS);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText(/Identifiants de l’application Qonto/)).toBeInTheDocument();
  expect(screen.queryByText('Impossible de charger les paramètres de paiement.')).toBeNull();
});
