// specs/qonto-bank-reconciliation.md rule 48 (audit R20-P1) — the start date field hints the date window from the
// server's day; the date it was loaded with is not hinted. The server is the guard.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import DialogProvider from '../../../components/DialogProvider';
import ReconciliationSettingsCard from '../ReconciliationSettingsCard';
import { horizonStart } from '../../../utils/dateHorizon';
import { addIsoDays, localIsoToday } from '../../../utils/isoDay';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getToday: vi.fn(), getPluginSettings: vi.fn(), savePluginSettings: vi.fn(), getReconciliationBankAccounts: vi.fn() },
}));
import api from '../../../api';

const TOO_OLD = 'Date trop ancienne : 5 ans au plus.';
const DEFAULT_HINT = 'Les séjours qui partent avant cette date ne sont pas rapprochés.';
const DEVICE_START = horizonStart(localIsoToday());
const SERVER_TODAY = addIsoDays(localIsoToday(), 40);

const renderCard = () => render(<DialogProvider><ReconciliationSettingsCard connected /></DialogProvider>);
const field = () => screen.findByLabelText('Mise en service');

beforeEach(() => {
  vi.clearAllMocks();
  api.getToday.mockResolvedValue({ today: SERVER_TODAY });
  api.getReconciliationBankAccounts.mockResolvedValue([]);
  api.savePluginSettings.mockResolvedValue({});
});

test('a date the device would accept but the server would not is hinted, from the server\'s day', async () => {
  api.getPluginSettings.mockResolvedValue({ reconciliationStartDate: localIsoToday() });
  renderCard();
  const input = await field();
  await waitFor(() => expect(api.getToday).toHaveBeenCalled());
  fireEvent.change(input, { target: { value: DEVICE_START } });
  expect(await screen.findByText(TOO_OLD)).toBeInTheDocument();
  expect(input).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(input, { target: { value: SERVER_TODAY } });
  expect(await screen.findByText(DEFAULT_HINT)).toBeInTheDocument();
});

test('the date the card was loaded with is not hinted, even outside the window', async () => {
  const stored = addIsoDays(DEVICE_START, -30);
  api.getPluginSettings.mockResolvedValue({ reconciliationStartDate: stored });
  renderCard();
  const input = await field();
  await waitFor(() => expect(api.getToday).toHaveBeenCalled());
  expect(input).toHaveValue(stored);
  expect(screen.getByText(DEFAULT_HINT)).toBeInTheDocument();
  expect(input).toHaveAttribute('aria-invalid', 'false');
});

test('a refusal of the server stays until the date is edited again', async () => {
  api.getPluginSettings.mockResolvedValue({ reconciliationStartDate: localIsoToday() });
  api.savePluginSettings.mockRejectedValue(Object.assign(new Error('Réglage invalide.'), { errors: { reconciliationStartDate: 'Date de mise en service invalide.' } }));
  renderCard();
  const input = await field();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Date de mise en service invalide.')).toBeInTheDocument();
  fireEvent.change(input, { target: { value: SERVER_TODAY } });
  expect(await screen.findByText(DEFAULT_HINT)).toBeInTheDocument();
  expect(screen.queryByText('Date de mise en service invalide.')).not.toBeInTheDocument();
});
